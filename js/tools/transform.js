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
    if (piece.selection.type === 'lasso' && piece.selection.loops?.length) {
        const points = piece.selection.loops.flatMap((l) => l.path);
        if (points.length > 0) {
            // 不用 Math.min(...xs)／Math.max(...xs)：節點數極端多時展開參數可能超過引擎
            // 呼叫堆疊上限而拋 RangeError，改用手動迴圈取極值。
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of points) {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            }
            return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        }
    }
    return null;
}
