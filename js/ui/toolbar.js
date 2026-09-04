// DOM 事件綁定：專案操作列、編輯工具列、作品清單按鈕、屬性面板（矩形/套索精確編輯、去背參數、輸出）。
// 資料一律經由 store 讀寫，畫面則訂閱 store 事件被動更新，不直接互相呼叫。

import { store, createEmptyProject } from '../state.js';
import { rotatePieceBy, selectionBounds } from '../tools/transform.js';
import { exportPiecePNG, exportPieceSVG } from '../canvas/preview-pane.js';
import { serializeProject, parseProjectZip } from '../pitra-format.js';
import { zipWrite } from '../pitra-zip.js';
import { sampleBorderColor } from '../processing/bg-remove.js';
import { detectImageDpi } from '../processing/image-metadata.js';
import { renderPdfPages } from '../processing/pdf-import.js';
import { announce } from '../a11y.js';
import { clearSnapshot } from '../autosave.js';
import { setPreviewMode } from './preview-mode.js';
import { loopsFromSelection } from '../canvas/selection-geometry.js';
import { flattenLoopsAsync } from '../workers/selection-worker-client.js';

function el(id) {
    return document.getElementById(id);
}

function makeIcon(cls) {
    const span = document.createElement('span');
    span.className = `ts-icon ${cls}`;
    span.setAttribute('aria-hidden', 'true');
    return span;
}

// 共用下拉選單開關邏輯（觸發鈕 + 選單容器）：點外面關閉、Esc 關閉並把焦點還給觸發鈕。
// 觸發鈕本身的 click 行為由呼叫端自訂（例如圖片清單鈕在還沒有圖片時要直接開檔案選取器）。
//
// opts.portal＝true 時，開啟時把選單節點搬到 document.body、改用 position:fixed 由 JS 算座標，
// 避開畫布浮動工具列 overflow-x:auto 連帶把 overflow-y 也裁成 auto、蓋掉往下彈出內容的問題。
function wireDropdownToggle(trigger, menu, onToggle, opts = {}) {
    const portal = opts.portal;

    // collision flip：下面空間不夠、上面夠的話翻到觸發鈕上方展開。觸發鈕若身處
    // .canvas-floating-toolbar，翻轉/間距以整顆浮動藥丸的外緣為準（而非觸發鈕自身邊界），
    // 選單才不會貼到甚至蓋住浮動工具列本體。
    function position() {
        const rect = trigger.getBoundingClientRect();
        const shell = trigger.closest('.canvas-floating-toolbar');
        const shellRect = shell ? shell.getBoundingClientRect() : rect;
        const gap = 10;
        menu.style.position = 'fixed';
        menu.style.visibility = 'hidden';
        menu.style.top = '0px';
        const menuHeight = menu.offsetHeight;
        const menuWidth = menu.offsetWidth;
        const fitsBelow = shellRect.bottom + gap + menuHeight <= window.innerHeight - 8;
        const top = fitsBelow ? shellRect.bottom + gap : Math.max(8, shellRect.top - gap - menuHeight);
        const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        menu.style.visibility = '';
    }

    function close() {
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        onToggle?.(false);
    }
    function open() {
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        if (portal) {
            document.body.appendChild(menu);
            position();
        }
        onToggle?.(true);
    }
    function toggle() {
        if (menu.hidden) open(); else close();
    }
    document.addEventListener('click', (evt) => {
        if (!menu.hidden && evt.target !== trigger && !menu.contains(evt.target) && !trigger.contains(evt.target)) {
            close();
        }
    });
    document.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape' && !menu.hidden) {
            close();
            trigger.focus();
        }
    });
    return { open, close, toggle };
}

// 讓 range 滑桿與旁邊的數字輸入框互相同步：拖曳滑桿即時反映到數字框，同時以
// requestAnimationFrame 節流寫回 store（去背分析非同步、無 Worker，若每個 input 事件都
// 直接寫回會在拖曳時瘋狂疊加運算）——同一時間最多只有一次排隊中的套用，拖到哪就吃到哪，
// 不用放開滑桿才看得到結果；放開/變更時再保證套用一次最終值。打數字框則反過來即時同步
// 滑桿，blur/Enter 時夾在 min~max 內寫回 store。
function bindRangeNumberPair(rangeId, numberId, apply) {
    const range = el(rangeId);
    const number = el(numberId);
    const min = Number(range.min);
    const max = Number(range.max);

    let rafPending = false;
    const scheduleLiveApply = () => {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
            rafPending = false;
            apply(Number(range.value));
        });
    };

    range.addEventListener('input', () => {
        number.value = range.value;
        scheduleLiveApply();
    });
    range.addEventListener('change', () => apply(Number(range.value)));

    number.addEventListener('input', () => {
        const n = Number(number.value);
        if (number.value !== '' && !Number.isNaN(n) && n >= min && n <= max) {
            range.value = String(n);
        }
    });
    number.addEventListener('change', () => {
        let n = Number(number.value);
        if (Number.isNaN(n)) n = Number(range.value);
        n = Math.min(max, Math.max(min, n));
        number.value = String(n);
        range.value = String(n);
        apply(n);
    });
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function stripExtension(filename) {
    return filename.replace(/\.[^.]+$/, '');
}

async function importImageFiles(files, statusEl) {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    // 專案名稱預設為第一次匯入的檔名：只在專案還沒有任何圖片、且名稱還沒被手動改過時才代入，
    // 避免蓋掉使用者已經自己命名（或後續再匯入更多圖片）的專案。
    const isFreshProject = store.project.scans.length === 0 && store.project.name === '未命名專案';
    let first = true;
    for (const file of imageFiles) {
        if (first && isFreshProject) {
            store.project.name = stripExtension(file.name);
            el('projectNameInput').value = store.project.name;
        }
        first = false;
        const buf = await file.arrayBuffer();
        const bitmap = await createImageBitmap(new Blob([buf], { type: file.type }));
        const { width, height } = bitmap;
        bitmap.close();
        const dpi = detectImageDpi(new Uint8Array(buf), file.type);
        await store.addScan({ filename: file.name, mime: file.type, bytes: buf, width, height, dpi });
    }
    if (imageFiles.length) announce(statusEl, `已匯入 ${imageFiles.length} 張圖片`);
    else if (files.length) announce(statusEl, '未找到可匯入的圖片檔案');
    return imageFiles.length;
}

