// 去背遮罩的後製濾鏡：去除雜點（連通元件孤立度過濾）與增強筆畫（灰階膨脹），
// 兩者都直接對 computeMask() 算出的最終 alpha 遮罩操作，不重新估算背景色，
// 因此不會重蹈先前 local 背景估算在套索邊界附近算壞掉的覆轍（見 preview-pane.js 呼叫端註解）。

// 連通元件孤立度評分：把粗略二值化後的訊號分組成連通元件（8-連通），依每個元件的面積
// 「占全圖比例」（不是固定像素數，解析度無關）換算成 0~1 的柔性分數，取代「刪掉小面積」
// 這種容易連飛白筆跡、破碎筆劃一起誤刪的做法——同一個連通元件不管形狀多細多破碎，
// 只要面積夠大就整體保留，面積不夠的整體壓低（分散在空白區的孤立雜點通常面積很小）。
// flood fill 用陣列模擬的 stack（非遞迴），避免大面積色塊在高解析度匯出時把呼叫堆疊炸掉。

/**
 * @param {Float32Array} rawMask 0..1 的初步遮罩
 * @param {number} width
 * @param {number} height
 * @param {{epsilon?: number, minAreaFraction?: number, softFraction?: number}} opts
 *   minAreaFraction：元件面積低於此比例（占 width*height）時分數趨近 0；0 表示不過濾。
 * @returns {Float32Array} 0..1 的乘數，套在 rawMask 上得到最終 alpha
 */
export function connectivityScore(rawMask, width, height, opts = {}) {
    const epsilon = opts.epsilon ?? 0.04;
    const minAreaFraction = opts.minAreaFraction ?? 0;

    const n = width * height;
    const score = new Float32Array(n).fill(1);
    if (minAreaFraction <= 0) return score;

    const softFraction = opts.softFraction ?? minAreaFraction * 0.6;
    const minSize = minAreaFraction * n;
    const softRange = Math.max(1, softFraction * n);

    const visited = new Uint8Array(n);
    const stack = new Int32Array(n); // 每個像素至多被 push 一次，n 是安全上限
    const componentIndices = new Int32Array(n);

    for (let start = 0; start < n; start++) {
        if (visited[start] || rawMask[start] < epsilon) continue;

        let sp = 0;
        stack[sp++] = start;
        visited[start] = 1;
        let count = 0;

        while (sp > 0) {
            const idx = stack[--sp];
            componentIndices[count++] = idx;
            const x = idx % width;
            const y = (idx / width) | 0;

            for (let dy = -1; dy <= 1; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= height) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    if (nx < 0 || nx >= width) continue;
                    const nIdx = ny * width + nx;
                    if (visited[nIdx] || rawMask[nIdx] < epsilon) continue;
                    visited[nIdx] = 1;
                    stack[sp++] = nIdx;
                }
            }
        }

        let t = (count - minSize) / softRange;
        t = Math.max(0, Math.min(1, t));
        const smooth = t * t * (3 - 2 * t); // smoothstep
        for (let i = 0; i < count; i++) score[componentIndices[i]] = smooth;
    }

    return score;
}

// 增強筆畫：對 alpha 遮罩做灰階膨脹（separable max filter）——水平方向先取每個像素左右
// radius 範圍內的最大值，再對結果做垂直方向同樣的處理，等效於一次方形視窗的膨脹，
// 但複雜度是 O(w*h*radius) 而非天真雙迴圈的 O(w*h*radius^2)。筆畫因此變粗、細小斷點
// 因為兩側的高 alpha 往中間擴張而重新連接，效果明顯且方向對稱（不會偏向某一邊變粗）。
/**
 * @param {Float32Array} mask 0..1 的遮罩
 * @param {number} width
 * @param {number} height
 * @param {number} radius 膨脹半徑（像素），0 表示不處理
 * @returns {Float32Array}
 */
export function dilateMask(mask, width, height, radius) {
    if (radius <= 0) return mask;
    const tmp = new Float32Array(mask.length);
    const out = new Float32Array(mask.length);

    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            const lo = Math.max(0, x - radius);
            const hi = Math.min(width - 1, x + radius);
            let m = 0;
            for (let k = lo; k <= hi; k++) {
                const v = mask[row + k];
                if (v > m) m = v;
            }
            tmp[row + x] = m;
        }
    }

    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const yLo = Math.max(0, y - radius);
            const yHi = Math.min(height - 1, y + radius);
            let m = 0;
            for (let k = yLo; k <= yHi; k++) {
                const v = tmp[k * width + x];
                if (v > m) m = v;
            }
            out[y * width + x] = m;
        }
    }

    return out;
}
