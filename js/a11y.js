// 共用無障礙輔助：aria-live 狀態宣告（含可視化簡短通知）、工具列方向鍵巡覽（roving tabindex，依 WAI-ARIA APG）。

let snackbarEl = null;
let snackbarTimer = null;

function ensureSnackbar() {
    if (snackbarEl) return snackbarEl;
    snackbarEl = document.createElement('div');
    snackbarEl.className = 'ts-snackbar pitrace-snackbar';
    snackbarEl.innerHTML = '<div class="content"></div>';
    document.body.appendChild(snackbarEl);
    return snackbarEl;
}

export function announce(el, msg) {
    if (!el) return;
    el.textContent = '';
    requestAnimationFrame(() => {
        el.textContent = msg;
    });

    if (!msg) return;
    const bar = ensureSnackbar();
    bar.querySelector('.content').textContent = msg;
    bar.classList.add('is-shown');
    clearTimeout(snackbarTimer);
    snackbarTimer = setTimeout(() => bar.classList.remove('is-shown'), 3000);
}

function isFocusableLeaf(el) {
    if (el.disabled) return false;
    if (el.classList?.contains('visually-hidden')) return false;
    if (getComputedStyle(el).display === 'none') return false;
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'SELECT') return true;
    if (tag === 'INPUT' && el.type !== 'radio' && el.type !== 'file') return true;
    return el.hasAttribute('tabindex');
}

function collectItems(el, items, focusTarget) {
    if (el.getAttribute?.('role') === 'radiogroup') {
        // 點擊/label 觸發的 focusin 會在瀏覽器更新 :checked 之前先送出，
        // 這裡優先採用實際取得焦點的 radio，避免讀到切換前的舊選取狀態。
        const focused = focusTarget && el.contains(focusTarget) ? focusTarget : null;
        const checked = focused || el.querySelector('input[type="radio"]:checked') || el.querySelector('input[type="radio"]');
        if (checked) items.push(checked);
        return;
    }
    if (isFocusableLeaf(el)) {
        items.push(el);
        return;
    }
    for (const child of el.children) collectItems(child, items, focusTarget);
}

/**
 * 讓 role="toolbar" 容器內的子項目支援方向鍵巡覽；巢狀的 radiogroup（如選取工具）
 * 視為單一停駐點，其內部的方向鍵切換交給瀏覽器原生 radiogroup 行為處理。
 * @param {HTMLElement} toolbarEl
 */
export function makeToolbarArrowNav(toolbarEl) {
    if (!toolbarEl) return;

    const getItems = (focusTarget) => {
        const items = [];
        for (const child of toolbarEl.children) collectItems(child, items, focusTarget);
        return items;
    };

    getItems().forEach((el, i) => {
        el.tabIndex = i === 0 ? 0 : -1;
    });

    toolbarEl.addEventListener('focusin', (evt) => {
        getItems(evt.target).forEach((el) => {
            el.tabIndex = el === evt.target || el.contains?.(evt.target) ? 0 : -1;
        });
    });

    toolbarEl.addEventListener('keydown', (evt) => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(evt.key)) return;
        const inRadiogroup = evt.target.closest('[role="radiogroup"]');
        if (inRadiogroup && evt.key !== 'Home' && evt.key !== 'End') return;
        const items = getItems(evt.target);
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