// PDF 匯入：每一頁渲染成一張獨立的掃描圖，落地流程比照 importImageFiles——專案名稱只在
// 「還是全新專案」時代入（這裡用 PDF 檔名），每頁再各自呼叫 store.addScan()，超過
// MAX_SCAN_PIXELS 時會由 state.js 既有的延遲壓縮機制自動轉 webp，這裡不用另外處理。
async function importPdfFiles(files, statusEl) {
    const pdfFiles = files.filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (!pdfFiles.length) return 0;
    const isFreshProject = store.project.scans.length === 0 && store.project.name === '未命名專案';
    let first = true;
    let totalPages = 0;
    for (const file of pdfFiles) {
        const baseName = stripExtension(file.name);
        if (first && isFreshProject) {
            store.project.name = baseName;
            el('projectNameInput').value = store.project.name;
        }
        first = false;
        announce(statusEl, `正在匯入 PDF「${file.name}」…`);
        const buf = await file.arrayBuffer();
        const pages = await renderPdfPages(buf, (page, total) => {
            announce(statusEl, `正在渲染「${file.name}」第 ${page}/${total} 頁…`);
        });
        for (const page of pages) {
            const filename = `${baseName}_頁面_${page.pageNumber}.png`;
            await store.addScan({ filename, mime: 'image/png', bytes: page.bytes, width: page.width, height: page.height, dpi: page.dpi });
        }
        totalPages += pages.length;
    }
    announce(statusEl, `已匯入 ${pdfFiles.length} 份 PDF，共 ${totalPages} 頁`);
    return pdfFiles.length;
}

async function openProjectFile(file, statusEl) {
    announce(statusEl, '開啟專案中…');
    try {
        const buf = await file.arrayBuffer();
        const project = parseProjectZip(buf);
        store.setProject(project);
        el('projectNameInput').value = project.name;
        announce(statusEl, `已開啟專案「${project.name}」`);
    } catch (err) {
        announce(statusEl, `開啟失敗：${err.message}`);
    }
}

function wireDragDropImport(statusEl) {
    const target = document.getElementById('main-content');
    if (!target) return;

    function hasFiles(evt) {
        return Array.from(evt.dataTransfer?.types || []).includes('Files');
    }

    // 防止瀏覽器預設把拖入的檔案直接開啟導覽走，即使沒有落在拖放區內也要攔截。
    window.addEventListener('dragover', (evt) => {
        if (hasFiles(evt)) evt.preventDefault();
    });
    window.addEventListener('drop', (evt) => {
        if (hasFiles(evt)) evt.preventDefault();
    });

    let dragDepth = 0;
    target.addEventListener('dragenter', (evt) => {
        if (!hasFiles(evt)) return;
        evt.preventDefault();
        dragDepth += 1;
        target.classList.add('is-drag-target');
    });
    target.addEventListener('dragover', (evt) => {
        if (!hasFiles(evt)) return;
        evt.preventDefault();
    });
    target.addEventListener('dragleave', () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) target.classList.remove('is-drag-target');
    });
    target.addEventListener('drop', async (evt) => {
        if (!hasFiles(evt)) return;
        evt.preventDefault();
        dragDepth = 0;
        target.classList.remove('is-drag-target');
        const files = Array.from(evt.dataTransfer?.files || []);
        const projectFile = files.find((f) => f.name.toLowerCase().endsWith('.pitra'));
        if (projectFile) await openProjectFile(projectFile, statusEl);
        else if (files.length) {
            await importImageFiles(files, statusEl);
            await importPdfFiles(files, statusEl);
        }
    });
}

export function wireUI({ scanView, statusEl }) {
    wireProjectToolbar(statusEl);
    wireScanPaneHeader(scanView, statusEl);
    wireCanvasFloatingToolbar(scanView, statusEl);
    wirePieceList(statusEl);
    wireExportAllMenu(statusEl);
    wirePropertiesPanel(statusEl);
    wireDragDropImport(statusEl);
    wirePreviewBackground();
    wirePreviewMode();

    store.addEventListener('active-piece-changed', () => syncPropertiesPanel(statusEl));
    store.addEventListener('piece-changed', () => syncPropertiesPanel(statusEl));
    syncPropertiesPanel(statusEl);
}

const previewBgStorageKey = 'pitrace.previewBg';
const previewBgClasses = ['bg-checker', 'bg-black', 'bg-white', 'bg-gray'];

// 預覽底色只是顯示偏好，不寫進 .pitra 專案檔，改用 localStorage 記住上次選擇。
function wirePreviewBackground() {
    const wrap = el('previewCanvasWrap');
    if (!wrap) return;
    const radios = document.querySelectorAll('input[name="previewBg"]');
    if (!radios.length) return;

    function apply(mode) {
        wrap.classList.remove(...previewBgClasses);
        wrap.classList.add(`bg-${mode}`);
        try {
            localStorage.setItem(previewBgStorageKey, mode);
        } catch { /* 私密瀏覽模式等情況下 localStorage 可能無法使用，忽略即可 */ }
    }

    let stored = 'checker';
    try {
        stored = localStorage.getItem(previewBgStorageKey) || 'checker';
    } catch { /* 同上 */ }

    let matched = false;
    for (const radio of radios) {
        if (radio.value === stored) {
            radio.checked = true;
            matched = true;
        }
        radio.addEventListener('change', () => {
            if (radio.checked) apply(radio.value);
        });
    }
    apply(matched ? stored : 'checker');
}

const previewModeStorageKey = 'pitrace.previewMode';
const previewModeLabels = { original: '原始', mask: '遮罩', overlay: '疊加', result: '結果' };

// 預覽模式（原始/遮罩/疊加/結果）跟預覽底色一樣只是顯示偏好，不寫進 .pitra，用 localStorage 記住上次選擇。
// 標題列小按鈕＋下拉選單，比照「匯出全部」的 wireDropdownToggle 用法；觸發鈕的圖示/文字
// 即時反映目前選中的模式，選單裡用 aria-checked 標示目前項目（menuitemradio 慣例）。
function wirePreviewMode() {
    const trigger = el('btnPreviewMode');
    const triggerIcon = el('btnPreviewModeIcon');
    const menu = el('previewModeMenu');
    if (!trigger || !menu) return;
    const items = menu.querySelectorAll('button[data-mode]');

    const { close, toggle } = wireDropdownToggle(trigger, menu);
    trigger.addEventListener('click', toggle);

    function applyMode(mode) {
        for (const item of items) {
            const checked = item.dataset.mode === mode;
            item.setAttribute('aria-checked', String(checked));
            item.classList.toggle('is-selected', checked);
        }
        const active = menu.querySelector(`button[data-mode="${mode}"]`);
        const label = previewModeLabels[mode] ?? previewModeLabels.result;
        triggerIcon.className = `ts-icon ${active?.dataset.icon ?? 'is-check-icon'}`;
        trigger.setAttribute('aria-label', `預覽模式：${label}`);
        trigger.title = `預覽模式：${label}`;
        setPreviewMode(mode);
    }

    let stored = 'result';
    try {
        stored = localStorage.getItem(previewModeStorageKey) || 'result';
    } catch { /* 同上 */ }
    const matched = [...items].some((item) => item.dataset.mode === stored);

    for (const item of items) {
        item.addEventListener('click', () => {
            applyMode(item.dataset.mode);
            try {
                localStorage.setItem(previewModeStorageKey, item.dataset.mode);
            } catch { /* 同上 */ }
            close();
            trigger.focus();
        });
    }
    applyMode(matched ? stored : 'result');
}

