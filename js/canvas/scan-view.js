// 左側「原始掃描」畫布：管理平移/縮放 viewport transform，並把指標/鍵盤事件轉發給目前工具。
// 選取資料一律以原始影像像素座標儲存（見 cssToImage），平移/縮放因此不會影響已存的選取範圍。

import { store } from '../state.js';
import { RectSelectTool } from '../tools/rect-select.js';
import { LassoTool } from '../tools/lasso.js';
import { EyedropperTool } from '../processing/bg-remove.js';

class PanTool {
    onPointerDown(imgPt, evt, view) {
        view._panStart = { x: evt.clientX, y: evt.clientY, tx: view.tx, ty: view.ty };
    }

    onPointerMove(imgPt, evt, view) {
        if (!view._panStart) return;
        view.tx = view._panStart.tx + (evt.clientX - view._panStart.x);
        view.ty = view._panStart.ty + (evt.clientY - view._panStart.y);
        view.draw();
    }

    onPointerUp(imgPt, evt, view) {
        view._panStart = null;
    }

    drawOverlay() {}
    onCancel(view) {
        view._panStart = null;
    }
}

const TOOL_FACTORIES = {
    rect: () => new RectSelectTool(),
    lasso: () => new LassoTool(),
    pan: () => new PanTool(),
    eyedropper: () => new EyedropperTool(),
};

export class ScanView {
    constructor(canvas, statusEl, onZoomChange) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.statusEl = statusEl;
        this.onZoomChange = onZoomChange ?? null;
        this.scale = 1;
        this.tx = 0;
        this.ty = 0;
        this.bitmap = null;
        this._toolInstances = {};
        this._activeToolName = store.activeTool;
        this._panStart = null;

        canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
        canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
        window.addEventListener('pointerup', (e) => this._onPointerUp(e));
        canvas.addEventListener('dblclick', (e) => this._onDblClick(e));
        canvas.addEventListener('keydown', (e) => this._onKeyDown(e));
        canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
        window.addEventListener('resize', () => this._resizeCanvas());

        store.addEventListener('scan-changed', () => this.loadActiveScan());
        store.addEventListener('active-piece-changed', () => this.draw());
        store.addEventListener('piece-changed', () => this.draw());
        store.addEventListener('tool-changed', (e) => {
            this._currentTool()?.onCancel?.(this);
            this._activeToolName = e.detail.tool;
            this.draw();
        });

