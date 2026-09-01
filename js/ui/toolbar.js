// DOM 事件綁定：專案操作列、編輯工具列、作品清單按鈕、屬性面板（矩形/套索精確編輯、去背參數、輸出）。
// 資料一律經由 store 讀寫，畫面則訂閱 store 事件被動更新，不直接互相呼叫。

import { store, createEmptyProject } from '../state.js';
import { rotatePieceBy, selectionBounds } from '../tools/transform.js';
import { exportPiecePNG, exportPieceSVG } from '../canvas/preview-pane.js';
import { serializeProject, parseProjectZip } from '../pitra-format.js';
import { zipWrite } from '../pitra-zip.js';
import { sampleBorderColor } from '../processing/bg-remove.js';
import { announce } from '../a11y.js';

function el(id) {
    return document.getElementById(id);
}

// 讓 range 滑桿與旁邊的數字輸入框互相同步：拖曳滑桿即時反映到數字框，
// 放開/變更才寫回 store；打數字框則反過來即時同步滑桿，blur/Enter 時夾在 min~max 內寫回 store。
function bindRangeNumberPair(rangeId, numberId, apply) {
    const range = el(rangeId);
    const number = el(numberId);
    const min = Number(range.min);
    const max = Number(range.max);

    range.addEventListener('input', () => {
        number.value = range.value;
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
        await store.addScan({ filename: file.name, mime: file.type, bytes: buf, width, height });
    }
    if (imageFiles.length) announce(statusEl, `已匯入 ${imageFiles.length} 張圖片`);
    else if (files.length) announce(statusEl, '未找到可匯入的圖片檔案');
    return imageFiles.length;
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
        if (files.length) await importImageFiles(files, statusEl);
    });
}

