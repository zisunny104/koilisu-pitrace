// 左側「原始掃描」畫布：管理平移/縮放 viewport transform，並把指標/鍵盤事件轉發給目前工具。
// 選取資料一律以原始影像像素座標儲存（見 cssToImage），平移/縮放因此不會影響已存的選取範圍。

import { store, getPieceColor } from '../state.js';
import { RectSelectTool } from '../tools/rect-select.js';
import { LassoTool } from '../tools/lasso.js';
import { EraserTool } from '../tools/eraser.js';
import { EyedropperTool } from '../processing/bg-remove.js';
import { announce } from '../a11y.js';
import { buildSelectionMask } from './selection-mask.js';
import { mergedLoopOutline } from './selection-geometry.js';

class PanTool {
    onPointerDown(imgPt, evt, view) {
        view._panStart = { x: evt.clientX, y: evt.clientY, tx: view.tx, ty: view.ty };
    }

    onPointerMove(imgPt, evt, view) {
        if (!view._panStart) return;
        view.tx = view._panStart.tx + (evt.clientX - view._panStart.x);
        view.ty = view._panStart.ty + (evt.clientY - view._panStart.y);
        view.requestDraw();
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
    eraser: () => new EraserTool(),
};

// 依目前工具（+套索的 Alt 加/減選狀態）決定畫布游標樣式，class 對應到 view.php 的 CSS。
// 橡皮擦不在這裡處理：它改用 cursor:none + drawOverlay 畫出實際縮放比例下的筆刷圓圈，
// 因為 CSS cursor 圖片是螢幕固定尺寸，沒辦法反映「這個半徑在目前縮放下涵蓋多少影像範圍」。
const CURSOR_CLASSES = ['cursor-crosshair', 'cursor-lasso-add', 'cursor-lasso-subtract', 'cursor-eraser', 'cursor-pan'];

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
        this.emptyStateEl = document.getElementById('scanEmptyState');
        this.loadingStateEl = document.getElementById('scanLoadingState');
        this._loadToken = null;
        this._toolInstances = {};
        this._activeToolName = store.activeTool;
        this._panStart = null;
        this._spaceHeld = false;
        this._spacePendingRelease = false;
        this._altHeld = false;
        this._rafId = null;

        canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
        canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
        window.addEventListener('pointerup', (e) => this._onPointerUp(e));
        canvas.addEventListener('pointerleave', () => this._currentTool()?.onPointerLeave?.(this));
        canvas.addEventListener('dblclick', (e) => this._onDblClick(e));
        canvas.addEventListener('keydown', (e) => this._onKeyDown(e));
        canvas.addEventListener('keyup', (e) => this._onKeyUp(e));
        canvas.addEventListener('blur', () => {
            if (this._spaceHeld && !this._panStart) {
                this._spaceHeld = false;
                this.canvas.classList.remove('is-pan-armed');
                this._updateCursorClass();
            }
            if (this._altHeld) {
                this._altHeld = false;
                this._updateCursorClass();
            }
        });
        canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
        // Alt 是套索加/減選的切換鍵，游標要即時反映——但套索拖曳中途放開 Alt 不會改變已經
        // 決定好的 draftMode（見 LassoTool.onPointerDown 的註解），所以這裡只更新游標樣式，
        // 不影響 LassoTool 自己的加/減選判斷。用 window 監聽而非 canvas，避免拖曳時焦點
        // 不在畫布上導致漏接 keyup、游標卡在錯誤狀態。
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Alt' && !this._altHeld) {
                this._altHeld = true;
                this._updateCursorClass();
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Alt' && this._altHeld) {
                this._altHeld = false;
                this._updateCursorClass();
            }
        });
        window.addEventListener('blur', () => {
            if (this._altHeld) {
                this._altHeld = false;
                this._updateCursorClass();
            }
        });
        // 用 ResizeObserver 盯容器本身，而不是只聽 window resize——容器尺寸也會因為版面
        // reflow（例如物件清單載入資料、字型載入完成）改變，這時 window 沒有 resize，
        // 但畫布的 CSS 框尺寸已經變了，canvas.width/height 沒跟著更新就會被瀏覽器整個拉伸貼合。
        new ResizeObserver(() => this._resizeCanvas()).observe(canvas.parentElement);

        store.addEventListener('scan-changed', () => this.loadActiveScan());
        store.addEventListener('scan-oversized', (e) => {
            this.announce(`圖片解析度過大（${e.detail.width}×${e.detail.height}），已略過載入以避免瀏覽器當機`);
        });
        store.addEventListener('active-piece-changed', () => this.draw());
        store.addEventListener('piece-changed', () => this.draw());
        store.addEventListener('tool-changed', (e) => {
            this._currentTool()?.onCancel?.(this);
            this._activeToolName = e.detail.tool;
            this._updateCursorClass();
            this.draw();
        });

        this._updateCursorClass();
        this._resizeCanvas();
    }

    _updateCursorClass() {
        this.canvas.classList.remove(...CURSOR_CLASSES);
        if (this._spaceHeld) return; // is-pan-armed 已經處理（見 _onKeyDown/_onKeyUp）
        switch (this._activeToolName) {
            case 'lasso':
                this.canvas.classList.add(this._altHeld ? 'cursor-lasso-subtract' : 'cursor-lasso-add');
                break;
            case 'eraser':
                this.canvas.classList.add('cursor-eraser');
                break;
            case 'pan':
                this.canvas.classList.add('cursor-pan');
                break;
            default:
                this.canvas.classList.add('cursor-crosshair');
                break;
        }
    }

    announce(msg) {
        announce(this.statusEl, msg);
    }

    _currentTool() {
        if (this._spaceHeld) return (this._toolInstances.pan ??= TOOL_FACTORIES.pan());
        const name = this._activeToolName;
        if (!this._toolInstances[name] && TOOL_FACTORIES[name]) {
            this._toolInstances[name] = TOOL_FACTORIES[name]();
        }
        return this._toolInstances[name] ?? null;
    }

    async loadActiveScan() {
        const scan = store.getActiveScan();
        if (!scan) {
            this._loadToken = null;
            this.bitmap = null;
            if (this.loadingStateEl) this.loadingStateEl.style.display = 'none';
            this.draw();
            return;
        }
        const token = (this._loadToken = {});
        // 立刻清掉舊的 bitmap 參照，不等新的解碼結果回來：舊掃描圖可能已經被上層（移除掃描、
        // 開新專案時）close() 掉，若不清，await 這段期間如果有其他事件（如 active-piece-changed）
        // 觸發 draw()，會對著已關閉的 bitmap 呼叫 drawImage 而拋出 InvalidStateError。
        this.bitmap = null;
        if (this.loadingStateEl) this.loadingStateEl.style.display = '';
        if (this.emptyStateEl) this.emptyStateEl.style.display = 'none';
        try {
            const bitmap = await store.getScanBitmap(scan.id);
            if (this._loadToken !== token) return; // 已切換到其他掃描，捨棄過期結果
            this.bitmap = bitmap;
            if (bitmap) this.fitToView();
            else this.draw(); // 被拒絕（如超大圖片）：bitmap 為 null，仍要清空畫布，不留著前一張的殘影
        } finally {
            if (this._loadToken === token && this.loadingStateEl) this.loadingStateEl.style.display = 'none';
        }
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

    zoomTo(scale) {
        const clamped = Math.min(8, Math.max(0.05, scale));
        this.zoomBy(clamped / this.scale);
    }

    cssToImage(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const cssX = clientX - rect.left;
        const cssY = clientY - rect.top;
        return { x: (cssX - this.tx) / this.scale, y: (cssY - this.ty) / this.scale };
    }

    _onWheel(evt) {
        evt.preventDefault();
        if (!this.bitmap) return;
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
        if (this._spacePendingRelease) {
            this._spaceHeld = false;
            this._spacePendingRelease = false;
            this.canvas.classList.remove('is-pan-armed');
            this._updateCursorClass();
        }
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
        if (!this.bitmap) return;

        if ((evt.key === ' ' || evt.code === 'Space') && !this._spaceHeld) {
            this._spaceHeld = true;
            this.canvas.classList.add('is-pan-armed');
            this._updateCursorClass();
            evt.preventDefault();
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

    _onKeyUp(evt) {
        if (evt.key !== ' ' && evt.code !== 'Space') return;
        if (this._panStart) {
            // 拖曳中放開空白鍵：延後到 pointerup 再切回原工具，避免拖曳過程中被打斷。
            this._spacePendingRelease = true;
            return;
        }
        this._spaceHeld = false;
        this.canvas.classList.remove('is-pan-armed');
        this._updateCursorClass();
    }

    // 高頻率事件（pointermove 拖曳）用這個而不是直接 draw()：同一畫面更新前多次呼叫
    // 只會排進一次 rAF，避免觸控筆/高輪詢率滑鼠一次 pointermove 疊很多次重複繪製。
    requestDraw() {
        if (this._rafId != null) return;
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            this.draw();
        });
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

        if (this.emptyStateEl) this.emptyStateEl.style.display = this.bitmap || this._loadToken ? 'none' : '';

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

            const closedLoops =
                piece.selection.type === 'lasso'
                    ? (piece.selection.loops ?? []).filter((l) => l.closed && l.path.length > 2)
                    : [];

            // 半透明遮罩：只蓋在「選取範圍以外」，讓保留區清楚可辨，被挖空的紙面則變暗。
            if (isActive && this.bitmap) {
                const hasClosedShape = (piece.selection.type === 'rect' && piece.selection.rect) || closedLoops.length > 0;
                if (hasClosedShape) {
                    ctx.save();
                    if (piece.selection.type === 'rect') {
                        const r = piece.selection.rect;
                        ctx.beginPath();
                        ctx.rect(0, 0, this.bitmap.width, this.bitmap.height);
                        ctx.rect(r.x, r.y, r.w, r.h);
                        ctx.fillStyle = 'rgba(15,23,42,0.5)';
                        ctx.fill('evenodd');
                    } else {
                        const mask = buildSelectionMask(closedLoops, this.bitmap.width, this.bitmap.height);
                        ctx.fillStyle = 'rgba(15,23,42,0.5)';
                        ctx.fillRect(0, 0, this.bitmap.width, this.bitmap.height);
                        ctx.globalCompositeOperation = 'destination-out';
                        ctx.drawImage(mask, 0, 0);
                        ctx.globalCompositeOperation = 'source-over';
                    }
                    ctx.restore();
                }
            }

            ctx.lineWidth = (isActive ? 2.5 : 1.5) / this.scale;
            ctx.strokeStyle = isActive ? '#f97316' : getPieceColor(piece);

            if (piece.selection.type === 'rect' && piece.selection.rect) {
                const r = piece.selection.rect;
                ctx.strokeRect(r.x, r.y, r.w, r.h);
            } else if (piece.selection.type === 'lasso' && piece.selection.loops?.length) {
                // 描邊用「真正合併後」的節點級外框（見 selection-geometry.js），不是逐一描
                // 每個 loop 各自的路徑——這樣加選重疊的區塊會顯示成單一外框，減選的區塊則會
                // 在外框上真的挖出一個洞，而不是兩圈互相獨立、看起來還是分開的線。
                const outline = mergedLoopOutline(piece.selection.loops);
                if (outline) {
                    ctx.save();
                    ctx.translate(outline.offsetX, outline.offsetY);
                    ctx.stroke(new Path2D(outline.pathD));
                    ctx.restore();
                }
            }
            ctx.restore();
        }
    }
}
