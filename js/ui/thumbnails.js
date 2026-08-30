// 作品縮圖清單：依 store.project.pieces 動態產生可點擊、可鍵盤操作（Tab 逐一移動）的縮圖按鈕。

import { store } from '../state.js';
import { renderPiece } from '../canvas/preview-pane.js';
import { announce } from '../a11y.js';

const thumbMaxDim = 160;

export class ThumbnailStrip {
    constructor(listEl, statusEl) {
        this.listEl = listEl;
        this.statusEl = statusEl;

        store.addEventListener('project-changed', () => this.refresh());
        store.addEventListener('active-piece-changed', () => this.refresh());
        store.addEventListener('piece-changed', () => this.refresh());

        this.refresh();
    }

    refresh() {
        const pieces = store.project.pieces;
        this.listEl.innerHTML = '';

        for (const piece of pieces) {
            const item = document.createElement('div');
            item.setAttribute('role', 'listitem');

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'piece-thumb';
            btn.setAttribute('aria-current', piece.id === store.activePieceId ? 'true' : 'false');
            btn.setAttribute('aria-label', `作品：${piece.name}`);
            btn.addEventListener('click', () => {
                store.setActivePiece(piece.id);
                announce(this.statusEl, `已選取作品 ${piece.name}`);
            });

            const placeholder = document.createElement('div');
            placeholder.className = 'thumb-placeholder';
            btn.appendChild(placeholder);

            const label = document.createElement('span');
            label.className = 'thumb-label';
            label.textContent = piece.name;
            btn.appendChild(label);

            item.appendChild(btn);
            this.listEl.appendChild(item);

            renderPiece(piece, { maxDim: thumbMaxDim }).then((rendered) => {
                if (!rendered || !placeholder.isConnected) return;
                const canvas = document.createElement('canvas');
                canvas.width = rendered.width;
                canvas.height = rendered.height;
                canvas.getContext('2d').drawImage(rendered, 0, 0);
                placeholder.replaceWith(canvas);
            });
        }
    }
}