export function wireUI({ scanView, statusEl }) {
    wireProjectToolbar(statusEl);
    wireScanPaneHeader(scanView, statusEl);
    wireCanvasFloatingToolbar(scanView);
    wirePieceList(statusEl);
    wireExportAllMenu(statusEl);
    wirePropertiesPanel(statusEl);
    wireDragDropImport(statusEl);
    wirePreviewBackground();

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

function wireProjectToolbar(statusEl) {
    const projectNameInput = el('projectNameInput');
    const scanSelectWrap = el('scanSelectWrap');
    const scanSelectInnerWrap = el('scanSelectInnerWrap');
    const scanSelect = el('scanSelect');
    const btnRemoveScan = el('btnRemoveScan');

    projectNameInput.addEventListener('change', () => {
        store.project.name = projectNameInput.value.trim() || '未命名專案';
    });

    function syncScanSelect() {
        const scans = store.project.scans;
        scanSelect.innerHTML = '';
        for (const scan of scans) {
            const opt = document.createElement('option');
            opt.value = scan.id;
            opt.textContent = scan.filename;
            scanSelect.appendChild(opt);
        }
        scanSelect.value = store.activeScanId ?? '';
        // 下拉選單只有多張圖片時才需要切換；移除按鈕只要有目前使用中的圖片就該在，
        // 就算專案只有一張掃描圖，使用者也該能把它移除以釋放記憶體。
        scanSelectInnerWrap.style.display = scans.length > 1 ? '' : 'none';
        scanSelectWrap.style.display = scans.length > 0 ? '' : 'none';
    }

    scanSelect.addEventListener('change', () => store.setActiveScan(scanSelect.value));
    store.addEventListener('project-changed', syncScanSelect);
    store.addEventListener('scan-changed', () => {
        scanSelect.value = store.activeScanId ?? '';
    });
    syncScanSelect();

    btnRemoveScan.addEventListener('click', () => {
        const scan = store.getActiveScan();
        if (!scan) return;
        const affected = store.project.pieces.filter((p) => p.scanId === scan.id).length;
        const warning = affected > 0
            ? `確定要移除圖片「${scan.filename}」？將一併刪除 ${affected} 個引用此圖片的物件，此操作無法復原。`
            : `確定要移除圖片「${scan.filename}」？此操作無法復原。`;
        if (!window.confirm(warning)) return;
        store.removeScan(scan.id);
        announce(statusEl, `已移除圖片 ${scan.filename}`);
    });

    el('btnNewProject').addEventListener('click', () => {
        const hasContent = store.project.scans.length > 0 || store.project.pieces.length > 0;
        if (hasContent && !window.confirm('目前的專案尚未匯出，確定要新增專案並捨棄目前內容？')) return;
        store.setProject(createEmptyProject());
        projectNameInput.value = '未命名專案';
        announce(statusEl, '已新增專案');
    });

    const fileOpenProject = el('fileOpenProject');
    el('btnOpenProject').addEventListener('click', () => fileOpenProject.click());
    fileOpenProject.addEventListener('change', async (evt) => {
        const file = evt.target.files?.[0];
        evt.target.value = '';
        if (!file) return;
        announce(statusEl, '開啟專案中…');
        try {
            const buf = await file.arrayBuffer();
            const project = parseProjectZip(buf);
            store.setProject(project);
            projectNameInput.value = project.name;
            announce(statusEl, `已開啟專案「${project.name}」`);
        } catch (err) {
            announce(statusEl, `開啟失敗：${err.message}`);
        }
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
    btnImportImage.addEventListener('click', () => fileImportImage.click());
    fileImportImage.addEventListener('change', async (evt) => {
        const files = Array.from(evt.target.files || []);
        evt.target.value = '';
        if (!files.length) return;
        btnImportImage.disabled = true;
        btnImportImage.classList.add('is-loading');
        try {
            await importImageFiles(files, statusEl);
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

// 畫布內下方置中的浮動工具列：工具選取 + 縮放。
function wireCanvasFloatingToolbar(scanView) {
    document.querySelectorAll('input[name="tool"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            if (radio.checked) store.setActiveTool(radio.value);
        });
    });

    const zoomControl = wireZoomControl(scanView);
    el('btnZoomOut').addEventListener('click', () => scanView.zoomBy(1 / 1.2));
    el('btnZoomIn').addEventListener('click', () => scanView.zoomBy(1.2));
    el('btnZoomFit').addEventListener('click', () => scanView.fitToView());
    const syncCanvasControls = () => {
        const hasScan = !!store.getActiveScan();
        el('btnZoomOut').disabled = !hasScan;
        el('btnZoomIn').disabled = !hasScan;
        el('btnZoomFit').disabled = !hasScan;
        zoomControl.setEnabled(hasScan);
    };
    store.addEventListener('scan-changed', syncCanvasControls);
    syncCanvasControls();
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

function wirePieceList(statusEl) {
    el('btnAddPiece').addEventListener('click', () => {
        if (!store.activeScanId) return announce(statusEl, '請先匯入圖片');
        store.addPiece(store.activeScanId);
        announce(statusEl, '已新增物件，請框選範圍');
    });
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

    function close() {
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    }
    function open() {
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
    }
    trigger.addEventListener('click', () => {
        if (menu.hidden) open(); else close();
    });
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

    bindRangeNumberPair('rotationRange', 'rotationValue', (v) => {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { rotation: ((v % 360) + 360) % 360 });
    });

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

    el('btnClearLasso').addEventListener('click', () => {
        const piece = store.getActivePiece();
        if (!piece || piece.selection.type !== 'lasso' || !piece.selection.loops?.length) return;
        store.updatePiece(piece.id, { selection: { type: 'lasso', loops: [] } });
        announce(statusEl, '已清除所有套索區塊');
    });

    bindRangeNumberPair('enhanceContrast', 'enhanceContrastValue', (n) => {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { enhance: { ...piece.enhance, contrast: n } });
    });

    bindRangeNumberPair('enhanceBrightness', 'enhanceBrightnessValue', (n) => {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { enhance: { ...piece.enhance, brightness: n } });
    });

    el('bgRemovalEnabled').addEventListener('change', (evt) => {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { bgRemoval: { ...piece.bgRemoval, enabled: evt.target.checked } });
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

    bindRangeNumberPair('bgThreshold', 'bgThresholdValue', (n) => {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { bgRemoval: { ...piece.bgRemoval, threshold: n } });
    });

    bindRangeNumberPair('bgSoftness', 'bgSoftnessValue', (n) => {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { bgRemoval: { ...piece.bgRemoval, softness: n } });
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
    el('rotationRange').value = String(dispRotation);
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
    }

    el('enhanceContrast').value = piece.enhance?.contrast ?? 0;
    el('enhanceContrastValue').value = piece.enhance?.contrast ?? 0;
    el('enhanceBrightness').value = piece.enhance?.brightness ?? 0;
    el('enhanceBrightnessValue').value = piece.enhance?.brightness ?? 0;

    el('bgRemovalEnabled').checked = piece.bgRemoval.enabled;
    el('bgSampleR').value = piece.bgRemoval.sampleColor.r;
    el('bgSampleG').value = piece.bgRemoval.sampleColor.g;
    el('bgSampleB').value = piece.bgRemoval.sampleColor.b;
    el('bgSampleSwatch').style.backgroundColor = `rgb(${piece.bgRemoval.sampleColor.r}, ${piece.bgRemoval.sampleColor.g}, ${piece.bgRemoval.sampleColor.b})`;
    el('bgThreshold').value = piece.bgRemoval.threshold;
    el('bgThresholdValue').value = piece.bgRemoval.threshold;
    el('bgSoftness').value = piece.bgRemoval.softness;
    el('bgSoftnessValue').value = piece.bgRemoval.softness;

    el('svgVectorEnabled').checked = piece.svgExport?.enabled ?? false;
    el('svgSimplify').value = piece.svgExport?.simplifyTolerance ?? 0.75;
    el('svgSimplifyValue').value = piece.svgExport?.simplifyTolerance ?? 0.75;
}
