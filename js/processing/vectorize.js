// 把去背後的 alpha 遮罩描成向量輪廓（marching squares 等值線追蹤），輸出全黑填色的 SVG。
// 全程本機運算、不依賴任何第三方向量化函式庫，維持這個工具「不上傳、免建置」的定位。

// 沿著 (threshold - a)/(b - a) 在 a、b 之間線性內插出穿越點；a === b 時退化取中點。
function lerp(a, b, va, vb, threshold) {
    if (va === vb) return (a + b) / 2;
    return a + ((threshold - va) / (vb - va)) * (b - a);
}

// 單一 cell（四角 tl/tr/bl/br，位於格點座標 i,j ~ i+1,j+1）依 marching squares 16 種组合
// 回傳 0~2 條線段；case 5 / 10 是對角鞍點，用四角平均值當「中心值」來決定連法。
function cellSegments(i, j, tl, tr, bl, br, threshold) {
    const c =
        (tl >= threshold ? 8 : 0) |
        (tr >= threshold ? 4 : 0) |
        (br >= threshold ? 2 : 0) |
        (bl >= threshold ? 1 : 0);
    if (c === 0 || c === 15) return [];

    const N = [lerp(i, i + 1, tl, tr, threshold), j];
    const E = [i + 1, lerp(j, j + 1, tr, br, threshold)];
    const S = [lerp(i, i + 1, bl, br, threshold), j + 1];
    const W = [i, lerp(j, j + 1, tl, bl, threshold)];
    const center = (tl + tr + br + bl) / 4;

    switch (c) {
        case 1: return [[W, S]];
        case 2: return [[S, E]];
        case 3: return [[W, E]];
        case 4: return [[N, E]];
        case 5: return center >= threshold ? [[N, W], [E, S]] : [[N, E], [W, S]];
        case 6: return [[N, S]];
        case 7: return [[N, W]];
        case 8: return [[N, W]];
        case 9: return [[N, S]];
        case 10: return center >= threshold ? [[N, E], [W, S]] : [[N, W], [E, S]];
        case 11: return [[N, E]];
        case 12: return [[W, E]];
        case 13: return [[S, E]];
        case 14: return [[W, S]];
        default: return [];
    }
}

// 對一張純量格點掃 marching squares，回傳所有線段（尚未串成封閉輪廓）。
function traceSegments(grid, gw, gh, threshold) {
    const segments = [];
    for (let j = 0; j < gh - 1; j++) {
        for (let i = 0; i < gw - 1; i++) {
            const tl = grid[j * gw + i];
            const tr = grid[j * gw + i + 1];
            const bl = grid[(j + 1) * gw + i];
            const br = grid[(j + 1) * gw + i + 1];
            const segs = cellSegments(i, j, tl, tr, bl, br, threshold);
            for (const seg of segs) segments.push(seg);
        }
    }
    return segments;
}

function pointKey(p) {
    return p[0] + ',' + p[1];
}

// 把線段兩兩接起來變成封閉輪廓：每個內部穿越點恰好被相鄰兩個 cell 的線段各用到一次，
// 沿著端點一路接下去繞一圈即可回到起點。fill-rule="evenodd" 不在乎輪廓方向，
// 接的順序、鞍點的連法怎麼選都不影響最終畫出來對不對，只是決定外形細節。
function assembleRings(segments) {
    const adjacency = new Map(); // key(point) -> [{ other, used:boolean }]
    for (const [a, b] of segments) {
        const ka = pointKey(a);
        const kb = pointKey(b);
        if (!adjacency.has(ka)) adjacency.set(ka, []);
        if (!adjacency.has(kb)) adjacency.set(kb, []);
        const linkA = { point: b, used: false };
        const linkB = { point: a, used: false };
        linkA.twin = linkB;
        linkB.twin = linkA;
        adjacency.get(ka).push(linkA);
        adjacency.get(kb).push(linkB);
    }

    const rings = [];
    for (const [startKey, links] of adjacency) {
        for (const startLink of links) {
            if (startLink.used) continue;
            const ring = [];
            let currentKey = startKey;
            let link = startLink;
            let guard = 0;
            const guardMax = segments.length * 2 + 4;
            while (true) {
                link.used = true;
                link.twin.used = true;
                const nextPoint = link.point;
                ring.push(nextPoint);
                const nextKey = pointKey(nextPoint);
                if (nextKey === startKey) break;
                const candidates = adjacency.get(nextKey) || [];
                const next = candidates.find((l) => !l.used);
                if (!next) break; // 理論上不該發生（見上方註解），防呆用
                link = next;
                currentKey = nextKey;
                guard += 1;
                if (guard > guardMax) break; // 防呆：避免資料異常時無窮迴圈
            }
            if (ring.length >= 3) rings.push(ring);
        }
    }
    return rings;
}

