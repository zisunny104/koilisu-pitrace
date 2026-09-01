// 矩形選取工具：滑鼠拖曳定義選取範圍。跟套索工具統一 Photoshop 式修飾鍵語意——
// 純拖曳＝新建（取代既有選取）、Shift+拖曳＝加選、Alt+拖曳＝減選（見 lasso.js 同款邏輯）。
// 加/減選時矩形會轉成 loop 疊進既有選取（selection-geometry.js 的 rectToLoop），選取型別
// 因此變成 'lasso'；純新建才維持原本單純的 'rect' 型別。
// 鍵盤等效操作在屬性面板的 X/Y/寬/高 數字輸入（由 ui/toolbar.js 綁定）。

import { store } from '../state.js';
import { loopsFromSelection, rectToLoop } from '../canvas/selection-geometry.js';

export class RectSelectTool {
    constructor() {
        this.dragStart = null;
        this.draftRect = null;
        this.draftMode = 'new';
    }

    onPointerDown(imgPt, evt, view) {
        const piece = store.getActivePiece();
        if (!piece) return view.announce('請先選取物件');
        const existingLoops = loopsFromSelection(piece.selection);
        // 完全沒有既有選取時修飾鍵無意義（沒東西可加/減），一律當新建。修飾鍵狀態在拖曳
        // 開始時就決定好、中途放開不會回頭改變（跟 LassoTool 一致，避免拖到一半游標移出
        // 畫布漏接 keyup 導致行為跳變）。
        this.draftMode = existingLoops.length === 0 ? 'new' : evt.shiftKey ? 'add' : evt.altKey ? 'subtract' : 'new';
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
        const mode = this.draftMode;
        this.dragStart = null;
        const rect = this.draftRect;
        this.draftRect = null;
        if (piece && rect && rect.w > 2 && rect.h > 2) {
            const rounded = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
            if (mode === 'new') {
                store.updatePiece(piece.id, { selection: { type: 'rect', rect: rounded } });
                view.announce(`矩形選取已更新，寬 ${rounded.w} 高 ${rounded.h} 像素`);
            } else {
                const nextLoops = [...loopsFromSelection(piece.selection), { ...rectToLoop(rounded), mode }];
                store.updatePiece(piece.id, { selection: { type: 'lasso', loops: nextLoops } });
                view.announce(`矩形已${mode === 'add' ? '加選' : '減選'}，目前共 ${nextLoops.length} 個區塊`);
            }
        }
        view.draw();
    }

    drawOverlay(ctx, view) {
        if (!this.draftRect) return;
        ctx.save();
        ctx.translate(view.tx, view.ty);
        ctx.scale(view.scale, view.scale);
        ctx.lineWidth = 1.5 / view.scale;
        ctx.strokeStyle = this.draftMode === 'subtract' ? '#ef4444' : '#3b82f6';
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
