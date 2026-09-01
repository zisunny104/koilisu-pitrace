// 套索工具：滑鼠拖曳畫出一個封閉區塊，放開即提交；同一物件可重複拖曳疊加多個區塊（複合路徑）。
// Adobe 式明確加/減選：預設拖曳＝加選，按住 Alt 拖曳＝減選；每個 loop 帶著 mode 標籤，
// 渲染端（scan-view.js / preview-pane.js）依 mode 逐一合成，不是靠位置重疊的奇偶規則。

import { store } from '../state.js';

const MIN_POINT_DISTANCE = 3; // image px，避免快速拖曳塞爆點陣列

export class LassoTool {
    constructor() {
        this.draft = null;
        this.draftMode = 'add';
    }

    onPointerDown(imgPt, evt, view) {
        const piece = store.getActivePiece();
        if (!piece) return view.announce('請先選取物件');
        const existingLoops = piece.selection.type === 'lasso' ? piece.selection.loops ?? [] : [];
        // 物件還沒有任何區塊時無法做減選，第一圈一律強制加選，不管當下是否按著 Alt。
        this.draftMode = existingLoops.length === 0 || !evt.altKey ? 'add' : 'subtract';
        this.draft = [{ x: Math.round(imgPt.x), y: Math.round(imgPt.y) }];
        view.draw();
    }

    onPointerMove(imgPt, evt, view) {
        if (!this.draft) return;
        const last = this.draft[this.draft.length - 1];
        const dx = imgPt.x - last.x;
        const dy = imgPt.y - last.y;
        if (dx * dx + dy * dy < MIN_POINT_DISTANCE * MIN_POINT_DISTANCE) return;
        this.draft.push({ x: Math.round(imgPt.x), y: Math.round(imgPt.y) });
        view.draw();
    }

    onPointerUp(imgPt, evt, view) {
        if (!this.draft) return;
        const piece = store.getActivePiece();
        const draft = this.draft;
        this.draft = null;
        if (piece && draft.length >= 3) {
            const loops = piece.selection.type === 'lasso' ? piece.selection.loops ?? [] : [];
            const nextLoops = [...loops, { path: draft, closed: true, mode: this.draftMode }];
            store.updatePiece(piece.id, { selection: { type: 'lasso', loops: nextLoops } });
            const modeLabel = this.draftMode === 'subtract' ? '減選' : '加選';
            view.announce(`已新增套索區塊（${modeLabel}），目前共 ${nextLoops.length} 個區塊`);
        }
        view.draw();
    }

    drawOverlay(ctx, view) {
        if (!this.draft || this.draft.length < 2) return;
        ctx.save();
        ctx.translate(view.tx, view.ty);
        ctx.scale(view.scale, view.scale);
        ctx.lineWidth = 1.5 / view.scale;
        ctx.strokeStyle = this.draftMode === 'subtract' ? '#ef4444' : '#3b82f6';
        ctx.setLineDash([4 / view.scale, 3 / view.scale]);
        ctx.beginPath();
        this.draft.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
        ctx.restore();
    }

    onCancel(view) {
        this.draft = null;
        view.draw();
    }
}
