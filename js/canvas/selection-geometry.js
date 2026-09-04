// 套索加/減選區塊的「真正合併外框」：瀏覽器沒有原生的向量多邊形布林運算 API，
// 這裡改用「先點陣化、再向量化」湊出等效結果——先用既有的 buildSelectionMask 把所有
// loop 依 add=source-over／subtract=destination-out 合成成一張二值遮罩（跟匯出用的是
// 同一套規則），再用既有的 marching squares 等值線追蹤（traceAlphaContours，原本是給
// SVG 匯出用的）反推出合併後的封閉外框。這樣得到的節點是「合併後真正的邊界」，
// 不是每個 loop 各自節點的總和——兩個重疊矩形合併後是 6 個節點，不是 4+4=8 個。

import { buildSelectionMask } from './selection-mask.js';
import { traceAlphaContours, traceAlphaContourRings } from '../processing/vectorize.js';

// 矩形只是四個節點的特例：矩形選取要跟套索的 loops 一起做加/減選合成時，
// 先轉成這種四節點 loop 當底，而不是讓 rect/lasso 兩種選取資料格式各自為政。
export function rectToLoop(rect) {
    return {
        path: [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.w, y: rect.y },
            { x: rect.x + rect.w, y: rect.y + rect.h },
            { x: rect.x, y: rect.y + rect.h },
        ],
        closed: true,
        mode: 'add',
    };
}

export function loopsFromSelection(selection) {
    if (selection.type === 'lasso') return selection.loops ?? [];
    if (selection.type === 'rect' && selection.rect) return [rectToLoop(selection.rect)];
    return [];
}

// loops 陣列本身的參考當快取 key：store 每次改選取都會換一個新陣列，參考沒變就不用重算，
// 拖曳畫布觸發的多次 draw() 才不會每畫一次就重新點陣化＋描邊一次。
const outlineCache = new WeakMap();

