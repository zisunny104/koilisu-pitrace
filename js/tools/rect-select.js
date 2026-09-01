// 矩形選取工具：滑鼠拖曳定義選取範圍（同一個作品可重複拖曳覆蓋）。
// 鍵盤等效操作在屬性面板的 X/Y/寬/高 數字輸入（由 ui/toolbar.js 綁定）。

import { store } from '../state.js';

export class RectSelectTool {
    constructor() {
        this.dragStart = null;
        this.draftRect = null;
    }

    onPointerDown(imgPt, evt, view) {
        const piece = store.getActivePiece();
        if (!piece) return view.announce('請先選取物件');
        this.dragStart = imgPt;
        this.draftRect = { x: imgPt.x, y: imgPt.y, w: 0, h: 0 };
    }

    onPointerMove(imgPt, evt, view) {
        if (!this.dragStart) return;
        const x = Math.min(this.dragStart.x, imgPt.x);
        const y = Math.min(this.dragStart.y, imgPt.y);
        const w = Math.abs(imgPt.x - this.dragStart.x);
        const h = Math.abs(imgPt.y - this.dragStart.y);
        this.draftRect = { x, y, w, h };
        view.requestDraw();
    }

    onPointerUp(imgPt, evt, view) {
        if (!this.dragStart) return;
        const piece = store.getActivePiece();
        this.dragStart = null;
        const rect = this.draftRect;
        this.draftRect = null;
        if (piece && rect && rect.w > 2 && rect.h > 2) {
            const rounded = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
            store.updatePiece(piece.id, { selection: { type: 'rect', rect: rounded } });
            view.announce(`矩形選取已更新，寬 ${rounded.w} 高 ${rounded.h} 像素`);
        }
        view.draw();
    }

    drawOverlay(ctx, view) {
        if (!this.draftRect) return;
        ctx.save();
        ctx.translate(view.tx, view.ty);
        ctx.scale(view.scale, view.scale);
        ctx.lineWidth = 1.5 / view.scale;
        ctx.strokeStyle = '#3b82f6';
        ctx.setLineDash([4 / view.scale, 3 / view.scale]);
        ctx.strokeRect(this.draftRect.x, this.draftRect.y, this.draftRect.w, this.draftRect.h);
        ctx.restore();
    }

    onCancel(view) {
        this.dragStart = null;
        this.draftRect = null;
        view.draw();
    }
}
