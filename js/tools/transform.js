// 裁切／旋轉：純函式，不持有狀態。旋轉以參數化角度儲存於 piece.rotation，
// 實際像素旋轉在渲染時（preview-pane.js）才套用，屬非破壞性編輯。

import { store } from '../state.js';

export function rotatePieceBy(pieceId, deltaDeg) {
    const piece = store.project.pieces.find((p) => p.id === pieceId);
    if (!piece) return;
    const rotation = ((piece.rotation + deltaDeg) % 360 + 360) % 360;
    store.updatePiece(pieceId, { rotation });
}

/** 依選取類型（矩形或套索）算出邊界框，單位為原始影像像素。 */
export function selectionBounds(piece) {
    if (piece.selection.type === 'rect' && piece.selection.rect) {
        const r = piece.selection.rect;
        return { x: r.x, y: r.y, w: r.w, h: r.h };
    }
    if (piece.selection.type === 'lasso' && piece.selection.path && piece.selection.path.length > 0) {
        const xs = piece.selection.path.map((p) => p.x);
        const ys = piece.selection.path.map((p) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    return null;
}