// 「匯入」按鈕：還沒有圖片時是單純的匯入按鈕；有圖片後變成下拉選單（觸發鈕顯示目前
// 使用中的圖片檔名），選單裡每張圖片一列（點列＝切換使用中圖片，鉛筆＝重新命名，垃圾桶＝刪除），
// 最下面用分隔線隔開放「匯入」——清單（切換圖片）是較常用的操作放上面，新增放最後，
// 跟大多數檔案選單「先看現有項目、新增放最後」的慣例一致。
// 原本是「匯入圖片」按鈕 + 獨立的圖片下拉選單/移除鈕兩組並排，有圖片後兩組同時顯示，
// 在 .pane-toolbar-buttons 裡疊成兩行擠壓版面；合併成一顆下拉選單後版面固定只有一行。
function wireScanMenu(statusEl) {
    const btnImportImage = el('btnImportImage');
    const btnImportImageLabel = el('btnImportImageLabel');
    const btnImportImageChevron = el('btnImportImageChevron');
    const scanMenu = el('scanMenu');
    const fileImportImage = el('fileImportImage');

    // chevron 只在選單實際展開時才顯示，收合狀態一律隱藏（呼應 syncTrigger 內的初始/重同步狀態）。
    const menuToggle = wireDropdownToggle(btnImportImage, scanMenu, (isOpen) => {
        btnImportImageChevron.hidden = !isOpen;
    });
    let renamingScanId = null; // 正在編輯檔名的圖片；渲染時該列換成輸入框，其餘照舊

    function removeScanWithConfirm(scan) {
        const affected = store.project.pieces.filter((p) => p.scanId === scan.id).length;
        const warning = affected > 0
            ? `確定要移除圖片「${scan.filename}」？將一併刪除 ${affected} 個引用此圖片的物件，此操作無法復原。`
            : `確定要移除圖片「${scan.filename}」？此操作無法復原。`;
        if (!window.confirm(warning)) return;
        store.removeScan(scan.id);
        announce(statusEl, `已移除圖片 ${scan.filename}`);
    }

    function renderScanMenu() {
        const scans = store.project.scans;
        scanMenu.innerHTML = '';
        for (const scan of scans) {
            const row = document.createElement('div');
            row.className = 'pane-scan-menu-row';

            if (renamingScanId === scan.id) {
                // 輸入框不能長在 selectBtn（<button>）裡面——button 的內容模型不允許互動元素巢狀，
                // 所以編輯中整列直接換成獨立的輸入框，不重用 selectBtn 結構。
                // Tocas 的 .ts-input 是外層 wrapper div、實際 <input> 不帶 class，跟 projectNameInput/
                // pieceNameInput 兩處既有寫法一致。
                const inputWrap = document.createElement('div');
                inputWrap.className = 'ts-input is-fluid pane-scan-menu-rename-input';
                const input = document.createElement('input');
                input.type = 'text';
                input.value = scan.filename;
                input.setAttribute('aria-label', `重新命名圖片「${scan.filename}」`);
                let escaped = false;
                function commit() {
                    if (escaped) return;
                    const trimmed = input.value.trim();
                    renamingScanId = null;
                    if (trimmed && trimmed !== scan.filename) {
                        store.renameScan(scan.id, trimmed);
                        announce(statusEl, `已將圖片重新命名為「${trimmed}」`);
                    } else {
                        renderScanMenu();
                    }
                }
                input.addEventListener('keydown', (evt) => {
                    if (evt.key === 'Enter') {
                        evt.preventDefault();
                        input.blur();
                    } else if (evt.key === 'Escape') {
                        evt.preventDefault();
                        evt.stopPropagation();
                        escaped = true;
                        renamingScanId = null;
                        renderScanMenu();
                    }
                });
                input.addEventListener('blur', commit);
                input.addEventListener('click', (evt) => evt.stopPropagation());
                inputWrap.appendChild(input);
                row.appendChild(inputWrap);
                scanMenu.appendChild(row);
                requestAnimationFrame(() => {
                    input.focus();
                    input.select();
                });
                continue;
            }

            const isActive = scan.id === store.activeScanId;
            const selectBtn = document.createElement('button');
            selectBtn.type = 'button';
            selectBtn.className = 'item';
            selectBtn.setAttribute('role', 'menuitemradio');
            selectBtn.setAttribute('aria-checked', String(isActive));
            selectBtn.title = scan.filename;
            selectBtn.appendChild(makeIcon(isActive ? 'is-check-icon' : 'is-image-icon'));
            const nameSpan = document.createElement('span');
            nameSpan.className = 'pane-scan-menu-name';
            nameSpan.textContent = scan.filename;
            selectBtn.appendChild(nameSpan);
            selectBtn.addEventListener('click', () => {
                store.setActiveScan(scan.id);
                menuToggle.close();
            });

            const renameBtn = document.createElement('button');
            renameBtn.type = 'button';
            renameBtn.className = 'ts-button is-icon is-small is-ghost';
            renameBtn.setAttribute('aria-label', `重新命名「${scan.filename}」`);
            renameBtn.title = '重新命名';
            renameBtn.appendChild(makeIcon('is-edit-icon'));
            renameBtn.addEventListener('click', (evt) => {
                evt.stopPropagation();
                renamingScanId = scan.id;
                renderScanMenu();
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'ts-button is-icon is-small is-negative is-ghost';
            deleteBtn.setAttribute('aria-label', `移除「${scan.filename}」`);
            deleteBtn.title = '移除圖片';
            deleteBtn.appendChild(makeIcon('is-trash-icon'));
            deleteBtn.addEventListener('click', (evt) => {
                evt.stopPropagation();
                removeScanWithConfirm(scan);
            });

            row.append(selectBtn, renameBtn, deleteBtn);
            scanMenu.appendChild(row);
        }

        if (scans.length > 0) {
            const divider = document.createElement('div');
            divider.className = 'divider';
            scanMenu.appendChild(divider);
        }

        const importItem = document.createElement('button');
        importItem.type = 'button';
        importItem.className = 'item';
        importItem.setAttribute('role', 'menuitem');
        importItem.appendChild(makeIcon('is-upload-icon'));
        const importLabel = document.createElement('span');
        importLabel.textContent = '匯入';
        importItem.appendChild(importLabel);
        importItem.addEventListener('click', () => {
            menuToggle.close();
            fileImportImage.click();
        });
        scanMenu.appendChild(importItem);
    }

    function syncTrigger() {
        const scans = store.project.scans;
        if (scans.length === 0) {
            btnImportImageLabel.textContent = '匯入';
            btnImportImageChevron.hidden = true;
            btnImportImage.removeAttribute('title');
            // 沒有圖片時點下去是直接開檔案選擇窗，不是開選單，aria-haspopup/aria-expanded
            // 這兩個「這顆按鈕會開選單」的語意屬性拿掉，螢幕報讀器才不會報成選單按鈕。
            btnImportImage.removeAttribute('aria-haspopup');
            btnImportImage.removeAttribute('aria-expanded');
        } else {
            const active = store.getActiveScan();
            btnImportImageLabel.textContent = active ? active.filename : `${scans.length} 張圖片`;
            btnImportImageChevron.hidden = scanMenu.hidden;
            btnImportImage.title = active ? active.filename : '';
            btnImportImage.setAttribute('aria-haspopup', 'menu');
            btnImportImage.setAttribute('aria-expanded', String(!scanMenu.hidden));
        }
    }

    function syncScanUI() {
        syncTrigger();
        renderScanMenu();
    }

    btnImportImage.addEventListener('click', () => {
        if (store.project.scans.length === 0) {
            fileImportImage.click();
            return;
        }
        menuToggle.toggle();
    });

    store.addEventListener('project-changed', syncScanUI);
    store.addEventListener('scan-changed', syncScanUI);
    syncScanUI();
}

function wireProjectToolbar(statusEl) {
    const projectNameInput = el('projectNameInput');

    projectNameInput.addEventListener('change', () => {
        store.project.name = projectNameInput.value.trim() || '未命名專案';
    });

    wireScanMenu(statusEl);

    el('btnNewProject').addEventListener('click', () => {
        const hasContent = store.project.scans.length > 0 || store.project.pieces.length > 0;
        if (hasContent && !window.confirm('目前的專案尚未匯出，確定要新增專案並捨棄目前內容？')) return;
        store.setProject(createEmptyProject());
        clearSnapshot(); // 使用者已經明確同意捨棄，連同自動儲存的快照一起清掉，避免下次重新整理又被問一次要不要復原舊內容
        projectNameInput.value = '未命名專案';
        announce(statusEl, '已新增專案');
    });

    const fileOpenProject = el('fileOpenProject');
    el('btnOpenProject').addEventListener('click', () => fileOpenProject.click());
    fileOpenProject.addEventListener('change', async (evt) => {
        const file = evt.target.files?.[0];
        evt.target.value = '';
        if (!file) return;
        await openProjectFile(file, statusEl);
    });

    const btnSaveProject = el('btnSaveProject');
    btnSaveProject.addEventListener('click', () => {
        const bytes = serializeProject(store.project);
        const blob = new Blob([bytes], { type: 'application/zip' });
        downloadBlob(blob, `${store.project.name || 'pitrace-project'}.pitra`);
        announce(statusEl, '已匯出 .pitra 專案檔');
    });

    // 空專案（尚未匯入圖片、也沒有任何物件）沒有內容可匯出，停用避免產生空白 .pitra 檔。
    function syncSaveProjectEnabled() {
        const hasContent = store.project.scans.length > 0 || store.project.pieces.length > 0;
        btnSaveProject.disabled = !hasContent;
    }
    store.addEventListener('project-changed', syncSaveProjectEnabled);
    store.addEventListener('scan-changed', syncSaveProjectEnabled);
    syncSaveProjectEnabled();

    const fileImportImage = el('fileImportImage');
    const btnImportImage = el('btnImportImage');
    // btnImportImage 的 click 監聽已經在 wireScanMenu 裡處理（沒圖片直接開檔案選擇窗、
    // 有圖片改開下拉選單）；這裡不能再重複掛一個無條件開檔案選擇窗的 click，
    // 不然有圖片時點下去選單跟檔案選擇窗會同時彈出。
    fileImportImage.addEventListener('change', async (evt) => {
        const files = Array.from(evt.target.files || []);
        evt.target.value = '';
        if (!files.length) return;
        btnImportImage.disabled = true;
        btnImportImage.classList.add('is-loading');
        try {
            await importImageFiles(files, statusEl);
            await importPdfFiles(files, statusEl);
        } finally {
            btnImportImage.disabled = false;
            btnImportImage.classList.remove('is-loading');
        }
    });
}

// #scanPaneBox 標題列：復原/重做 + 全螢幕工作區切換。
function wireScanPaneHeader(scanView, statusEl) {
    el('btnUndo').addEventListener('click', () => {
        announce(statusEl, store.undo() ? '已復原' : '沒有可復原的步驟');
    });
    el('btnRedo').addEventListener('click', () => {
        announce(statusEl, store.redo() ? '已重做' : '沒有可重做的步驟');
    });
    const syncHistoryButtons = () => {
        el('btnUndo').disabled = !store.canUndo;
        el('btnRedo').disabled = !store.canRedo;
    };
    store.addEventListener('history-changed', syncHistoryButtons);
    syncHistoryButtons();

    wireFocusMode(scanView);
}

// 畫布內下方置中的浮動工具列：新增物件 + 工具選取 + 縮放。
// 全螢幕工作區時只有這個工具列還看得到（見 wireFocusMode 註解），所以「新增物件」也放一份在這裡。
function wireCanvasFloatingToolbar(scanView, statusEl) {
    el('btnAddPieceFloating').addEventListener('click', () => addPiece(statusEl));

    document.querySelectorAll('input[name="tool"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            if (radio.checked) store.setActiveTool(radio.value);
        });
    });

    wireSelectionModeMenu();
    wireEraserSizeMenu();
    wireToolOptionVisibility();

    const zoomControl = wireZoomControl(scanView);
    el('btnZoomOut').addEventListener('click', () => scanView.zoomBy(1 / 1.2));
    el('btnZoomIn').addEventListener('click', () => scanView.zoomBy(1.2));
    el('btnZoomFit').addEventListener('click', () => scanView.fitToView());
    const syncCanvasControls = () => {
        const hasScan = !!store.getActiveScan();
        el('btnAddPieceFloating').disabled = !hasScan;
        el('btnZoomOut').disabled = !hasScan;
        el('btnZoomIn').disabled = !hasScan;
        el('btnZoomFit').disabled = !hasScan;
        zoomControl.setEnabled(hasScan);
    };
    store.addEventListener('scan-changed', syncCanvasControls);
    syncCanvasControls();
}

