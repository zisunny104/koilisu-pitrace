// 自由套索工具：逐點點擊新增節點，雙擊或 Enter 封閉路徑，Backspace 刪除最後一個節點，Esc 取消。
// 節點會即時寫回 piece.selection，因此無障礙節點清單面板（ui/toolbar.js）與畫布可雙向同步。

import { store } from '../state.js';

export class LassoTool {
    constructor() {
        this.draftPath = null;
    }

    onPointerDown(imgPt, evt, view) {
        const piece = store.getActivePiece();
        if (!piece) return view.announce('請先選取物件');
        if (!this.draftPath) {
            this.draftPath = piece.selection.type === 'lasso' && piece.selection.path && !piece.selection.closed
                ? piece.selection.path.slice()
                : [];
        }
        this.draftPath.push({ x: Math.round(imgPt.x), y: Math.round(imgPt.y) });
        this._commit(view, false);
    }

    onDblClick(imgPt, evt, view) {
        this._closePath(view);
    }

    onKeyDown(evt, view) {
        if (evt.key === 'Enter') {
            this._closePath(view);
            evt.preventDefault();
        } else if (evt.key === 'Backspace' && this.draftPath && this.draftPath.length) {
            this.draftPath.pop();
            this._commit(view, false);
            evt.preventDefault();
        }
    }

    onCancel(view) {
        this.draftPath = null;
        view.draw();
    }

    drawOverlay() {
        // 進行中的路徑已透過 _commit 寫回 piece.selection，
        // scan-view.js 的一般 overlay 繪製流程會處理，這裡不需額外繪製。
    }

    _closePath(view) {
        if (!this.draftPath || this.draftPath.length < 3) {
            view.announce('套索至少需要 3 個節點才能封閉路徑');
            return;
        }
        this._commit(view, true);
        this.draftPath = null;
    }

    _commit(view, closed) {
        const piece = store.getActivePiece();
        if (!piece || !this.draftPath) return;
        store.updatePiece(piece.id, { selection: { type: 'lasso', path: this.draftPath.slice(), closed } });
        view.announce(closed
            ? `套索路徑已封閉，共 ${this.draftPath.length} 個節點`
            : `已新增節點，目前共 ${this.draftPath.length} 個節點`);
        view.draw();
    }
}
