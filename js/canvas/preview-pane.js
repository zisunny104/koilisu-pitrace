// 右側「即時預覽」與 PNG 匯出共用的純渲染管線：renderPiece() 從原始掃描位元組出發，
// 依序套用「裁切／套索遮罩 → 橡皮擦擦除 → 旋轉 → 去背 → 對比度/亮度增強」，
// 非破壞性——原始掃描位元組從不被修改，橡皮擦筆刷跟增強參數都只是存在 piece 上的資料，
// 每次都是重新算過，不是疊加在前一次算完的像素上。
// 互動預覽限制在 maxPreviewDim 內以維持效能；匯出一律以完整原始解析度重新渲染，
// 因此「預覽縮圖」與「最終輸出」不是同一份縮小過的資料。

import { store } from '../state.js';
import { selectionBounds } from '../tools/transform.js';
import { estimateAlpha } from '../processing/bg-remove.js';
import { traceAlphaContours } from '../processing/vectorize.js';
import { announce } from '../a11y.js';
import { buildSelectionMask } from './selection-mask.js';

const maxPreviewDim = 1400;
const defaultSimplifyTolerance = 0.75;

function downscaleCanvas(canvas, maxDim) {
    if (!maxDim || (canvas.width <= maxDim && canvas.height <= maxDim)) return canvas;
    const scale = maxDim / Math.max(canvas.width, canvas.height);
    const dw = Math.max(1, Math.round(canvas.width * scale));
    const dh = Math.max(1, Math.round(canvas.height * scale));
    const scaled = new OffscreenCanvas(dw, dh);
    scaled.getContext('2d').drawImage(canvas, 0, 0, dw, dh);
    return scaled;
}

/** 掃描 alpha 通道找出非透明像素的最小外框；整張全透明時回傳 null。 */
function opaqueBounds(imageData) {
    const { data, width, height } = imageData;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    let i = 3;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++, i += 4) {
            if (data[i] === 0) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    if (maxX < minX || maxY < minY) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// 選取範圍（矩形／套索外框）常常比實際去背後留下的內容大一圈，匯出前裁掉那圈完全透明的邊界。
// 沒有透明像素（去背關閉）或整張都透明時原樣回傳，避免多做一次無意義的複製或產生 0 尺寸畫布。
function cropToOpaqueBounds(canvas) {
    const ctx = canvas.getContext('2d');
    const bounds = opaqueBounds(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (!bounds || (bounds.x === 0 && bounds.y === 0 && bounds.w === canvas.width && bounds.h === canvas.height)) {
        return canvas;
    }
    const cropped = new OffscreenCanvas(bounds.w, bounds.h);
    cropped.getContext('2d').drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
    return cropped;
}

/**
 * @param {object} piece
 * @param {{maxDim?: number}} opts maxDim 為 0 表示不限制（匯出用完整解析度）
 * @returns {Promise<OffscreenCanvas|null>}
 */
export async function renderPiece(piece, opts = {}) {
    if (!piece) return null;
    const bitmap = await store.getScanBitmap(piece.scanId);
    if (!bitmap) return null;

    const bounds = selectionBounds(piece);
    if (!bounds || bounds.w <= 0 || bounds.h <= 0) return null;

    const x = Math.max(0, Math.round(bounds.x));
    const y = Math.max(0, Math.round(bounds.y));
    const w = Math.min(bitmap.width - x, Math.round(bounds.w));
    const h = Math.min(bitmap.height - y, Math.round(bounds.h));
    if (w <= 0 || h <= 0) return null;

    let canvas = new OffscreenCanvas(w, h);
    let ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);

    const closedLoops = piece.selection.type === 'lasso' ? (piece.selection.loops ?? []).filter((l) => l.closed && l.path.length > 2) : [];
    if (closedLoops.length) {
        const mask = buildSelectionMask(closedLoops, w, h, x, y);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(mask, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
    }

    // 橡皮擦筆劃存在跟選取範圍同一套原始影像座標系，在這裡（裁切之後、旋轉之前）套用才會對得上
    // 使用者在工作區實際拖曳看到的畫面——工作區左側畫布一律顯示未旋轉的原圖。
    if (piece.eraseStrokes?.length) eraseStrokesInPlace(ctx, piece.eraseStrokes, x, y);

    const rotation = ((piece.rotation % 360) + 360) % 360;
    if (rotation !== 0) {
        const rad = (rotation * Math.PI) / 180;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));
        const rw = Math.max(1, Math.round(w * cos + h * sin));
        const rh = Math.max(1, Math.round(w * sin + h * cos));
        const rotated = new OffscreenCanvas(rw, rh);
        const rctx = rotated.getContext('2d');
        rctx.translate(rw / 2, rh / 2);
        rctx.rotate(rad);
        rctx.drawImage(canvas, -w / 2, -h / 2);
        canvas = rotated;
        ctx = rctx;
    }

    // 降採樣放在去背之前：縮圖／預覽只需要 maxDim 內的像素量，逐像素去背卻是照 canvas
    // 當下尺寸算成本——先縮小再去背，才不會為了畫一張 160px 縮圖去跑一次全解析度逐像素運算。
    // 匯出（maxDim: 0）不受影響，downscaleCanvas 對 !maxDim 是 no-op，仍在完整原始解析度去背。
    canvas = downscaleCanvas(canvas, opts.maxDim ?? maxPreviewDim);
    ctx = canvas.getContext('2d');

    if (piece.bgRemoval?.enabled) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const alphaData = estimateAlpha(
            imageData,
            piece.bgRemoval.sampleColor,
            piece.bgRemoval.threshold,
            piece.bgRemoval.softness
        );
        ctx.putImageData(alphaData, 0, 0);
    }

    if (piece.enhance?.contrast || piece.enhance?.brightness) {
        applyEnhance(ctx, canvas, piece.enhance);
    }

    return canvas;
}

