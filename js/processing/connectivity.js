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
