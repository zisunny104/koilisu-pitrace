// 去背景：不再單靠一個固定取樣色的 RGB 距離判斷前景/背景，而是：
// 1. 用 LAB 色差（ΔE76）取代 RGB 歐氏距離，淡色的彩色筆跡在 LAB 空間離紙張背景的距離
//    比在 RGB 空間明顯，能抓到用 RGB 距離量測不出來的極淡筆跡。
// 2. 背景不是整張圖一個固定值，而是用 box blur 估算「局部」背景（同一張紙不同區域的
//    泛黃/光影不均都會被算進去），再用使用者既有的取樣色（滴管／自動取樣邊緣）當校正錨點——
//    把整個局部背景場整體平移，讓它的全圖平均值等於使用者指定的取樣色，藉此不需要記錄
//    取樣當下的座標就能沿用現有的取樣色 UI（見 estimateLocalBackgroundChannel）。
// 3. 初步色差遮罩再過一層連通元件孤立度評分（見 connectivity.js）：分散在空白區域的
//    小雜點會被壓低，成片的筆跡/色塊（不管形狀多細、多破碎）維持原樣，取代「刪掉小面積」
//    這種容易連飛白筆跡一起誤刪的做法。
//
// computeMask() 只讀「分析圖」（已套用對比度/亮度增強）算出 alpha，完全不碰顏色；
// compositeOriginalWithMask() 只讀「原圖」合成最終輸出，兩者分離是為了不讓對比度/亮度
// 這種只該影響「抓不抓得到筆跡」的調整，意外滲入最終輸出的顏色。
//
// 邊緣白邊的成因：半透明的邊緣像素，其 RGB 本身就是「原稿顏色與背景色的混色」
// （掃描器反鋸齒造成），只調 alpha、不動 RGB 的話，那圈混色像素合成到非白色底
// 時仍會透出白色殘影。解法是「色彩去污染」：依 pixel = a·F + (1-a)·B 反推真正的
// 前景色 F，把背景色的成分從 RGB 中減掉——只是這裡的 B 換成逐像素的局部背景，
// 不是單一固定色。

import { store } from '../state.js';
import { rgbToLab, boxBlurChannel } from './color-lab.js';
import { connectivityScore } from './connectivity.js';

const DEFAULT_EPSILON = 0.04;

/** 對單一色彩通道做「box blur + 校正到取樣色」的局部背景估算，見檔頭第 2 點說明。 */
function estimateLocalBackgroundChannel(plane, width, height, radius, anchorValue) {
    const blurred = boxBlurChannel(plane, width, height, radius);
    let sum = 0;
    for (let i = 0; i < blurred.length; i++) sum += blurred[i];
    const bias = anchorValue - sum / blurred.length;
    const out = new Float32Array(blurred.length);
    for (let i = 0; i < blurred.length; i++) out[i] = blurred[i] + bias;
    return out;
}

/**
 * 計算分析圖（已套用對比度/亮度增強）的去背 alpha 遮罩，不改動任何像素顏色。
 * @param {ImageData} analysisImageData
 * @param {{r:number,g:number,b:number}} sampleColorEnhanced 已套用同一套增強公式的取樣色
 * @param {{threshold:number, softness:number, bgRadius:number, isolationSuppress:number}} opts
 * @returns {Float32Array} 0..1，長度＝width*height
 */
export function computeMask(analysisImageData, sampleColorEnhanced, opts) {
    const { data, width, height } = analysisImageData;
    const n = width * height;
    const L = new Float32Array(n);
    const A = new Float32Array(n);
    const B = new Float32Array(n);
    const srcAlpha = new Float32Array(n);

    for (let i = 0, p = 0; i < n; i++, p += 4) {
        const lab = rgbToLab({ r: data[p], g: data[p + 1], b: data[p + 2] });
        L[i] = lab.l;
        A[i] = lab.a;
        B[i] = lab.b;
        srcAlpha[i] = data[p + 3] / 255;
    }

    const anchorLab = rgbToLab(sampleColorEnhanced);
    const radius = Math.max(1, opts.bgRadius ?? 40);
    const bgL = estimateLocalBackgroundChannel(L, width, height, radius, anchorLab.l);
    const bgA = estimateLocalBackgroundChannel(A, width, height, radius, anchorLab.a);
    const bgB = estimateLocalBackgroundChannel(B, width, height, radius, anchorLab.b);

    const threshold = opts.threshold ?? 12;
    const softness = Math.max(1, opts.softness ?? 10);
    const lo = Math.max(0, threshold - softness);
    const hi = threshold + softness;
    const span = Math.max(1, hi - lo);

    const rawMask = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const dl = L[i] - bgL[i];
        const da = A[i] - bgA[i];
        const db = B[i] - bgB[i];
        const dist = Math.sqrt(dl * dl + da * da + db * db);
        let t = (dist - lo) / span;
        t = Math.max(0, Math.min(1, t));
        const smooth = t * t * (3 - 2 * t); // smoothstep
        rawMask[i] = Math.min(srcAlpha[i], smooth);
    }

    const isolationSuppress = Math.max(0, Math.min(100, opts.isolationSuppress ?? 0));
    // 孤立雜點抑制強度換算成「元件最小面積占全圖比例」：用比例而非固定像素數，
    // 才能在預覽（縮圖解析度）跟匯出（完整解析度）之間有一致的視覺效果。
    const minAreaFraction = (isolationSuppress / 100) ** 2 * 0.0003;
    const score = connectivityScore(rawMask, width, height, {
        epsilon: DEFAULT_EPSILON,
        minAreaFraction,
    });

    const mask = new Float32Array(n);
    for (let i = 0; i < n; i++) mask[i] = rawMask[i] * score[i];
    return mask;
}