// 橡皮擦：把每一筆存下來的路徑（圓頭圓角線段，寬度＝筆刷直徑）用 destination-out 直接從
// 畫面挖掉，只影響 alpha，不碰 RGB——跟選取套索遮罩是同一種合成手法，只是資料來源不同
// （筆刷路徑 vs 使用者畫的封閉區塊）。單點筆劃（點一下沒拖曳）額外補畫一個圓，
// 否則 lineTo 沒有第二個點時 stroke() 什麼都不會畫。
function eraseStrokesInPlace(ctx, strokes, offsetX, offsetY) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokes) {
        const path = stroke.path ?? [];
        if (!path.length) continue;
        const r = stroke.radius ?? 40;
        if (path.length === 1) {
            ctx.beginPath();
            ctx.arc(path[0].x - offsetX, path[0].y - offsetY, r, 0, Math.PI * 2);
            ctx.fill();
            continue;
        }
        ctx.lineWidth = r * 2;
        ctx.beginPath();
        path.forEach((p, i) => {
            const px = p.x - offsetX;
            const py = p.y - offsetY;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.stroke();
    }
    ctx.restore();
}

function clamp8(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

// 標準對比度/亮度線性調整（僅動 RGB，alpha 不變）：對比度 -100~100 換算成縮放係數，
// 以 128 為支點放大/縮小到中灰的距離；亮度 -100~100 是加法位移。全透明像素略過不算，
// 省一點運算（去背後大面積透明邊界很常見）。
function applyEnhance(ctx, canvas, enhance) {
    const contrast = enhance?.contrast ?? 0;
    const brightness = enhance?.brightness ?? 0;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        data[i] = clamp8(factor * (data[i] - 128) + 128 + brightness);
        data[i + 1] = clamp8(factor * (data[i + 1] - 128) + 128 + brightness);
        data[i + 2] = clamp8(factor * (data[i + 2] - 128) + 128 + brightness);
    }
    ctx.putImageData(imageData, 0, 0);
}

/** 匯出一律以完整原始解析度重新渲染，不是把互動預覽的畫面截圖下來；並裁掉選取外框多餘的透明邊界。 */
export async function exportPiecePNG(piece) {
    const canvas = await renderPiece(piece, { maxDim: 0 });
    if (!canvas) return null;
    return cropToOpaqueBounds(canvas).convertToBlob({ type: 'image/png' });
}

/** SVG 匯出與向量預覽共用：對裁掉透明邊界後的去背結果描邊，回傳輪廓路徑資料。 */
async function tracePieceVector(piece) {
    const canvas = await renderPiece(piece, { maxDim: 0 });
    if (!canvas) return null;
    const cropped = cropToOpaqueBounds(canvas);
    const ctx = cropped.getContext('2d');
    const imageData = ctx.getImageData(0, 0, cropped.width, cropped.height);
    const tolerance = piece.svgExport?.simplifyTolerance ?? defaultSimplifyTolerance;
    return traceAlphaContours(imageData, { threshold: 128, simplifyTolerance: tolerance });
}

/** 向量預覽：把描出的輪廓實心填黑畫在畫布上，讓使用者在匯出前先看到 SVG 會長怎樣。 */
export async function renderPieceVectorPreview(piece, opts = {}) {
    const traced = await tracePieceVector(piece);
    if (!traced) return null;
    const { pathD, width, height, nodeCount } = traced;
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    if (pathD) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000000';
        ctx.fill(new Path2D(pathD), 'evenodd');
    }
    return { canvas: downscaleCanvas(canvas, opts.maxDim ?? maxPreviewDim), nodeCount };
}