// 節點座標取極值：故意不用 Math.min(...xs)／Math.max(...xs) 展開陣列——套索點數極端多時
// （大量加/減選疊出來的節點）展開參數可能超過引擎呼叫堆疊上限，直接拋 RangeError 而不只是變慢。
function boundsOf(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    minX = Math.floor(minX) - 1;
    minY = Math.floor(minY) - 1;
    maxX = Math.ceil(maxX) + 1;
    maxY = Math.ceil(maxY) + 1;
    return { minX, minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

// 外框純粹是畫面上的描邊視覺效果，從不寫回 piece.selection，可以放心犧牲解析度換效能：
// 超過這個邊長就先縮小點陣化＋描邊，畫的時候再等比例放大回去（見 scan-view.js 的 outline.scale）。
// 選取範圍最大可達原始掃描的 6 千萬像素等級，不降的話每次加/減選都要在主執行緒對整個
// bounding box 重新點陣化＋marching squares，是「選取節點很多時操作變頓」的主因。
const OUTLINE_MAX_DIM = 1600;

/**
 * @param {Array<{path:{x:number,y:number}[], closed:boolean, mode:'add'|'subtract'}>} loops
 * @returns {{ pathD: string, nodeCount: number, offsetX: number, offsetY: number, scale: number } | null}
 */
export function mergedLoopOutline(loops) {
    if (!loops || loops.length === 0) return null;
    if (outlineCache.has(loops)) return outlineCache.get(loops);

    const points = loops.flatMap((l) => l.path);
    if (!points.length) return null;
    const { minX, minY, w, h } = boundsOf(points);

    const scale = Math.min(1, OUTLINE_MAX_DIM / Math.max(w, h));
    const mw = Math.max(1, Math.round(w * scale));
    const mh = Math.max(1, Math.round(h * scale));

    const mask = buildSelectionMask(loops, mw, mh, minX, minY, scale);
    const imageData = mask.getContext('2d').getImageData(0, 0, mw, mh);
    const { pathD, nodeCount } = traceAlphaContours(imageData, { threshold: 128, simplifyTolerance: 0.75 });
    if (!pathD) return null;

    const result = { pathD, nodeCount, offsetX: minX, offsetY: minY, scale };
    outlineCache.set(loops, result);
    return result;
}

// 射線法點在多邊形內判斷，用來重建巢狀深度（見下方 flattenLoops 的說明）。
function pointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        const intersect = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

// 平面化結果會直接取代 piece.selection.loops，之後去背/裁切/匯出都是拿新資料在完整原始
// 解析度下運算，所以門檻抓得比純視覺用的 OUTLINE_MAX_DIM 高很多——只有選取範圍逼近
// MAX_SCAN_PIXELS 等級（6 千萬像素、約 7746×7746）才會觸發，一般情況下 loops 座標
// 保持原始精度完全不降。
const FLATTEN_MAX_DIM = 4000;

/**
 * 平面化選取：把目前（可能是多次加/減選疊出來）的 loops 合併成「最少數量、視覺結果
 * 完全相同」的一組新 loops。做法跟 mergedLoopOutline 前半段一樣先點陣化再描邊，但這裡
 * 要保留描出來的每個輪廓分別是不是洞——描邊本身不分輪廓方向（marching squares 接線段
 * 的順序是任意的，不像一般向量軟體那樣強制外框順時針、洞逆時針），所以改用「這個輪廓
 * 的起點被其他幾個輪廓包住」來算巢狀深度：深度是偶數（0、2...）代表本體，畫回
 * buildSelectionMask 要用 add；深度是奇數（1、3...）代表挖洞，要用 subtract。
 * 深度淺的（外框）要排在前面、深的（洞、洞中島）排在後面，這樣依序疊加 source-over／
 * destination-out 才會疊出跟原本一樣的形狀，不能沿用描邊時任意的輪廓順序。
 * @param {Array<{path:{x:number,y:number}[], closed:boolean, mode:'add'|'subtract'}>} loops
 * @returns {Array<{path:{x:number,y:number}[], closed:boolean, mode:'add'|'subtract'}>}
 */
export function flattenLoops(loops) {
    if (!loops || loops.length === 0) return [];
    const points = loops.flatMap((l) => l.path);
    if (!points.length) return [];
    const { minX, minY, w, h } = boundsOf(points);

    const scale = Math.min(1, FLATTEN_MAX_DIM / Math.max(w, h));
    const mw = Math.max(1, Math.round(w * scale));
    const mh = Math.max(1, Math.round(h * scale));

    const mask = buildSelectionMask(loops, mw, mh, minX, minY, scale);
    const imageData = mask.getContext('2d').getImageData(0, 0, mw, mh);
    const rings = traceAlphaContourRings(imageData, { threshold: 128, simplifyTolerance: 0.75 });
    if (!rings.length) return [];

    // 巢狀深度比對前先用 bbox 互斥快速排除：兩個輪廓的 bbox 完全不重疊就必然不互相包含，
    // 不用真的跑 pointInRing 的逐點射線法。使用者疊出很多個彼此不相交的加/減選區塊時
    // （很常見），這一步能省掉原本 O(輪廓數² × 節點數) 裡絕大部分的無謂比對。
    const ringBounds = rings.map((ring) => {
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (const [x, y] of ring) {
            if (x < bx0) bx0 = x;
            if (x > bx1) bx1 = x;
            if (y < by0) by0 = y;
            if (y > by1) by1 = y;
        }
        return { bx0, by0, bx1, by1 };
    });
    const insideBounds = (b, x, y) => x >= b.bx0 && x <= b.bx1 && y >= b.by0 && y <= b.by1;

    const invScale = 1 / scale;
    return rings
        .map((ring, idx) => ({
            ring,
            depth: rings.reduce((count, other, j) => {
                if (j === idx || !insideBounds(ringBounds[j], ring[0][0], ring[0][1])) return count;
                return count + (pointInRing(ring[0], other) ? 1 : 0);
            }, 0),
        }))
        .sort((a, b) => a.depth - b.depth)
        .map(({ ring, depth }) => ({
            path: ring.map(([x, y]) => ({ x: x * invScale + minX, y: y * invScale + minY })),
            closed: true,
            mode: depth % 2 === 0 ? 'add' : 'subtract',
        }));
}