// Douglas-Peucker 化簡：marching squares 每個 cell 頂多切一刀，密集像素網格會產生大量
// 幾乎共線的點，化簡後 SVG path 才不會臃腫，邊緣也會看起來更順。
function simplifyRing(points, tolerance) {
    if (points.length <= 3 || tolerance <= 0) return points;

    function perpDist(p, a, b) {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
        const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
        const px = a[0] + t * dx;
        const py = a[1] + t * dy;
        return Math.hypot(p[0] - px, p[1] - py);
    }

    function rdp(pts) {
        if (pts.length <= 2) return pts;
        let maxDist = -1;
        let idx = -1;
        const a = pts[0];
        const b = pts[pts.length - 1];
        for (let i = 1; i < pts.length - 1; i++) {
            const d = perpDist(pts[i], a, b);
            if (d > maxDist) { maxDist = d; idx = i; }
        }
        if (maxDist > tolerance) {
            const left = rdp(pts.slice(0, idx + 1));
            const right = rdp(pts.slice(idx));
            return left.slice(0, -1).concat(right);
        }
        return [a, b];
    }

    // 封閉輪廓沒有天然的頭尾，從中點斷開成兩段跑 RDP 再接回去，避免起點正好在長邊中間被整段拉直。
    const half = Math.floor(points.length / 2);
    const withWrap = points.concat([points[0]]);
    const firstHalf = rdp(withWrap.slice(0, half + 1));
    const secondHalf = rdp(withWrap.slice(half));
    const merged = firstHalf.slice(0, -1).concat(secondHalf);
    merged.pop(); // 去掉重複的收尾點（等同起點）
    return merged.length >= 3 ? merged : points;
}

// 轉角保留門檻：入向量／出向量夾角超過這個角度視為「轉角」，維持直線；否則視為平滑點，
// 用 Catmull-Rom 貝茲擬合。不開放 UI 調整，避免面板變複雜。
const CORNER_ANGLE_DEG = 40;

// 頂點 curr 的轉角角度：入向量 (prev→curr) 與出向量 (curr→next) 的夾角，0 表示完全同向（無轉角）。
function turnAngleDeg(prev, curr, next) {
    const v1x = curr[0] - prev[0], v1y = curr[1] - prev[1];
    const v2x = next[0] - curr[0], v2y = next[1] - curr[1];
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 === 0 || len2 === 0) return 0;
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (len1 * len2)));
    return (Math.acos(cos) * 180) / Math.PI;
}

// 逐段序列化封閉環：兩端點都是平滑點才用 Catmull-Rom 轉出的三次貝茲，其餘（含任一端是
// 轉角）維持直線，讓矩形這類銳角外形不會被磨圓，圓弧這類外形則平滑不見鋸齒。
function ringToPathD(ring) {
    const n = ring.length;
    if (!n) return '';
    if (n < 3) {
        const [first, ...rest] = ring;
        let d = `M${first[0].toFixed(2)},${first[1].toFixed(2)}`;
        for (const p of rest) d += `L${p[0].toFixed(2)},${p[1].toFixed(2)}`;
        return d + 'Z';
    }

    const isCorner = ring.map((p, idx) => {
        const prev = ring[(idx - 1 + n) % n];
        const next = ring[(idx + 1) % n];
        return turnAngleDeg(prev, p, next) > CORNER_ANGLE_DEG;
    });

    const first = ring[0];
    let d = `M${first[0].toFixed(2)},${first[1].toFixed(2)}`;
    for (let i = 0; i < n; i++) {
        const curr = ring[i];
        const next = ring[(i + 1) % n];
        if (isCorner[i] || isCorner[(i + 1) % n]) {
            d += `L${next[0].toFixed(2)},${next[1].toFixed(2)}`;
        } else {
            const prev = ring[(i - 1 + n) % n];
            const after = ring[(i + 2) % n];
            const cp1x = curr[0] + (next[0] - prev[0]) / 6;
            const cp1y = curr[1] + (next[1] - prev[1]) / 6;
            const cp2x = next[0] - (after[0] - curr[0]) / 6;
            const cp2y = next[1] - (after[1] - curr[1]) / 6;
            d += `C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${next[0].toFixed(2)},${next[1].toFixed(2)}`;
        }
    }
    return d + 'Z';
}

/**
 * @param {ImageData} imageData 已完整渲染（含去背 alpha）的像素
 * @param {{threshold?: number, simplifyTolerance?: number}} opts
 * @returns {{ pathD: string, width: number, height: number, nodeCount: number }}
 */
export function traceAlphaContours(imageData, opts = {}) {
    const { width, height, data } = imageData;
    const threshold = opts.threshold ?? 128;
    const simplifyTolerance = opts.simplifyTolerance ?? 0.75;

    // 格點值＝像素 alpha；外圍補一圈 0，確保輪廓不會貼齊畫布邊界、永遠形成封閉線段。
    const gw = width + 2;
    const gh = height + 2;
    const grid = new Float32Array(gw * gh);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            grid[(y + 1) * gw + (x + 1)] = data[(y * width + x) * 4 + 3];
        }
    }

    const segments = traceSegments(grid, gw, gh, threshold);
    const rings = assembleRings(segments)
        .map((ring) => simplifyRing(ring, simplifyTolerance))
        // 內插座標是「補邊後」的格點座標，減 1 換回原始像素座標系。
        .map((ring) => ring.map(([x, y]) => [x - 1, y - 1]));

    const pathD = rings.map(ringToPathD).join(' ');
    const nodeCount = rings.reduce((sum, ring) => sum + ring.length, 0);
    return { pathD, width, height, nodeCount };
}

export function contoursToSVG(imageData, opts = {}) {
    const { pathD, width, height } = traceAlphaContours(imageData, opts);
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
        `width="${width}" height="${height}">` +
        `<path d="${pathD}" fill="#000000" fill-rule="evenodd"/></svg>`
    );
}
