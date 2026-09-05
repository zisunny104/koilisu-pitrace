// 三欄可拖曳調整寬度（VS Code 風格）：拖曳兩條分隔線改變 --pitrace-list-width /
// --pitrace-dock-width，寬度存進 localStorage 跨重整記住（純 UI 偏好，不寫進 .pitra 專案檔）。
// 只在桌面版三欄並排（≥1024px）時看得到；手機/平板堆疊版面分隔線本身是 display:none，
// 拖曳/鍵盤事件掛著也不會被觸發。

const STORAGE_KEY_LIST = 'pitrace-list-width';
const STORAGE_KEY_DOCK = 'pitrace-dock-width';
const DEFAULT_LIST = 200;
const DEFAULT_DOCK = 380;
const MIN_LIST = 150;
const MAX_LIST = 400;
const MIN_DOCK = 280;
const MAX_DOCK = 600;
const MIN_SCAN = 320; // 中央畫布至少保留的寬度，避免兩側分隔線同時拉到最大把畫布擠不見

function readStoredWidth(key, fallback, min, max) {
    const raw = Number(localStorage.getItem(key));
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    return Math.min(max, Math.max(min, raw));
}

function currentWidth(varName, fallback) {
    const raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(varName));
    return Number.isFinite(raw) ? raw : fallback;
}

function applyWidth(varName, px) {
    document.documentElement.style.setProperty(varName, `${px}px`);
}

export function wireResizableColumns() {
    const shell = document.getElementById('editorShell');
    const resizerLeft = document.getElementById('colResizerLeft');
    const resizerRight = document.getElementById('colResizerRight');
    if (!shell || !resizerLeft || !resizerRight) return;

    applyWidth('--pitrace-list-width', readStoredWidth(STORAGE_KEY_LIST, DEFAULT_LIST, MIN_LIST, MAX_LIST));
    applyWidth('--pitrace-dock-width', readStoredWidth(STORAGE_KEY_DOCK, DEFAULT_DOCK, MIN_DOCK, MAX_DOCK));

    // 扣掉另一欄目前寬度、兩條分隔線本身寬度、中央畫布最小寬度後，這一欄還能長到多寬
    function maxAllowed(otherWidth) {
        const resizerTotal = resizerLeft.getBoundingClientRect().width + resizerRight.getBoundingClientRect().width;
        return shell.getBoundingClientRect().width - otherWidth - resizerTotal - MIN_SCAN;
    }

    function setupResizer(resizer, { varName, storageKey, min, max, defaultPx, getOtherWidth, sign }) {
        function updateAria(px) {
            resizer.setAttribute('aria-valuemin', String(min));
            resizer.setAttribute('aria-valuemax', String(max));
            resizer.setAttribute('aria-valuenow', String(Math.round(px)));
        }
        updateAria(currentWidth(varName, defaultPx));

        function clamp(px) {
            const cap = Math.min(max, maxAllowed(getOtherWidth()));
            return Math.min(cap, Math.max(min, px));
        }

        function commit(px) {
            localStorage.setItem(storageKey, String(px));
        }

        resizer.addEventListener('mousedown', (evt) => {
            if (evt.button !== 0) return;
            evt.preventDefault();
            const startX = evt.clientX;
            const startWidth = currentWidth(varName, defaultPx);
            resizer.classList.add('is-dragging');
            document.body.style.userSelect = 'none';

            function onMove(moveEvt) {
                const next = clamp(startWidth + (moveEvt.clientX - startX) * sign);
                applyWidth(varName, next);
                updateAria(next);
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                resizer.classList.remove('is-dragging');
                document.body.style.userSelect = '';
                commit(currentWidth(varName, defaultPx));
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        resizer.addEventListener('dblclick', () => {
            applyWidth(varName, defaultPx);
            updateAria(defaultPx);
            commit(defaultPx);
        });

        resizer.addEventListener('keydown', (evt) => {
            if (evt.key !== 'ArrowLeft' && evt.key !== 'ArrowRight') return;
            evt.preventDefault();
            const step = evt.shiftKey ? 50 : 10;
            const dir = evt.key === 'ArrowRight' ? 1 : -1;
            const next = clamp(currentWidth(varName, defaultPx) + dir * sign * step);
            applyWidth(varName, next);
            updateAria(next);
            commit(next);
        });
    }

    setupResizer(resizerLeft, {
        varName: '--pitrace-list-width',
        storageKey: STORAGE_KEY_LIST,
        min: MIN_LIST,
        max: MAX_LIST,
        defaultPx: DEFAULT_LIST,
        getOtherWidth: () => currentWidth('--pitrace-dock-width', DEFAULT_DOCK),
        sign: 1,
    });

    setupResizer(resizerRight, {
        varName: '--pitrace-dock-width',
        storageKey: STORAGE_KEY_DOCK,
        min: MIN_DOCK,
        max: MAX_DOCK,
        defaultPx: DEFAULT_DOCK,
        getOtherWidth: () => currentWidth('--pitrace-list-width', DEFAULT_LIST),
        sign: -1,
    });
}
