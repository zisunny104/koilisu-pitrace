// 套索工具：滑鼠拖曳畫出一個封閉區塊，放開即提交。跟矩形選取工具統一 Photoshop 式修飾鍵
// 語意：純拖曳＝新建（取代既有選取）、Shift+拖曳＝加選、Alt+拖曳＝減選；每個 loop 帶著
// mode 標籤，渲染端（scan-view.js / preview-pane.js）依 mode 逐一合成，不是靠位置重疊的
// 奇偶規則。rectToLoop/loopsFromSelection 共用邏輯搬到 selection-geometry.js，讓矩形工具
// 也能用同一套轉換做加/減選。

import { store } from '../state.js';
import { loopsFromSelection } from '../canvas/selection-geometry.js';

const MIN_POINT_DISTANCE = 3; // image px，避免快速拖曳塞爆點陣列

export class LassoTool {
    constructor() {
        this.draft = null;
        this.draftMode = 'new';
    }

    onPointerDown(imgPt, evt, view) {
        const piece = store.getActivePiece();
        if (!piece) return view.announce('請先選取物件');
        const existingLoops = loopsFromSelection(piece.selection);
        // 完全沒有既有選取時修飾鍵無意義，一律當新建。修飾鍵狀態在拖曳開始時就決定好，
        // 中途放開不會回頭改變 draftMode（拖曳中途游標移出畫布可能漏接 keyup，若中途重新
        // 判斷會導致行為跳變）。
        this.draftMode = existingLoops.length === 0 ? 'new' : evt.shiftKey ? 'add' : evt.altKey ? 'subtract' : 'new';
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
        view.requestDraw();
    }

    onPointerUp(imgPt, evt, view) {
        if (!this.draft) return;
        const piece = store.getActivePiece();
        const draft = this.draft;
        const mode = this.draftMode;
        this.draft = null;
        if (piece && draft.length >= 3) {
            const existingLoops = mode === 'new' ? [] : loopsFromSelection(piece.selection);
            const nextLoops = [...existingLoops, { path: draft, closed: true, mode: mode === 'subtract' ? 'subtract' : 'add' }];
            store.updatePiece(piece.id, { selection: { type: 'lasso', loops: nextLoops } });
            const modeLabel = mode === 'subtract' ? '減選' : mode === 'add' ? '加選' : '新選取';
            view.announce(`已${modeLabel}套索區塊，目前共 ${nextLoops.length} 個區塊`);
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