// 選取模式彈出選單：比照「預覽模式」用 menuitemradio 按鈕 + is-selected，wireDropdownToggle
// 統一開關，選定即關閉選單。觸發鈕圖示固定是 chevron-down，aria-label/tooltip 即時反映目前模式。
const selectionModeLabels = { add: '加選', subtract: '減選', new: '取代全部' };

function wireSelectionModeMenu() {
    const trigger = el('btnSelectionModeMenu');
    const menu = el('selectionModeMenu');
    if (!trigger || !menu) return;
    const items = menu.querySelectorAll('button[data-mode]');

    function syncTrigger() {
        const mode = store.selectionMode;
        const label = `選取模式（目前：${selectionModeLabels[mode] || '加選'}）`;
        trigger.setAttribute('aria-label', label);
        trigger.setAttribute('data-tooltip', label);
        for (const item of items) {
            const checked = item.dataset.mode === mode;
            item.setAttribute('aria-checked', String(checked));
            item.classList.toggle('is-selected', checked);
        }
    }

    const { close, toggle } = wireDropdownToggle(trigger, menu, null, { portal: true });
    trigger.addEventListener('click', toggle);

    for (const item of items) {
        item.addEventListener('click', () => {
            store.setSelectionMode(item.dataset.mode);
            close();
            trigger.focus();
        });
    }

    store.addEventListener('selection-mode-changed', syncTrigger);
    syncTrigger();
}