/** 匯出一律以完整原始解析度重新描邊，跟向量預覽一樣共用 tracePieceVector。 */
export async function exportPieceSVG(piece) {
    const traced = await tracePieceVector(piece);
    if (!traced) return null;
    const { pathD, width, height } = traced;
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
        `width="${width}" height="${height}">` +
        `<path d="${pathD}" fill="#000000" fill-rule="evenodd"/></svg>`;
    return new Blob([svg], { type: 'image/svg+xml' });
}

export class PreviewPane {
    constructor(canvas, statusEl) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.statusEl = statusEl;
        this.emptyStateEl = document.getElementById('previewEmptyState');
        this.loadingStateEl = document.getElementById('previewLoadingState');
        this.nodeCountEl = document.getElementById('svgNodeCount');
        this.wrapEl = document.getElementById('previewCanvasWrap');
        this._loadToken = null;

        store.addEventListener('active-piece-changed', () => this.refresh());
        store.addEventListener('piece-changed', () => this.refresh());
        store.addEventListener('scan-changed', () => this.refresh());
        // 容器尺寸會因版面 reflow（不只是 window resize）改變，同一種「canvas 緩衝區跟 CSS 框尺寸
        // 對不上、被瀏覽器整個拉伸」問題，用 ResizeObserver 盯容器本身才會可靠跟著重算。
        new ResizeObserver(() => this.refresh()).observe(canvas.parentElement);

        this.refresh();
    }

    announce(msg) {
        announce(this.statusEl, msg);
    }

    async refresh() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
        this.canvas.height = Math.max(1, Math.round(rect.height * dpr));

        const ctx = this.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const piece = store.getActivePiece();
        if (!piece) {
            this._loadToken = null;
            if (this.loadingStateEl) this.loadingStateEl.style.display = 'none';
            if (this.emptyStateEl) this.emptyStateEl.style.display = '';
            if (this.wrapEl) this.wrapEl.classList.add('is-empty');
            this._setNodeCount(null);
            return;
        }
        if (this.wrapEl) this.wrapEl.classList.remove('is-empty');

        // 大部分更新都很快完成，延遲顯示載入中效果可避免每次微調都閃爍。
        const token = (this._loadToken = {});
        const showLoadingTimer = setTimeout(() => {
            if (this._loadToken === token && this.loadingStateEl) this.loadingStateEl.style.display = '';
        }, 150);

        let rendered = null;
        let nodeCount = null;
        if (piece.svgExport?.enabled) {
            const vec = await renderPieceVectorPreview(piece, {});
            rendered = vec?.canvas ?? null;
            nodeCount = vec?.nodeCount ?? null;
        } else {
            rendered = await renderPiece(piece, {});
        }
        clearTimeout(showLoadingTimer);
        if (this._loadToken !== token) return; // 已有更新的渲染請求，捨棄過期結果
        if (this.loadingStateEl) this.loadingStateEl.style.display = 'none';
        this._setNodeCount(nodeCount);

        if (!rendered) {
            if (this.emptyStateEl) this.emptyStateEl.style.display = '';
            return;
        }

        if (this.emptyStateEl) this.emptyStateEl.style.display = 'none';

        const scale = Math.min(rect.width / rendered.width, rect.height / rendered.height, 1);
        const dw = rendered.width * scale;
        const dh = rendered.height * scale;
        const dx = (rect.width - dw) / 2;
        const dy = (rect.height - dh) / 2;
        ctx.drawImage(rendered, dx, dy, dw, dh);
    }

    _setNodeCount(nodeCount) {
        if (!this.nodeCountEl) return;
        this.nodeCountEl.textContent = Number.isFinite(nodeCount) ? `目前輪廓節點數：${nodeCount}` : '';
    }
}
