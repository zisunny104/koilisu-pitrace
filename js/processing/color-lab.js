// 色彩數學工具：sRGB→CIE Lab 轉換、ΔE76 色差、可分離 box blur。
// 純函式、不含 Pitrace 業務邏輯，供 bg-remove.js 的局部背景估算重用。

const REF_X = 95.047;
const REF_Y = 100.0;
const REF_Z = 108.883; // D65 參考白點

function srgbToLinear(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function xyzToLabF(t) {
    return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

/** @param {{r:number,g:number,b:number}} rgb 0-255 @returns {{l:number,a:number,b:number}} */
export function rgbToLab({ r, g, b }) {
    const rl = srgbToLinear(r) * 100;
    const gl = srgbToLinear(g) * 100;
    const bl = srgbToLinear(b) * 100;
    const x = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
    const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
    const z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;

    const fx = xyzToLabF(x / REF_X);
    const fy = xyzToLabF(y / REF_Y);
    const fz = xyzToLabF(z / REF_Z);

    return {
        l: 116 * fy - 16,
        a: 500 * (fx - fy),
        b: 200 * (fy - fz),
    };
}

function clampIndex(idx, length) {
    return idx < 0 ? 0 : idx >= length ? length - 1 : idx;
}

// 沿一條線（一列或一欄）做滑動窗口平均，邊界用最近端點值延伸（clamp-to-edge），
// 靠加入/移出窗口兩端各一個樣本增量更新總和，複雜度跟半徑無關，維持 O(length)。
function boxBlurLine(src, dst, offset, stride, length, radius) {
    if (length === 0) return;
    const windowSize = radius * 2 + 1;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
        sum += src[offset + clampIndex(k, length) * stride];
    }
    for (let i = 0; i < length; i++) {
        dst[offset + i * stride] = sum / windowSize;
        if (i + 1 < length) {
            const outIdx = clampIndex(i - radius, length);
            const inIdx = clampIndex(i + 1 + radius, length);
            sum += src[offset + inIdx * stride] - src[offset + outIdx * stride];
        }
    }
}

/**
 * 3-pass box blur 近似 Gaussian（比單次 box blur 少一點方塊狀 artifact），separable、
 * O(width*height) 與半徑無關。用於單一色彩通道平面（例如 Lab 的 L/a/b 或 RGB 的 R/G/B）。
 * @param {Float32Array} src 長度 width*height 的單通道平面
 */
export function boxBlurChannel(src, width, height, radius) {
    const r = Math.max(1, Math.round(radius));
    let a = Float32Array.from(src);
    let b = new Float32Array(width * height);
    for (let pass = 0; pass < 3; pass++) {
        for (let y = 0; y < height; y++) boxBlurLine(a, b, y * width, 1, width, r);
        for (let x = 0; x < width; x++) boxBlurLine(b, a, x, width, height, r);
    }
    return a;
}