// 橡皮擦筆刷大小彈出選單：跟 [ / ] 快捷鍵改的是同一個 piece.eraseRadius 欄位，兩種調整方式
// 天生同步——每次選單開啟或 piece 變動都重新從 store 讀值寫回 range/number，不需要另外broadcast。
function wireEraserSizeMenu() {
    const trigger = el('btnEraserSizeMenu');
    const menu = el('eraserSizeMenu');
    if (!trigger || !menu) return;

    function syncFromPiece() {
        const piece = store.getActivePiece();
        const radius = piece?.eraseRadius ?? 40;
        el('eraserRadius').value = radius;
        el('eraserRadiusValue').value = radius;
    }

    const { toggle } = wireDropdownToggle(trigger, menu, (isOpen) => {
        if (isOpen) syncFromPiece();
    }, { portal: true });
    trigger.addEventListener('click', toggle);

    bindRangeNumberPair('eraserRadius', 'eraserRadiusValue', (n) => {
        const piece = store.getActivePiece();
        if (piece) store.updatePiece(piece.id, { eraseRadius: n });
    });

    store.addEventListener('active-piece-changed', syncFromPiece);
    store.addEventListener('piece-changed', syncFromPiece);
    syncFromPiece();
}

// 選取模式／橡皮擦筆刷大小這兩個彈出選單各自只跟一種工具有關，比照 Adobe 選項列「切到哪個
// 工具才顯示哪個工具的設定」慣例，只在對應工具啟用時才顯示觸發鈕：兩個一直露出來的話，
// #scanPaneBox 桌面版寬度通常只有五百多 px，工具列會被擠出水平捲軸、看起來很亂。
function wireToolOptionVisibility() {
    const selWrap = el('selectionModeMenuWrap');
    const eraWrap = el('eraserSizeMenuWrap');
    const selTrigger = el('btnSelectionModeMenu');
    const selMenu = el('selectionModeMenu');
    const eraTrigger = el('btnEraserSizeMenu');
    const eraMenu = el('eraserSizeMenu');
    if (!selWrap || !eraWrap) return;

    function sync() {
        const tool = store.activeTool;
        const showSel = tool === 'rect' || tool === 'lasso';
        const showEra = tool === 'eraser';
        selWrap.hidden = !showSel;
        eraWrap.hidden = !showEra;
        // 觸發鈕連同外層一起被藏起來時，選單本身（可能已被 portal 搬到 body 底下）也要
        // 強制關閉，不然切換工具後選單會孤兒式地繼續浮在畫面上。
        if (!showSel && !selMenu.hidden) { selMenu.hidden = true; selTrigger.setAttribute('aria-expanded', 'false'); }
        if (!showEra && !eraMenu.hidden) { eraMenu.hidden = true; eraTrigger.setAttribute('aria-expanded', 'false'); }
    }

    store.addEventListener('tool-changed', sync);
    sync();
}

// 左側工作區「單獨全螢幕」模式：靠 CSS 讓 #scanPaneBox 本身 position:fixed;inset:0 撐滿畫面，
// 標題列（undo/redo/focus）與畫布浮動列（工具/縮放）都物理上活在 #scanPaneBox 底下，
// 因此會被一起帶進全螢幕，不需要另外搬移或重新綁定事件。
function wireFocusMode(scanView) {
    const btn = el('btnFocusMode');
    const mainEl = document.getElementById('main-content');
    const icon = btn.querySelector('.ts-icon');

    function refit() {
        requestAnimationFrame(() => {
            window.dispatchEvent(new Event('resize'));
            scanView.fitToView();
        });
    }

    function setFocusMode(on) {
        mainEl.classList.toggle('is-focus-mode', on);
        btn.setAttribute('aria-pressed', String(on));
        const label = on ? '結束全螢幕工作區' : '切換全螢幕工作區';
        btn.setAttribute('aria-label', label);
        btn.title = label;
        icon.className = `ts-icon ${on ? 'is-compress-icon' : 'is-expand-icon'}`;
        refit();
    }

    btn.addEventListener('click', () => setFocusMode(!mainEl.classList.contains('is-focus-mode')));

    document.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape' && mainEl.classList.contains('is-focus-mode')) setFocusMode(false);
    });
}

