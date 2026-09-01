// 套索加/減選區塊的「真正合併外框」：瀏覽器沒有原生的向量多邊形布林運算 API，
// 這裡改用「先點陣化、再向量化」湊出等效結果——先用既有的 buildSelectionMask 把所有
// loop 依 add=source-over／subtract=destination-out 合成成一張二值遮罩（跟匯出用的是
// 同一套規則），再用既有的 marching squares 等值線追蹤（traceAlphaContours，原本是給
// SVG 匯出用的）反推出合併後的封閉外框。這樣得到的節點是「合併後真正的邊界」，
// 不是每個 loop 各自節點的總和——兩個重疊矩形合併後是 6 個節點，不是 4+4=8 個。

import { buildSelectionMask } from './selection-mask.js';
import { traceAlphaContours } from '../processing/vectorize.js';

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

/**
 * @param {Array<{path:{x:number,y:number}[], closed:boolean, mode:'add'|'subtract'}>} loops
 * @returns {{ pathD: string, nodeCount: number, offsetX: number, offsetY: number } | null}
 */
export function mergedLoopOutline(loops) {
    if (!loops || loops.length === 0) return null;
    if (outlineCache.has(loops)) return outlineCache.get(loops);

    const points = loops.flatMap((l) => l.path);
    if (!points.length) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.floor(Math.min(...xs)) - 1;
    const minY = Math.floor(Math.min(...ys)) - 1;
    const maxX = Math.ceil(Math.max(...xs)) + 1;
    const maxY = Math.ceil(Math.max(...ys)) + 1;
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);

    const mask = buildSelectionMask(loops, w, h, minX, minY);
    const imageData = mask.getContext('2d').getImageData(0, 0, w, h);
    const { pathD, nodeCount } = traceAlphaContours(imageData, { threshold: 128, simplifyTolerance: 0.75 });
    if (!pathD) return null;

    const result = { pathD, nodeCount, offsetX: minX, offsetY: minY };
    outlineCache.set(loops, result);
    return result;
}
