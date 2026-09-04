// 橡皮擦工具：拖曳畫出一條圓頭筆刷路徑，處理折痕/蟲蛀/污漬這類需要局部去掉的瑕疵。
// 放開才把整條路徑當一筆存進 piece.eraseStrokes（渲染時在 preview-pane.js 用 destination-out
// 挖除 alpha，非破壞性、原始掃描位元組不變）。commit 延到 pointerup 才寫回 store，
// 拖曳中每個 pointermove 都觸發一次完整 renderPiece 重繪太貴——這點跟 LassoTool 一致。
// 筆刷大小（piece.eraseRadius）不放屬性面板滑桿，改用 [ / ] 即時調整（Photoshop/GIMP 慣例），
// 游標交給 drawOverlay 畫一個跟著縮放比例走的實際筆刷圓圈，CSS cursor 是螢幕固定尺寸，
// 沒辦法反映「這個半徑在目前縮放下實際涵蓋多少影像範圍」。
// 負向筆刷（還原）：比照套索/矩形選取「Alt＝相反動作」的既有慣例，按住 Alt 拖曳把
// stroke.mode 記成 'restore'，渲染端（preview-pane.js）會把這塊區域還原成套用選取遮罩後、
// 還沒被任何橡皮擦動過的乾淨狀態——不是單純 undo 上一筆，而是不管疊了幾層擦除都直接復原。

import { store } from '../state.js';

const MIN_POINT_DISTANCE = 3; // image px
const MIN_RADIUS = 5;
const MAX_RADIUS = 300;

export class EraserTool {
    constructor() {
        this.draft = null;
        this.hoverPt = null;
    }

    onPointerDown(imgPt, evt, view) {
        const piece = store.getActivePiece();
        if (!piece) return view.announce('請先選取物件');
        this.mode = evt.altKey ? 'restore' : 'erase';
        this.draft = [{ x: Math.round(imgPt.x), y: Math.round(imgPt.y) }];
        this.hoverPt = imgPt;
        view.draw();
    }

    onPointerMove(imgPt, evt, view) {
        this.hoverPt = imgPt;
        this.hoverAlt = evt.altKey;
        if (!this.draft) {
            view.requestDraw();
            return;
        }
        const last = this.draft[this.draft.length - 1];
        const dx = imgPt.x - last.x;
        const dy = imgPt.y - last.y;
        if (dx * dx + dy * dy >= MIN_POINT_DISTANCE * MIN_POINT_DISTANCE) {
            this.draft.push({ x: Math.round(imgPt.x), y: Math.round(imgPt.y) });
        }
        view.requestDraw();
    }

    onPointerUp(imgPt, evt, view) {
        if (!this.draft) return;
        const piece = store.getActivePiece();
        const draft = this.draft;
        const mode = this.mode ?? 'erase';
        this.draft = null;
        if (piece) {
            const radius = piece.eraseRadius ?? 40;
            const strokes = [...(piece.eraseStrokes || []), { path: draft, radius, mode }];
            store.updatePiece(piece.id, { eraseStrokes: strokes });
            view.announce(mode === 'restore' ? `已還原一筆，目前共 ${strokes.length} 筆` : `已擦除一筆，目前共 ${strokes.length} 筆`);
        }
        view.draw();
    }

    // 筆刷大小快捷鍵：[ 縮小、] 放大，Shift 加大步進。跟 ScanView 既有的方向鍵平移/縮放
    // 快捷鍵走同一個 onKeyDown(evt, view) 掛鉤，只在橡皮擦是目前工具時才會被呼叫到。
    onKeyDown(evt, view) {
        if (evt.key !== '[' && evt.key !== ']') return;
        const piece = store.getActivePiece();
        if (!piece) return;
        const step = evt.shiftKey ? 20 : 5;
        const delta = evt.key === ']' ? step : -step;
        const next = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, (piece.eraseRadius ?? 40) + delta));
        store.updatePiece(piece.id, { eraseRadius: next });
        view.announce(`筆刷大小 ${next} 像素`);
        evt.preventDefault();
    }

    drawOverlay(ctx, view) {
        const piece = store.getActivePiece();
        if (!piece) return;
        const radius = piece.eraseRadius ?? 40;
        const isRestore = this.draft ? this.mode === 'restore' : this.hoverAlt;
        ctx.save();
        ctx.translate(view.tx, view.ty);
        ctx.scale(view.scale, view.scale);

        if (this.draft && this.draft.length) {
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = radius * 2;
            ctx.strokeStyle = isRestore ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.35)';
            ctx.beginPath();
            this.draft.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.stroke();
        }

        const cursorPt = this.draft ? this.draft[this.draft.length - 1] : this.hoverPt;
        if (cursorPt) {
            ctx.beginPath();
            ctx.arc(cursorPt.x, cursorPt.y, radius, 0, Math.PI * 2);
            ctx.lineWidth = 1.5 / view.scale;
            ctx.strokeStyle = isRestore ? '#22c55e' : '#ef4444';
            ctx.setLineDash([4 / view.scale, 3 / view.scale]);
            ctx.stroke();
        }
        ctx.restore();
    }

    onCancel(view) {
        this.draft = null;
        view.draw();
    }

    onPointerLeave(view) {
        this.hoverPt = null;
        this.hoverAlt = false;
        if (!this.draft) view.draw();
    }
}