function wireZoomControl(scanView) {
    const zoomDisplay = el('zoomDisplay');
    const zoomInput = el('zoomInput');
    let applying = false;
    let enabled = false;

    scanView.onZoomChange = (scale) => {
        const pct = Math.round(scale * 100);
        zoomDisplay.textContent = `${pct}%`;
        zoomDisplay.setAttribute('aria-label', `目前縮放 ${pct}%，按 Enter 可輸入數值`);
    };

    function setEnabled(next) {
        enabled = next;
        zoomDisplay.classList.toggle('is-disabled', !enabled);
        zoomDisplay.setAttribute('aria-disabled', String(!enabled));
        if (enabled) zoomDisplay.setAttribute('tabindex', '0');
        else zoomDisplay.removeAttribute('tabindex');
        zoomInput.disabled = !enabled;
    }
    setEnabled(false);

    function enterEdit() {
        if (!enabled) return;
        zoomInput.value = zoomDisplay.textContent.replace('%', '');
        zoomDisplay.style.display = 'none';
        zoomInput.style.display = '';
        zoomInput.focus();
        zoomInput.select();
    }

    function exitEdit(apply) {
        if (applying) return;
        applying = true;
        if (apply) {
            const val = Number(zoomInput.value.replace('%', '').trim());
            if (Number.isFinite(val) && val > 0) scanView.zoomTo(val / 100);
        }
        zoomInput.style.display = 'none';
        zoomDisplay.style.display = '';
        applying = false;
    }

    zoomDisplay.addEventListener('click', enterEdit);
    zoomDisplay.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
            evt.preventDefault();
            enterEdit();
        }
    });
    zoomInput.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter') {
            evt.preventDefault();
            exitEdit(true);
        } else if (evt.key === 'Escape') {
            evt.preventDefault();
            exitEdit(false);
        }
    });
    zoomInput.addEventListener('blur', () => exitEdit(true));

    return { setEnabled };
}

function addPiece(statusEl) {
    if (!store.activeScanId) return announce(statusEl, '請先匯入圖片');
    store.addPiece(store.activeScanId);
    announce(statusEl, '已新增物件，請框選範圍');
}

function wirePieceList(statusEl) {
    el('btnAddPiece').addEventListener('click', () => addPiece(statusEl));
}

// 同一個檔名底（不含副檔名）在批次匯出時可能撞名（例如多個「未命名物件」），加流水號避免互相覆蓋。
function uniqueBaseNameFactory() {
    const used = new Set();
    return function uniqueBaseName(base) {
        let name = base;
        let i = 2;
        while (used.has(name)) {
            name = `${base}-${i}`;
            i += 1;
        }
        used.add(name);
        return name;
    };
}

