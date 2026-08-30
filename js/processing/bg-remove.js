// 去背景：以取樣背景色的顏色距離估算 alpha，用平滑曲線過渡（避免生硬二值化邊緣），
// 藉此保留鉛筆／水彩等半透明筆觸，而非單純把「接近白色」的像素直接清成全透明。

import { store } from '../state.js';

/**
 * @param {ImageData} imageData 已裁切到選取範圍的原始像素
 * @param {{r:number,g:number,b:number}} sampleColor 背景取樣色
 * @param {number} threshold 顏色距離門檻（0-255 附近）
 * @param {number} softness 門檻上下的柔化寬度
 * @returns {ImageData}
 */
export function estimateAlpha(imageData, sampleColor, threshold, softness) {
    const { data, width, height } = imageData;
    const out = new ImageData(width, height);
    const od = out.data;
    const { r: sr, g: sg, b: sb } = sampleColor;
    const lo = Math.max(0, threshold - softness);
    const hi = threshold + softness;
    const span = Math.max(1, hi - lo);

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const srcA = data[i + 3];

        const dr = r - sr;
        const dg = g - sg;
        const db = b - sb;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);

        let t = (dist - lo) / span;
        t = Math.max(0, Math.min(1, t));
        const smooth = t * t * (3 - 2 * t); // smoothstep
        const alpha = Math.round(smooth * 255);

        od[i] = r;
        od[i + 1] = g;
        od[i + 2] = b;
        od[i + 3] = Math.min(srcA, alpha);
    }

    return out;
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
        if (!piece) return;
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
