// 右側「即時預覽」與 PNG 匯出共用的純渲染管線：renderPiece() 從原始掃描位元組出發，
// 依序套用「裁切／套索遮罩 → 旋轉 → 去背」，非破壞性——原始掃描位元組從不被修改。
// 互動預覽限制在 maxPreviewDim 內以維持效能；匯出一律以完整原始解析度重新渲染，
// 因此「預覽縮圖」與「最終輸出」不是同一份縮小過的資料。

import { store } from '../state.js';
import { selectionBounds } from '../tools/transform.js';
import { estimateAlpha } from '../processing/bg-remove.js';

const maxPreviewDim = 1400;

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

    if (piece.selection.type === 'lasso' && piece.selection.path?.length > 2) {
        ctx.globalCompositeOperation = 'destination-in';
        ctx.beginPath();
        piece.selection.path.forEach((p, i) => {
            const px = p.x - x;
            const py = p.y - y;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }

    const rotation = ((piece.rotation % 360) + 360) % 360;
    if (rotation !== 0) {
        const rad = (rotation * Math.PI) / 180;
        const swapDims = rotation === 90 || rotation === 270;
        const rw = swapDims ? h : w;
        const rh = swapDims ? w : h;
        const rotated = new OffscreenCanvas(rw, rh);
        const rctx = rotated.getContext('2d');
        rctx.translate(rw / 2, rh / 2);
        rctx.rotate(rad);
        rctx.drawImage(canvas, -w / 2, -h / 2);
        canvas = rotated;
        ctx = rctx;
    }

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

    const maxDim = opts.maxDim ?? maxPreviewDim;
    if (maxDim && (canvas.width > maxDim || canvas.height > maxDim)) {
        const scale = maxDim / Math.max(canvas.width, canvas.height);
        const dw = Math.max(1, Math.round(canvas.width * scale));
        const dh = Math.max(1, Math.round(canvas.height * scale));
        const scaled = new OffscreenCanvas(dw, dh);
        scaled.getContext('2d').drawImage(canvas, 0, 0, dw, dh);
        canvas = scaled;
    }

    return canvas;
}

/** 匯出一律以完整原始解析度重新渲染，不是把互動預覽的畫面截圖下來。 */
export async function exportPiecePNG(piece) {
    const canvas = await renderPiece(piece, { maxDim: 0 });
    if (!canvas) return null;
    return canvas.convertToBlob({ type: 'image/png' });
}

export class PreviewPane {
    constructor(canvas, statusEl) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.statusEl = statusEl;
        this.emptyStateEl = document.getElementById('previewEmptyState');
        this.loadingStateEl = document.getElementById('previewLoadingState');
        this._loadToken = null;

        store.addEventListener('active-piece-changed', () => this.refresh());
        store.addEventListener('piece-changed', () => this.refresh());
        store.addEventListener('scan-changed', () => this.refresh());
        window.addEventListener('resize', () => this.refresh());

        this.refresh();
    }

    announce(msg) {
        if (this.statusEl) this.statusEl.textContent = msg;
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
            return;
        }

        // 大部分更新都很快完成，延遲顯示載入中效果可避免每次微調都閃爍。
        const token = (this._loadToken = {});
        const showLoadingTimer = setTimeout(() => {
            if (this._loadToken === token && this.loadingStateEl) this.loadingStateEl.style.display = '';
        }, 150);

        const rendered = await renderPiece(piece, {});
        clearTimeout(showLoadingTimer);
        if (this._loadToken !== token) return; // 已有更新的渲染請求，捨棄過期結果
        if (this.loadingStateEl) this.loadingStateEl.style.display = 'none';

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
}