// 批次匯出全部物件：PNG、SVG 或兩者一起，一律打包成單一 ZIP 再下載——
// 物件一多的話逐檔跳出下載對話框既擾人、也容易被瀏覽器的多重下載限制擋掉。
async function exportAllBundle(kinds, statusEl, triggerBtn) {
    const pieces = store.project.pieces;
    if (!pieces.length) return announce(statusEl, '目前沒有任何物件可以匯出');

    triggerBtn.disabled = true;
    triggerBtn.classList.add('is-loading');
    const uniqueBaseName = uniqueBaseNameFactory();
    const entries = [];
    let skipped = 0;
    try {
        for (const piece of pieces) {
            const base = uniqueBaseName((piece.name || 'piece').trim() || 'piece');
            let pieceOk = false;
            if (kinds.includes('png')) {
                const blob = await exportPiecePNG(piece);
                if (blob) {
                    entries.push({ name: `${base}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
                    pieceOk = true;
                }
            }
            if (kinds.includes('svg')) {
                const blob = await exportPieceSVG(piece);
                if (blob) {
                    entries.push({ name: `${base}.svg`, data: new Uint8Array(await blob.arrayBuffer()) });
                    pieceOk = true;
                }
            }
            if (!pieceOk) skipped += 1;
        }
    } finally {
        triggerBtn.disabled = false;
        triggerBtn.classList.remove('is-loading');
    }

    if (!entries.length) return announce(statusEl, '沒有可匯出的物件（尚未設定選取範圍）');

    const zipBytes = zipWrite(entries);
    const blob = new Blob([zipBytes], { type: 'application/zip' });
    const suffix = kinds.length > 1 ? 'png-svg' : kinds[0];
    downloadBlob(blob, `${store.project.name || 'pitrace'}-${suffix}.zip`);
    const skipNote = skipped ? `，${skipped} 個物件因尚未設定選取範圍被跳過` : '';
    announce(statusEl, `已匯出 ${entries.length} 個檔案的 ZIP${skipNote}`);
}

// 物件清單標題列的「匯出全部」下拉選單：純 CSS 絕對定位 + hidden 屬性切換，不用原生 popover。
function wireExportAllMenu(statusEl) {
    const trigger = el('btnExportAll');
    const menu = el('exportAllMenu');
    if (!trigger || !menu) return;

    // #pieceListBox 在桌面版有 overflow:hidden（用來讓內部清單自己捲動、不撐爆版面），
    // 選單原本用 position:absolute 往下彈會被這層裁掉，跟浮動工具列那個 overflow 裁切
    // 是同一種病灶，所以同樣需要 portal:true。
    const { close, toggle } = wireDropdownToggle(trigger, menu, null, { portal: true });
    trigger.addEventListener('click', toggle);

    async function runAndClose(kinds) {
        close();
        await exportAllBundle(kinds, statusEl, trigger);
    }
    el('btnExportAllPNG').addEventListener('click', () => runAndClose(['png']));
    el('btnExportAllSVG').addEventListener('click', () => runAndClose(['svg']));
    el('btnExportAllZip').addEventListener('click', () => runAndClose(['png', 'svg']));

    function syncEnabled() {
        trigger.disabled = store.project.pieces.length === 0;
    }
    store.addEventListener('project-changed', syncEnabled);
    syncEnabled();
}

function wirePropertiesPanel(statusEl) {
    el('btnRotateLeft').addEventListener('click', () => {
        const piece = store.getActivePiece();
        if (!piece) return announce(statusEl, '請先選取物件');
        rotatePieceBy(piece.id, -90);
        announce(statusEl, `已向左旋轉，目前角度 ${piece.rotation}°`);
    });
    el('btnRotateRight').addEventListener('click', () => {
        const piece = store.getActivePiece();
        if (!piece) return announce(statusEl, '請先選取物件');
        rotatePieceBy(piece.id, 90);
        announce(statusEl, `已向右旋轉，目前角度 ${piece.rotation}°`);
    });
    const syncRotateButtons = () => {
        const hasPiece = !!store.getActivePiece();
        el('btnRotateLeft').disabled = !hasPiece;
        el('btnRotateRight').disabled = !hasPiece;
    };
    store.addEventListener('active-piece-changed', syncRotateButtons);
    syncRotateButtons();

    // 旋轉角度輸入框：直接輸入變更沿用既有的正規化寫法（-180~180 顯示值換算成 0~360 儲存值）；
    // ±1°/±15° 微調鈕與滾輪（見下方）共用同一個 applyRotation，全部改的是同一個 piece.rotation 欄位。
    function applyRotation(v) {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { rotation: ((v % 360) + 360) % 360 });
    }
    el('rotationValue').addEventListener('change', (evt) => {
        const n = Number(evt.target.value);
        if (!Number.isNaN(n)) applyRotation(n);
    });
    function nudgeRotation(delta, evt) {
        const piece = store.getActivePiece();
        if (!piece) return;
        const step = evt.shiftKey ? 15 : 1;
        const dispRotation = piece.rotation > 180 ? piece.rotation - 360 : piece.rotation;
        applyRotation(dispRotation + delta * step);
    }
    el('btnRotateMinus').addEventListener('click', (evt) => nudgeRotation(-1, evt));
    el('btnRotatePlus').addEventListener('click', (evt) => nudgeRotation(1, evt));
    // passive:false 是能呼叫 preventDefault() 阻止頁面隨滾輪捲動的必要條件。
    el('rotationValue').addEventListener('wheel', (evt) => {
        evt.preventDefault();
        nudgeRotation(evt.deltaY < 0 ? 1 : -1, evt);
    }, { passive: false });

    el('pieceNameInput').addEventListener('change', (evt) => {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { name: evt.target.value.trim() || '未命名物件' });
    });

    ['selX', 'selY', 'selW', 'selH'].forEach((id) => {
        el(id).addEventListener('change', () => {
            const piece = store.getActivePiece();
            if (!piece) return;
            const rect = {
                x: Number(el('selX').value) || 0,
                y: Number(el('selY').value) || 0,
                w: Math.max(1, Number(el('selW').value) || 1),
                h: Math.max(1, Number(el('selH').value) || 1),
            };
            store.updatePiece(piece.id, { selection: { type: 'rect', rect } });
        });
    });

    el('btnFlattenLasso').addEventListener('click', async () => {
        const piece = store.getActivePiece();
        if (!piece) return;
        const loops = loopsFromSelection(piece.selection);
        if (loops.length <= 1) return;
        const btn = el('btnFlattenLasso');
        // 平面化的點陣化＋描邊＋巢狀深度比對搬到 Worker 執行（見 selection-worker.js），
        // 這裡先切成忙碌狀態，避免使用者以為點擊沒反應；失敗時才需要手動還原 disabled，
        // 成功時交給 store 的 piece-changed → syncPropertiesPanel 依新的區塊數重新判斷。
        btn.disabled = true;
        btn.classList.add('is-loading');
        try {
            const flattened = await flattenLoopsAsync(loops);
            store.updatePiece(piece.id, { selection: { type: 'lasso', loops: flattened } });
            announce(statusEl, `已平面化選取，合併為 ${flattened.length} 個區塊`);
        } catch (err) {
            btn.disabled = false;
            announce(statusEl, '平面化失敗，請稍後再試');
        } finally {
            btn.classList.remove('is-loading');
        }
    });

    el('btnClearLasso').addEventListener('click', () => {
        const piece = store.getActivePiece();
        if (!piece || piece.selection.type !== 'lasso' || !piece.selection.loops?.length) return;
        store.updatePiece(piece.id, { selection: { type: 'lasso', loops: [] } });
        announce(statusEl, '已清除所有套索區塊');
    });

    el('btnClearErase').addEventListener('click', () => {
        const piece = store.getActivePiece();
        if (!piece || !piece.eraseStrokes?.length) return;
        store.updatePiece(piece.id, { eraseStrokes: [] });
        announce(statusEl, '已清除所有橡皮擦筆觸');
    });

    el('bgRemovalEnabled').addEventListener('change', (evt) => {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { bgRemoval: { ...piece.bgRemoval, enabled: evt.target.checked } });
        syncBgStrengthDisabledState(evt.target.checked);
    });

    ['bgSampleR', 'bgSampleG', 'bgSampleB'].forEach((id) => {
        el(id).addEventListener('change', () => {
            const piece = store.getActivePiece();
            if (!piece) return;
            const sampleColor = {
                r: Math.min(255, Math.max(0, Number(el('bgSampleR').value) || 0)),
                g: Math.min(255, Math.max(0, Number(el('bgSampleG').value) || 0)),
                b: Math.min(255, Math.max(0, Number(el('bgSampleB').value) || 0)),
            };
            store.updatePiece(piece.id, { bgRemoval: { ...piece.bgRemoval, sampleColor } });
        });
    });

    el('btnAutoSampleBg').addEventListener('click', async () => {
        const piece = store.getActivePiece();
        if (!piece) return announce(statusEl, '請先選取物件');
        const bitmap = await store.getScanBitmap(piece.scanId);
        const bounds = selectionBounds(piece);
        if (!bitmap || !bounds || bounds.w <= 0 || bounds.h <= 0) {
            return announce(statusEl, '請先設定選取範圍');
        }
        const x = Math.max(0, Math.round(bounds.x));
        const y = Math.max(0, Math.round(bounds.y));
        const w = Math.min(bitmap.width - x, Math.round(bounds.w));
        const h = Math.min(bitmap.height - y, Math.round(bounds.h));
        const c = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
        const cctx = c.getContext('2d');
        cctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
        const color = sampleBorderColor(cctx.getImageData(0, 0, w, h));
        store.updatePiece(piece.id, { bgRemoval: { ...piece.bgRemoval, sampleColor: color } });
        announce(statusEl, `已自動取樣背景色 RGB ${color.r}, ${color.g}, ${color.b}`);
    });

    bindRangeNumberPair('bgStrength', 'bgStrengthValue', (n) => {
        const piece = store.getActivePiece();
        if (!piece) return;
        // 手動拉動滑桿代表使用者要用新的單一強度模型取代舊專案帶進來的 threshold/softness
        // 手動調校值——不清掉的話 computeMask() 會繼續優先採用舊值，滑桿會變得像沒作用一樣。
        const bgRemoval = { ...piece.bgRemoval, strength: n };
        delete bgRemoval.threshold;
        delete bgRemoval.softness;
        store.updatePiece(piece.id, { bgRemoval });
    });

    bindRangeNumberPair('bgDespeckle', 'bgDespeckleValue', (n) => {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { bgRemoval: { ...piece.bgRemoval, despeckle: n } });
    });

    bindRangeNumberPair('bgStrokeEnhance', 'bgStrokeEnhanceValue', (n) => {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { bgRemoval: { ...piece.bgRemoval, strokeEnhance: n } });
    });

    el('svgVectorEnabled').addEventListener('change', (evt) => {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { svgExport: { ...piece.svgExport, enabled: evt.target.checked } });
    });

    bindRangeNumberPair('svgSimplify', 'svgSimplifyValue', (n) => {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { svgExport: { ...piece.svgExport, simplifyTolerance: n } });
    });

    el('scanDpiInput').addEventListener('change', (evt) => {
        const piece = store.getActivePiece();
        if (!piece) return;
        const raw = evt.target.value;
        store.setScanDpi(piece.scanId, raw ? Number(raw) : null);
    });

    el('btnExportPNG').addEventListener('click', async () => {
        const piece = store.getActivePiece();
        if (!piece) return announce(statusEl, '請先選取物件');
        const btnExportPNG = el('btnExportPNG');
        btnExportPNG.disabled = true;
        btnExportPNG.classList.add('is-loading');
        let blob;
        try {
            blob = await exportPiecePNG(piece);
        } finally {
            btnExportPNG.disabled = false;
            btnExportPNG.classList.remove('is-loading');
        }
        if (!blob) return announce(statusEl, '尚未設定選取範圍，無法匯出');
        const filename = `${(piece.name || 'piece').trim()}.png`;
        downloadBlob(blob, filename);
        announce(statusEl, `已匯出 ${filename}`);
    });

    el('btnExportSVG').addEventListener('click', async () => {
        const piece = store.getActivePiece();
        if (!piece) return announce(statusEl, '請先選取物件');
        const btnExportSVG = el('btnExportSVG');
        btnExportSVG.disabled = true;
        btnExportSVG.classList.add('is-loading');
        let blob;
        try {
            blob = await exportPieceSVG(piece);
        } finally {
            btnExportSVG.disabled = false;
            btnExportSVG.classList.remove('is-loading');
        }
        if (!blob) return announce(statusEl, '尚未設定選取範圍，無法匯出');
        const filename = `${(piece.name || 'piece').trim()}.svg`;
        downloadBlob(blob, filename);
        announce(statusEl, `已匯出 ${filename}`);
    });
}

function renderLassoLoopList(container, piece, statusEl) {
    container.innerHTML = '';
    const loops = piece.selection.loops || [];
    if (!loops.length) {
        const empty = document.createElement('div');
        empty.className = 'ts-text is-description';
        empty.textContent = '尚未繪製任何套索區塊，請在工作區拖曳滑鼠圈選';
        container.appendChild(empty);
        return;
    }
    loops.forEach((loop, i) => {
        const row = document.createElement('div');
        row.className = 'lasso-loop-row';

        const label = document.createElement('span');
        label.className = 'ts-text';
        const modeLabel = loop.mode === 'subtract' ? '減選' : '加選';
        label.textContent = `區塊 ${i + 1}（${modeLabel}・${loop.path.length} 個節點）`;
        row.appendChild(label);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'ts-button is-icon is-small';
        delBtn.setAttribute('aria-label', `刪除套索區塊 ${i + 1}`);
        delBtn.innerHTML = '<span class="ts-icon is-xmark-icon" aria-hidden="true"></span>';
        delBtn.addEventListener('click', () => {
            const next = loops.slice();
            next.splice(i, 1);
            store.updatePiece(piece.id, { selection: { type: 'lasso', loops: next } });
            announce(statusEl, `已刪除套索區塊 ${i + 1}`);
        });
        row.appendChild(delBtn);

        container.appendChild(row);
    });
}

// 去背關閉時去背強度／去除雜點／增強筆畫都完全沒有可見效果，一併停用避免使用者疑惑。
function syncBgStrengthDisabledState(bgRemovalEnabled) {
    const disabled = !bgRemovalEnabled;
    el('bgStrength').disabled = disabled;
    el('bgStrengthValue').disabled = disabled;
    el('bgDespeckle').disabled = disabled;
    el('bgDespeckleValue').disabled = disabled;
    el('bgStrokeEnhance').disabled = disabled;
    el('bgStrokeEnhanceValue').disabled = disabled;
}

function syncPropertiesPanel(statusEl) {
    const piece = store.getActivePiece();
    const emptyEl = el('propertiesEmptyState');
    if (!piece) {
        if (emptyEl) emptyEl.style.display = '';
        el('propertiesBody').style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    el('propertiesBody').style.display = '';

    el('pieceNameInput').value = piece.name;
    const dispRotation = Math.round((piece.rotation > 180 ? piece.rotation - 360 : piece.rotation) * 10) / 10;
    el('rotationValue').value = String(dispRotation);

    const isRect = piece.selection.type === 'rect';
    el('rectFieldsGroup').style.display = isRect ? '' : 'none';
    el('lassoFieldsGroup').style.display = isRect ? 'none' : '';

    if (isRect) {
        const r = piece.selection.rect;
        el('selX').value = r ? Math.round(r.x) : '';
        el('selY').value = r ? Math.round(r.y) : '';
        el('selW').value = r ? Math.round(r.w) : '';
        el('selH').value = r ? Math.round(r.h) : '';
    } else {
        renderLassoLoopList(el('lassoLoopList'), piece, statusEl);
        el('btnClearLasso').disabled = !piece.selection.loops?.length;
        el('btnFlattenLasso').disabled = (piece.selection.loops?.length ?? 0) <= 1;
    }

    el('eraseStrokeStatus').textContent = piece.eraseStrokes?.length ? '已標記擦除區域' : '尚未使用橡皮擦';
    el('btnClearErase').disabled = !piece.eraseStrokes?.length;

    el('bgRemovalEnabled').checked = piece.bgRemoval.enabled;
    syncBgStrengthDisabledState(piece.bgRemoval.enabled);
    el('bgSampleR').value = piece.bgRemoval.sampleColor.r;
    el('bgSampleG').value = piece.bgRemoval.sampleColor.g;
    el('bgSampleB').value = piece.bgRemoval.sampleColor.b;
    el('bgSampleSwatch').style.backgroundColor = `rgb(${piece.bgRemoval.sampleColor.r}, ${piece.bgRemoval.sampleColor.g}, ${piece.bgRemoval.sampleColor.b})`;
    el('bgStrength').value = piece.bgRemoval.strength ?? 50;
    el('bgStrengthValue').value = piece.bgRemoval.strength ?? 50;
    el('bgDespeckle').value = piece.bgRemoval.despeckle ?? 0;
    el('bgDespeckleValue').value = piece.bgRemoval.despeckle ?? 0;
    el('bgStrokeEnhance').value = piece.bgRemoval.strokeEnhance ?? 0;
    el('bgStrokeEnhanceValue').value = piece.bgRemoval.strokeEnhance ?? 0;

    el('svgVectorEnabled').checked = piece.svgExport?.enabled ?? false;
    el('svgSimplify').value = piece.svgExport?.simplifyTolerance ?? 0.75;
    el('svgSimplifyValue').value = piece.svgExport?.simplifyTolerance ?? 0.75;

    const scan = store.project.scans.find((s) => s.id === piece.scanId);
    el('scanDpiInput').value = scan?.dpi ?? '';
}
