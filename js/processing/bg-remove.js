// 去背景：用取樣背景色的 RGB 距離估算 alpha，平滑曲線過渡（避免生硬二值化邊緣），
// 藉此保留鉛筆／水彩等半透明筆觸，而非單純把「接近白色」的像素直接清成全透明。
//
// 這裡刻意只用「單一全域取樣色＋RGB 距離」這種最簡單的算法，不做 LAB 色差、不做逐像素的
// 局部背景估算（box blur）、不做連通元件孤立度抑制——這幾樣都實際試過，結果對套索選取範圍
// 貼著內容邊界的物件（局部背景估算會被範圍外的黑色透明區域污染）反而更糟：背景該去除的沒去除、
// 淡色筆跡被洗到快看不見。單一全域取樣色沒有「局部」這個概念，不會有邊界污染的問題，
// 效果穩定可預期，是實測下來對真實掃描稿最可靠的做法。
//
// computeMask() 只算 alpha、完全不碰顏色；compositeOriginalWithMask() 只讀原圖合成最終輸出。
//
// 邊緣白邊的成因：半透明的邊緣像素，其 RGB 本身就是「原稿顏色與背景色的混色」
// （掃描器反鋸齒造成），只調 alpha、不動 RGB 的話，那圈混色像素合成到非白色底
// 時仍會透出白色殘影。解法是「色彩去污染」：依 pixel = a·F + (1-a)·B 反推真正的
// 前景色 F，把背景色的成分從 RGB 中減掉。

import { store } from '../state.js';

/**
 * 把單一「去背強度」0-100 換算成內部的 threshold/softness（RGB 歐氏距離尺度，0-441 附近）。
 * strength=50（預設）對應 threshold=40、softness=24，跟這個演算法本身沿用已久、實測有效的
 * 預設值完全一致，確保滑桿停在預設位置時的效果就是原本驗證過的效果。
 * @param {number} strength 0-100
 * @returns {{threshold:number, softness:number}}
 */
export function resolveBgRemovalParams(strength) {
    const s = Math.max(0, Math.min(100, strength ?? 50)) / 100;
    const threshold = 16 + s * 48; // s=0 → 16, s=0.5 → 40, s=1 → 64
    const softness = 8 + s * 32; // s=0 → 8, s=0.5 → 24, s=1 → 40
    return { threshold, softness };
}

/**
 * 計算去背 alpha 遮罩，不改動任何像素顏色。
 * @param {ImageData} analysisImageData
 * @param {{r:number,g:number,b:number}} sampleColorOriginal 背景取樣色
 * @param {{strength:number, threshold?:number, softness?:number}} opts 去背強度 0-100；
 *   threshold/softness 有值時（舊專案保留下來的手動調校值）直接採用，優先於 strength。
 * @returns {Float32Array} 0..1，長度＝width*height
 */
export function computeMask(analysisImageData, sampleColorOriginal, opts) {
    const { data, width, height } = analysisImageData;
    const n = width * height;
    const { r: sr, g: sg, b: sb } = sampleColorOriginal;
    const { threshold, softness } =
        opts.threshold !== undefined && opts.softness !== undefined
            ? { threshold: opts.threshold, softness: opts.softness }
            : resolveBgRemovalParams(opts.strength);
    const lo = Math.max(0, threshold - softness);
    const hi = threshold + softness;
    const span = Math.max(1, hi - lo);

    const mask = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
        const dr = data[p] - sr;
        const dg = data[p + 1] - sg;
        const db = data[p + 2] - sb;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);

        let t = (dist - lo) / span;
        t = Math.max(0, Math.min(1, t));
        const smooth = t * t * (3 - 2 * t); // smoothstep
        const srcAlpha = data[p + 3] / 255;
        mask[i] = Math.min(srcAlpha, smooth);
    }
    return mask;
}

/**
 * 用原圖顏色＋算好的遮罩合成最終輸出。
 * @param {ImageData} originalImageData
 * @param {Float32Array} maskAlpha
 * @param {{r:number,g:number,b:number}} sampleColorOriginal 背景取樣色
 * @returns {ImageData}
 */
export function compositeOriginalWithMask(originalImageData, maskAlpha, sampleColorOriginal) {
    const { data, width, height } = originalImageData;
    const n = width * height;
    const { r: sr, g: sg, b: sb } = sampleColorOriginal;

    const out = new ImageData(width, height);
    const od = out.data;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
        const alpha = Math.max(0, Math.min(1, maskAlpha[i]));
        const a255 = Math.round(alpha * 255);
        if (a255 > 0 && a255 < 255) {
            od[p] = decontaminate(data[p], sr, alpha);
            od[p + 1] = decontaminate(data[p + 1], sg, alpha);
            od[p + 2] = decontaminate(data[p + 2], sb, alpha);
        } else {
            od[p] = data[p];
            od[p + 1] = data[p + 1];
            od[p + 2] = data[p + 2];
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
