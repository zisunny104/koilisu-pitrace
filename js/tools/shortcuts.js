// 全域鍵盤快捷鍵：工具切換比照 Photoshop/Adobe 慣例（M 矩形、L 套索、H 平移、I 取樣背景色、
// E 橡皮擦），並加上 Ctrl+Z 復原／Ctrl+Shift+Z（或 Ctrl+Y）重做。在文字輸入框中打字時忽略，
// 避免搶走輸入焦點。

import { store } from '../state.js';
import { announce } from '../a11y.js';

const KEY_TOOL_MAP = { m: 'rect', l: 'lasso', h: 'pan', i: 'eyedropper', e: 'eraser' };

function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function wireToolShortcuts(statusEl) {
    window.addEventListener('keydown', (evt) => {
        if (isTypingTarget(document.activeElement)) return;

        const mod = evt.ctrlKey || evt.metaKey;
        const key = evt.key.toLowerCase();

        if (mod && !evt.altKey && key === 'z') {
            evt.preventDefault();
            const ok = evt.shiftKey ? store.redo() : store.undo();
            announce(statusEl, ok ? (evt.shiftKey ? '已重做' : '已復原') : '沒有可' + (evt.shiftKey ? '重做' : '復原') + '的步驟');
            return;
        }
        if (mod && !evt.altKey && key === 'y') {
            evt.preventDefault();
            const ok = store.redo();
            announce(statusEl, ok ? '已重做' : '沒有可重做的步驟');
            return;
        }

        if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
        const tool = KEY_TOOL_MAP[key];
        if (!tool) return;
        const radio = document.getElementById(`tool-${tool}`);
        if (!radio || radio.checked) return;
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        evt.preventDefault();
    });
}
