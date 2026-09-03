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

// 依目前工具（+矩形/套索共用的 Shift 加選／Alt 減選狀態）決定畫布游標樣式，class 對應到
// view.php 的 CSS。橡皮擦不在這裡處理：它改用 cursor:none + drawOverlay 畫出實際縮放比例下
// 的筆刷圓圈，因為 CSS cursor 圖片是螢幕固定尺寸，沒辦法反映「這個半徑在目前縮放下涵蓋多少
// 影像範圍」。
const CURSOR_CLASSES = ['cursor-crosshair', 'cursor-select-add', 'cursor-select-subtract', 'cursor-eraser', 'cursor-pan'];

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
        this._middlePanActive = false;
        this._altHeld = false;
        this._shiftHeld = false;
        this._rafId = null;
        this._touchPoints = new Map(); // pointerId -> {x,y}，只存 touch 類型，用來偵測雙指縮放
        this._pinch = null;
        this._maskCache = null; // 套索選取遮罩快取（見 _drawSelections），避免平移/縮放/拖曳時每幀重建
        this._eraseCache = null; // 橡皮擦筆觸標示遮罩快取，原理同上

        canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
        canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
        window.addEventListener('pointerup', (e) => this._onPointerUp(e));
        window.addEventListener('pointercancel', (e) => this._onPointerCancel(e));
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
            if (this._shiftHeld) {
                this._shiftHeld = false;
                this._updateCursorClass();
            }
        });
        canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
        // Shift/Alt 是矩形/套索加選／減選的切換鍵，游標要即時反映——但拖曳中途放開不會改變
        // 已經決定好的 draftMode（見 LassoTool/RectSelectTool.onPointerDown 的註解），所以這裡
        // 只更新游標樣式，不影響工具自己的加/減選判斷。用 window 監聽而非 canvas，避免拖曳時
        // 焦點不在畫布上導致漏接 keyup、游標卡在錯誤狀態。
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Alt' && !this._altHeld) {
                this._altHeld = true;
                this._updateCursorClass();
            }
            if (e.key === 'Shift' && !this._shiftHeld) {
                this._shiftHeld = true;
                this._updateCursorClass();
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Alt' && this._altHeld) {
                this._altHeld = false;
                this._updateCursorClass();
            }
            if (e.key === 'Shift' && this._shiftHeld) {
                this._shiftHeld = false;
                this._updateCursorClass();
            }
        });
        window.addEventListener('blur', () => {
            if (this._altHeld) {
                this._altHeld = false;
                this._updateCursorClass();
            }
            if (this._shiftHeld) {
                this._shiftHeld = false;
                this._updateCursorClass();
            }
        });
        // 用 ResizeObserver 盯容器本身，而不是只聽 window resize——容器尺寸也會因為版面
        // reflow（例如物件清單載入資料、字型載入完成）改變，這時 window 沒有 resize，
        // 但畫布的 CSS 框尺寸已經變了，canvas.width/height 沒跟著更新就會被瀏覽器整個拉伸貼合。
        new ResizeObserver(() => this._resizeCanvas()).observe(canvas.parentElement);

        store.addEventListener('scan-changed', () => this.loadActiveScan());
        store.addEventListener('scan-downscaled', (e) => {
            this.announce(`圖片解析度過大，已自動縮小為 ${e.detail.width}×${e.detail.height} 並轉存為 WebP`);
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
        if (this._spaceHeld || this._middlePanActive) return; // is-pan-armed 已經處理（見 _onKeyDown/_onKeyUp/中鍵處理）
        switch (this._activeToolName) {
            case 'rect':
            case 'lasso':
                if (this._shiftHeld) this.canvas.classList.add('cursor-select-add');
                else if (this._altHeld) this.canvas.classList.add('cursor-select-subtract');
                else this.canvas.classList.add('cursor-crosshair');
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
        if (this._spaceHeld || this._middlePanActive) return (this._toolInstances.pan ??= TOOL_FACTORIES.pan());
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

    // 比照 Figma：滾輪＝平移（deltaX 水平／deltaY 垂直），按著 Ctrl/Cmd 才是縮放（以游標為
    // 中心）——多數瀏覽器把觸控板雙指縮放手勢也轉譯成帶 ctrlKey 的 wheel 事件，這裡順便涵蓋。
    _onWheel(evt) {
        evt.preventDefault();
        if (!this.bitmap) return;
        if (evt.ctrlKey || evt.metaKey) {
            const rect = this.canvas.getBoundingClientRect();
            const center = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
            this.zoomBy(evt.deltaY < 0 ? 1.1 : 1 / 1.1, center);
            return;
        }
        this.tx -= evt.deltaX;
        this.ty -= evt.deltaY;
        this.draw();
    }

    _onPointerDown(evt) {
        this.canvas.focus();
        this.canvas.setPointerCapture(evt.pointerId);

        if (evt.pointerType === 'touch') {
            this._touchPoints.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
            if (this._touchPoints.size === 2) {
                // 第二指按下：目前工具若有未完成的單指手勢（畫套索/框選/擦除中）先取消，改進雙指縮放
                this._currentTool()?.onCancel?.(this);
                this._pinch = this._pinchState();
                return;
            }
            if (this._touchPoints.size > 2 || this._pinch) return; // 忽略第三指以上、縮放中忽略新手指
        }

        const imgPt = this.cssToImage(evt.clientX, evt.clientY);
        // 比照 Figma：滑鼠中鍵不管目前是什麼工具，按住拖曳一律平移（放開瀏覽器預設的
        // 自動捲動手勢，避免跟這裡的平移打架）。
        if (evt.button === 1) {
            evt.preventDefault();
            this._middlePanActive = true;
            this.canvas.classList.add('is-pan-armed');
            this._updateCursorClass();
        }
        this._currentTool()?.onPointerDown?.(imgPt, evt, this);
    }

    // 雙指縮放：記錄手勢開始當下兩指中點對應的影像座標（anchor），縮放過程中讓這個影像座標
    // 一直跟著目前中點走——這樣兩指同時位移（平移）+ 距離變化（縮放）能一次算完，不用分開處理。
    _pinchState() {
        const [a, b] = [...this._touchPoints.values()];
        const rect = this.canvas.getBoundingClientRect();
        const midX = (a.x + b.x) / 2 - rect.left;
        const midY = (a.y + b.y) / 2 - rect.top;
        return {
            dist0: Math.hypot(b.x - a.x, b.y - a.y),
            scale0: this.scale,
            anchorX: (midX - this.tx) / this.scale,
            anchorY: (midY - this.ty) / this.scale,
        };
    }

    _updatePinch() {
        const [a, b] = [...this._touchPoints.values()];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        if (dist < 1 || this._pinch.dist0 < 1) return;
        const rect = this.canvas.getBoundingClientRect();
        const midX = (a.x + b.x) / 2 - rect.left;
        const midY = (a.y + b.y) / 2 - rect.top;
        const newScale = Math.min(8, Math.max(0.05, this._pinch.scale0 * (dist / this._pinch.dist0)));
        this.tx = midX - this._pinch.anchorX * newScale;
        this.ty = midY - this._pinch.anchorY * newScale;
        this.scale = newScale;
        this.onZoomChange?.(this.scale);
        this.requestDraw();
    }

    _onPointerMove(evt) {
        if (evt.pointerType === 'touch' && this._touchPoints.has(evt.pointerId)) {
            this._touchPoints.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
            if (this._pinch && this._touchPoints.size === 2) {
                this._updatePinch();
                return;
            }
            if (this._pinch) return; // 縮放手勢放開一指後，剩下那指先不當成新的單指拖曳
        }
        const imgPt = this.cssToImage(evt.clientX, evt.clientY);
        this._currentTool()?.onPointerMove?.(imgPt, evt, this);
    }

    _onPointerUp(evt) {
        if (evt.pointerType === 'touch') {
            this._touchPoints.delete(evt.pointerId);
            if (this._pinch && this._touchPoints.size < 2) this._pinch = null;
            if (this._touchPoints.size > 0) return;
        }
        const imgPt = this.cssToImage(evt.clientX, evt.clientY);
        this._currentTool()?.onPointerUp?.(imgPt, evt, this);
        if (evt.button === 1 && this._middlePanActive) {
            this._middlePanActive = false;
            this.canvas.classList.remove('is-pan-armed');
            this._updateCursorClass();
        }
        if (this._spacePendingRelease) {
            this._spaceHeld = false;
            this._spacePendingRelease = false;
            this.canvas.classList.remove('is-pan-armed');
            this._updateCursorClass();
        }
    }

    // 觸控被系統手勢（如邊緣返回、意外捲動）打斷時瀏覽器會發 pointercancel 而不是 pointerup，
    // 沒有這個 fallback 的話工具會卡在「拖曳中」狀態出不來（例如套索半條路徑畫一半卡住）。
    _onPointerCancel(evt) {
        if (evt.pointerType === 'touch') {
            this._touchPoints.delete(evt.pointerId);
            if (this._touchPoints.size < 2) this._pinch = null;
        }
        this._currentTool()?.onCancel?.(this);
        if (this._middlePanActive) {
            this._middlePanActive = false;
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

        // width===0 代表這個 ImageBitmap 已經被 close() 過（規格保證 detached 之後 width/height 讀回 0）——
        // 移除掃描圖／開新專案會同步關閉舊 bitmap，但 active-piece-changed 等事件仍可能在
        // loadActiveScan() 換上新 bitmap 之前搶先觸發 draw()，這裡擋掉避免對已關閉的來源呼叫
        // drawImage 拋出 InvalidStateError。
        if (this.bitmap && this.bitmap.width > 0) {
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

            // 半透明遮罩：選取範圍以外變暗，範圍以內疊一層同樣半透明的淡橘色——兩邊都看得到底圖，
            // 只是亮暗、色調不同，一眼就能分辨「這是選取的這一側」，不會像純色塊那樣完全看不見底圖。
            if (isActive && this.bitmap) {
                const hasClosedShape = (piece.selection.type === 'rect' && piece.selection.rect) || closedLoops.length > 0;
                if (hasClosedShape) {
                    ctx.save();
                    const tintColor = 'rgba(249,115,22,0.18)';
                    if (piece.selection.type === 'rect') {
                        const r = piece.selection.rect;
                        // 拖曳選取可能超出圖片邊界（負座標或超寬超高)；挖洞跟疊色都只算跟圖片重疊的
                        // 部分，不然 evenodd 挖洞在超出邊界處會反而被誤判成「只被算到一次」而填實色。
                        const cx = Math.max(0, r.x);
                        const cy = Math.max(0, r.y);
                        const cw = Math.min(r.x + r.w, this.bitmap.width) - cx;
                        const ch = Math.min(r.y + r.h, this.bitmap.height) - cy;
                        ctx.beginPath();
                        ctx.rect(0, 0, this.bitmap.width, this.bitmap.height);
                        if (cw > 0 && ch > 0) ctx.rect(cx, cy, cw, ch);
                        ctx.fillStyle = 'rgba(15,23,42,0.5)';
                        ctx.fill('evenodd');
                        if (cw > 0 && ch > 0) {
                            ctx.fillStyle = tintColor;
                            ctx.fillRect(cx, cy, cw, ch);
                        }
                    } else {
                        // 遮罩畫布只跟「選取內容＋圖片尺寸」有關，跟平移/縮放/套索草稿無關，快取起來
                        // 重複使用——不快取的話，拖曳套索、加減選、甚至單純平移畫面時，每一幀都要在
                        // 全解析度（可能上千萬像素）的 OffscreenCanvas 上重新描邊＋合成，會嚴重掉幀。
                        const cache = this._maskCache;
                        let dimLayer, tinted;
                        if (
                            cache &&
                            cache.pieceId === piece.id &&
                            cache.selection === piece.selection &&
                            cache.width === this.bitmap.width &&
                            cache.height === this.bitmap.height
                        ) {
                            ({ dimLayer, tinted } = cache);
                        } else {
                            const mask = buildSelectionMask(closedLoops, this.bitmap.width, this.bitmap.height);

                            // 變暗遮罩必須先在獨立的 offscreen canvas 疊好、挖好洞，才能整片貼回主畫布——
                            // 不能直接對 ctx 用 destination-out，那樣會連同稍早畫上去的原圖一起擦除，
                            // 選取範圍反而變成完全透空的洞（穿透看到畫布底色），而不是「顯示原圖」。
                            dimLayer = new OffscreenCanvas(this.bitmap.width, this.bitmap.height);
                            const dimCtx = dimLayer.getContext('2d');
                            dimCtx.fillStyle = 'rgba(15,23,42,0.5)';
                            dimCtx.fillRect(0, 0, this.bitmap.width, this.bitmap.height);
                            dimCtx.globalCompositeOperation = 'destination-out';
                            dimCtx.drawImage(mask, 0, 0);

                            // mask 的黑色版本已經用完，直接原地換成半透明橘色（source-in 一樣不能對主畫布
                            // 做，要在 mask 自己的 offscreen canvas 上換色後才用 source-over 疊上來）。
                            const maskCtx = mask.getContext('2d');
                            maskCtx.globalCompositeOperation = 'source-in';
                            maskCtx.fillStyle = tintColor;
                            maskCtx.fillRect(0, 0, this.bitmap.width, this.bitmap.height);
                            tinted = mask;

                            this._maskCache = { pieceId: piece.id, selection: piece.selection, width: this.bitmap.width, height: this.bitmap.height, dimLayer, tinted };
                        }
                        ctx.drawImage(dimLayer, 0, 0);
                        ctx.drawImage(tinted, 0, 0);
                    }
                    ctx.restore();
                }
            }

            // 橡皮擦筆觸標示：半透明紅色疊在已擦除的區域，不然工作區看不出擦到哪——效果只會在
            // 「即時預覽」窗格才看得到。把所有筆觸先併成一張黑白遮罩再用 source-in 換色，避免
            // 筆觸互相重疊處因為疊了多層半透明色而顏色不均。
            if (isActive && this.bitmap && piece.eraseStrokes?.length) {
                const cache = this._eraseCache;
                let eraseTint;
                if (
                    cache &&
                    cache.pieceId === piece.id &&
                    cache.eraseStrokes === piece.eraseStrokes &&
                    cache.width === this.bitmap.width &&
                    cache.height === this.bitmap.height
                ) {
                    eraseTint = cache.eraseTint;
                } else {
                    const mask = new OffscreenCanvas(this.bitmap.width, this.bitmap.height);
                    const maskCtx = mask.getContext('2d');
                    maskCtx.fillStyle = '#000';
                    maskCtx.strokeStyle = '#000';
                    maskCtx.lineCap = 'round';
                    maskCtx.lineJoin = 'round';
                    for (const stroke of piece.eraseStrokes) {
                        const path = stroke.path ?? [];
                        if (!path.length) continue;
                        const r = stroke.radius ?? 40;
                        if (path.length === 1) {
                            maskCtx.beginPath();
                            maskCtx.arc(path[0].x, path[0].y, r, 0, Math.PI * 2);
                            maskCtx.fill();
                            continue;
                        }
                        maskCtx.lineWidth = r * 2;
                        maskCtx.beginPath();
                        path.forEach((p, i) => (i === 0 ? maskCtx.moveTo(p.x, p.y) : maskCtx.lineTo(p.x, p.y)));
                        maskCtx.stroke();
                    }
                    maskCtx.globalCompositeOperation = 'source-in';
                    maskCtx.fillStyle = 'rgba(239,68,68,0.45)';
                    maskCtx.fillRect(0, 0, this.bitmap.width, this.bitmap.height);
                    eraseTint = mask;
                    this._eraseCache = {
                        pieceId: piece.id,
                        eraseStrokes: piece.eraseStrokes,
                        width: this.bitmap.width,
                        height: this.bitmap.height,
                        eraseTint,
                    };
                }
                ctx.drawImage(eraseTint, 0, 0);
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