        this._resizeCanvas();
    }

    announce(msg) {
        if (this.statusEl) this.statusEl.textContent = msg;
    }

    _currentTool() {
        const name = this._activeToolName;
        if (!this._toolInstances[name] && TOOL_FACTORIES[name]) {
            this._toolInstances[name] = TOOL_FACTORIES[name]();
        }
        return this._toolInstances[name] ?? null;
    }

    async loadActiveScan() {
        const scan = store.getActiveScan();
        if (!scan) {
            this.bitmap = null;
            this.draw();
            return;
        }
        this.bitmap = await store.getScanBitmap(scan.id);
        this.fitToView();
    }

    _resizeCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
        this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
        this.draw();
    }

    fitToView() {
        if (!this.bitmap) return;
        const rect = this.canvas.getBoundingClientRect();
        const margin = 24;
        const availW = Math.max(1, rect.width - margin * 2);
        const availH = Math.max(1, rect.height - margin * 2);
        this.scale = Math.min(availW / this.bitmap.width, availH / this.bitmap.height, 1);
        this.tx = (rect.width - this.bitmap.width * this.scale) / 2;
        this.ty = (rect.height - this.bitmap.height * this.scale) / 2;
        this.onZoomChange?.(this.scale);
        this.draw();
    }

    zoomBy(factor, center) {
        const rect = this.canvas.getBoundingClientRect();
        const cx = center?.x ?? rect.width / 2;
        const cy = center?.y ?? rect.height / 2;
        const newScale = Math.min(8, Math.max(0.05, this.scale * factor));
        const imgX = (cx - this.tx) / this.scale;
        const imgY = (cy - this.ty) / this.scale;
        this.tx = cx - imgX * newScale;
        this.ty = cy - imgY * newScale;
        this.scale = newScale;
        this.onZoomChange?.(this.scale);
        this.draw();
    }

    cssToImage(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const cssX = clientX - rect.left;
        const cssY = clientY - rect.top;
        return { x: (cssX - this.tx) / this.scale, y: (cssY - this.ty) / this.scale };
    }

    _onWheel(evt) {
        evt.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const center = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
        this.zoomBy(evt.deltaY < 0 ? 1.1 : 1 / 1.1, center);
    }

    _onPointerDown(evt) {
        this.canvas.focus();
        const imgPt = this.cssToImage(evt.clientX, evt.clientY);
        this.canvas.setPointerCapture(evt.pointerId);
        this._currentTool()?.onPointerDown?.(imgPt, evt, this);
    }

    _onPointerMove(evt) {
        const imgPt = this.cssToImage(evt.clientX, evt.clientY);
        this._currentTool()?.onPointerMove?.(imgPt, evt, this);
    }

    _onPointerUp(evt) {
        const imgPt = this.cssToImage(evt.clientX, evt.clientY);
        this._currentTool()?.onPointerUp?.(imgPt, evt, this);
    }

    _onDblClick(evt) {
        const imgPt = this.cssToImage(evt.clientX, evt.clientY);
        this._currentTool()?.onDblClick?.(imgPt, evt, this);
    }

    _onKeyDown(evt) {
        if (evt.key === 'Escape') {
            this._currentTool()?.onCancel?.(this);
            return;
        }
        this._currentTool()?.onKeyDown?.(evt, this);

        const step = evt.shiftKey ? 40 : 10;
        switch (evt.key) {
            case 'ArrowLeft':
                this.tx += step;
                this.draw();
                evt.preventDefault();
                break;
            case 'ArrowRight':
                this.tx -= step;
                this.draw();
                evt.preventDefault();
                break;
            case 'ArrowUp':
                this.ty += step;
                this.draw();
                evt.preventDefault();
                break;
            case 'ArrowDown':
                this.ty -= step;
                this.draw();
                evt.preventDefault();
                break;
            case '+':
            case '=':
                this.zoomBy(1.2);
                evt.preventDefault();
                break;
            case '-':
                this.zoomBy(1 / 1.2);
                evt.preventDefault();
                break;
            case '0':
                this.fitToView();
                evt.preventDefault();
                break;
            default:
                break;
        }
    }

    draw() {
        const ctx = this.ctx;
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);

        if (this.bitmap) {
            ctx.save();
            ctx.translate(this.tx, this.ty);
            ctx.scale(this.scale, this.scale);
            ctx.drawImage(this.bitmap, 0, 0);
            ctx.restore();
            this._drawSelections(ctx);
        }

        this._currentTool()?.drawOverlay?.(ctx, this);
    }

    _drawSelections(ctx) {
        const activePiece = store.getActivePiece();
        for (const piece of store.project.pieces) {
            if (piece.scanId !== store.activeScanId) continue;
            const isActive = activePiece && piece.id === activePiece.id;
            ctx.save();
            ctx.translate(this.tx, this.ty);
            ctx.scale(this.scale, this.scale);

            // 半透明遮罩：只蓋在「選取範圍以外」，讓保留區清楚可辨，被挖空的紙面則變暗。
            if (isActive && this.bitmap) {
                const hasClosedShape =
                    (piece.selection.type === 'rect' && piece.selection.rect) ||
                    (piece.selection.type === 'lasso' && piece.selection.closed && piece.selection.path?.length > 2);
                if (hasClosedShape) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(0, 0, this.bitmap.width, this.bitmap.height);
                    if (piece.selection.type === 'rect') {
                        const r = piece.selection.rect;
                        ctx.rect(r.x, r.y, r.w, r.h);
                    } else {
                        piece.selection.path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
                        ctx.closePath();
                    }
                    ctx.fillStyle = 'rgba(15,23,42,0.5)';
                    ctx.fill('evenodd');
                    ctx.restore();
                }
            }

            ctx.lineWidth = (isActive ? 2 : 1) / this.scale;
            ctx.strokeStyle = isActive ? '#f97316' : 'rgba(148,163,184,0.8)';

            if (piece.selection.type === 'rect' && piece.selection.rect) {
                const r = piece.selection.rect;
                ctx.strokeRect(r.x, r.y, r.w, r.h);
            } else if (piece.selection.type === 'lasso' && piece.selection.path?.length > 1) {
                ctx.beginPath();
                piece.selection.path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
                if (piece.selection.closed) ctx.closePath();
                ctx.stroke();
            }
            ctx.restore();
        }
    }
}