/**
 * 用原圖顏色＋算好的遮罩合成最終輸出，不讀取分析圖（增強後）的 RGB，
 * 確保輸出色永遠來自使用者原始掃描的顏色。
 * @param {ImageData} originalImageData
 * @param {Float32Array} maskAlpha
 * @param {{r:number,g:number,b:number}} sampleColorOriginal 未增強的原始取樣色
 * @param {{bgRadius:number}} opts
 * @returns {ImageData}
 */
export function compositeOriginalWithMask(originalImageData, maskAlpha, sampleColorOriginal, opts) {
    const { data, width, height } = originalImageData;
    const n = width * height;
    const R = new Float32Array(n);
    const G = new Float32Array(n);
    const Bc = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
        R[i] = data[p];
        G[i] = data[p + 1];
        Bc[i] = data[p + 2];
    }

    const radius = Math.max(1, opts.bgRadius ?? 40);
    const bgR = estimateLocalBackgroundChannel(R, width, height, radius, sampleColorOriginal.r);
    const bgG = estimateLocalBackgroundChannel(G, width, height, radius, sampleColorOriginal.g);
    const bgB = estimateLocalBackgroundChannel(Bc, width, height, radius, sampleColorOriginal.b);

    const out = new ImageData(width, height);
    const od = out.data;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
        const alpha = Math.max(0, Math.min(1, maskAlpha[i]));
        const a255 = Math.round(alpha * 255);
        if (a255 > 0 && a255 < 255) {
            od[p] = decontaminate(R[i], bgR[i], alpha);
            od[p + 1] = decontaminate(G[i], bgG[i], alpha);
            od[p + 2] = decontaminate(Bc[i], bgB[i], alpha);
        } else {
            od[p] = R[i];
            od[p + 1] = G[i];
            od[p + 2] = Bc[i];
        }
        od[p + 3] = a255;
    }
    return out;
}

function decontaminate(channel, bg, alpha) {
    const f = (channel - (1 - alpha) * bg) / alpha;
    return f < 0 ? 0 : f > 255 ? 255 : Math.round(f);
}

/** 以選取範圍四周邊緣一圈像素的平均色，作為背景色的自動初始猜測。 */
export function sampleBorderColor(imageData) {
    const { data, width, height } = imageData;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    const step = Math.max(1, Math.floor(Math.min(width, height) / 200));

    const add = (x, y) => {
        const i = (y * width + x) * 4;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n += 1;
    };

    for (let x = 0; x < width; x += step) {
        add(x, 0);
        add(x, height - 1);
    }
    for (let y = 0; y < height; y += step) {
        add(0, y);
        add(width - 1, y);
    }

    if (n === 0) return { r: 255, g: 255, b: 255 };
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

/** 取樣背景色工具：在原始掃描畫布上點一下，把該像素顏色設為目前作品的背景取樣色。 */
export class EyedropperTool {
    async onPointerDown(imgPt, evt, view) {
        const piece = store.getActivePiece();
        if (!piece) return view.announce('請先選取物件');
        const bitmap = await store.getScanBitmap(piece.scanId);
        if (!bitmap) return;
        const x = Math.round(imgPt.x);
        const y = Math.round(imgPt.y);
        if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return;

        const sampleCanvas = new OffscreenCanvas(1, 1);
        const ctx = sampleCanvas.getContext('2d');
        ctx.drawImage(bitmap, x, y, 1, 1, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;

        store.updatePiece(piece.id, {
            bgRemoval: { ...piece.bgRemoval, sampleColor: { r, g, b } },
        });
        view.announce(`背景取樣色已設定為 RGB ${r}, ${g}, ${b}`);
    }

    drawOverlay() {}
    onCancel() {}
}
