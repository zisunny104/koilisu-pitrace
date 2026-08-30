// 共用無障礙輔助：aria-live 狀態宣告、工具列方向鍵巡覽（roving tabindex，依 WAI-ARIA APG）。

export function announce(el, msg) {
    if (!el) return;
    el.textContent = '';
    requestAnimationFrame(() => {
        el.textContent = msg;
    });
}

function isFocusableLeaf(el) {
    if (el.disabled) return false;
    if (el.classList?.contains('visually-hidden')) return false;
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'SELECT') return true;
    if (tag === 'INPUT' && el.type !== 'radio' && el.type !== 'file') return true;
    return el.hasAttribute('tabindex');
}

function collectItems(el, items) {
    if (el.getAttribute?.('role') === 'radiogroup') {
        const checked = el.querySelector('input[type="radio"]:checked') || el.querySelector('input[type="radio"]');
        if (checked) items.push(checked);
        return;
    }
    if (isFocusableLeaf(el)) {
        items.push(el);
        return;
    }
    for (const child of el.children) collectItems(child, items);
}

/**
 * 讓 role="toolbar" 容器內的子項目支援方向鍵巡覽；巢狀的 radiogroup（如選取工具）
 * 視為單一停駐點，其內部的方向鍵切換交給瀏覽器原生 radiogroup 行為處理。
 * @param {HTMLElement} toolbarEl
 */
export function makeToolbarArrowNav(toolbarEl) {
    if (!toolbarEl) return;

    const getItems = () => {
        const items = [];
        for (const child of toolbarEl.children) collectItems(child, items);
        return items;
    };

    getItems().forEach((el, i) => {
        el.tabIndex = i === 0 ? 0 : -1;
    });

    toolbarEl.addEventListener('focusin', (evt) => {
        getItems().forEach((el) => {
            el.tabIndex = el === evt.target || el.contains?.(evt.target) ? 0 : -1;
        });
    });

    toolbarEl.addEventListener('keydown', (evt) => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(evt.key)) return;
        const items = getItems();
        const currentIndex = items.indexOf(document.activeElement);
        if (currentIndex === -1) return;

        let nextIndex = currentIndex;
        if (evt.key === 'ArrowRight' || evt.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
        else if (evt.key === 'ArrowLeft' || evt.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
        else if (evt.key === 'Home') nextIndex = 0;
        else if (evt.key === 'End') nextIndex = items.length - 1;

        if (nextIndex === currentIndex) return;
        items.forEach((el) => (el.tabIndex = -1));
        items[nextIndex].tabIndex = 0;
        items[nextIndex].focus();
        evt.preventDefault();
    });
}
