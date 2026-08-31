// DOM 事件綁定：專案操作列、編輯工具列、作品清單按鈕、屬性面板（矩形/套索精確編輯、去背參數、輸出）。
// 資料一律經由 store 讀寫，畫面則訂閱 store 事件被動更新，不直接互相呼叫。

import { store, createEmptyProject } from '../state.js';
import { rotatePieceBy, selectionBounds } from '../tools/transform.js';
import { exportPiecePNG } from '../canvas/preview-pane.js';
import { serializeProject, parseProjectZip } from '../pitra-format.js';
import { sampleBorderColor } from '../processing/bg-remove.js';
import { announce } from '../a11y.js';

function el(id) {
    return document.getElementById(id);
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

async function importImageFiles(files, statusEl) {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    for (const file of imageFiles) {
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
    wireMainToolbar(scanView, statusEl);
    wirePieceList(statusEl);
    wirePropertiesPanel(statusEl);
    wireDragDropImport(statusEl);
    wireBelowFoldVisibility();

    store.addEventListener('active-piece-changed', () => syncPropertiesPanel(statusEl));
    store.addEventListener('piece-changed', () => syncPropertiesPanel(statusEl));
    syncPropertiesPanel(statusEl);
}

// 物件清單／屬性面板在還沒有任何圖片可用時沒有意義（新增物件、框選都無從做起），先隱藏以減少畫面雜訊。
function wireBelowFoldVisibility() {
    const pieceListBox = el('pieceListBox');
    const propertiesPanel = el('propertiesPanel');

    function sync() {
        const hasScan = store.project.scans.length > 0;
        pieceListBox.style.display = hasScan ? '' : 'none';
        propertiesPanel.style.display = hasScan ? '' : 'none';
    }

    store.addEventListener('project-changed', sync);
    store.addEventListener('scan-changed', sync);
    sync();
}

function wireProjectToolbar(statusEl) {
    const projectNameInput = el('projectNameInput');
    const scanSelectWrap = el('scanSelectWrap');
    const scanSelect = el('scanSelect');

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
        scanSelectWrap.style.display = scans.length > 1 ? '' : 'none';
    }

    scanSelect.addEventListener('change', () => store.setActiveScan(scanSelect.value));
    store.addEventListener('project-changed', syncScanSelect);
    store.addEventListener('scan-changed', () => {
        scanSelect.value = store.activeScanId ?? '';
    });
    syncScanSelect();

    el('btnNewProject').addEventListener('click', () => {
        const hasContent = store.project.scans.length > 0 || store.project.pieces.length > 0;
        if (hasContent && !window.confirm('目前的專案尚未儲存，確定要新增專案並捨棄目前內容？')) return;
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

    el('btnSaveProject').addEventListener('click', () => {
        const bytes = serializeProject(store.project);
        const blob = new Blob([bytes], { type: 'application/zip' });
        downloadBlob(blob, `${store.project.name || 'pitrace-project'}.pitra`);
        announce(statusEl, '已儲存 .pitra 專案檔');
    });

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

function wireMainToolbar(scanView, statusEl) {
    document.querySelectorAll('input[name="tool"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            if (radio.checked) store.setActiveTool(radio.value);
        });
    });

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

    wireFullscreenToggle();
    wireFocusMode(scanView);
}

// 左側工作區「單獨全螢幕」模式：畫布固定滿版，編輯工具列（#mainToolbar）改用 CSS 浮動於畫布上方
// （同一個 DOM 節點，只是視覺上抽離版面，不重新建立按鈕或事件監聽）。
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

function wireFullscreenToggle() {
    const btn = el('btnFullscreen');
    const target = document.getElementById('main-content');
    const icon = btn.querySelector('.ts-icon');

    btn.addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else target.requestFullscreen();
    });

    document.addEventListener('fullscreenchange', () => {
        const isFs = document.fullscreenElement === target;
        btn.setAttribute('aria-pressed', String(isFs));
        const label = isFs ? '結束全螢幕' : '全螢幕檢視';
        btn.setAttribute('aria-label', label);
        btn.title = label;
        icon.className = `ts-icon ${isFs ? 'is-compress-icon' : 'is-window-maximize-icon'}`;
    });
}

function wirePieceList(statusEl) {
    el('btnAddPiece').addEventListener('click', () => {
        if (!store.activeScanId) return announce(statusEl, '請先匯入圖片');
        store.addPiece(store.activeScanId);
        announce(statusEl, '已新增物件，請框選範圍');
    });

    el('btnDeletePiece').addEventListener('click', () => {
        const piece = store.getActivePiece();
        if (!piece) return announce(statusEl, '請先選取物件');
        if (!window.confirm(`確定要刪除物件「${piece.name}」？`)) return;
        store.deletePiece(piece.id);
        announce(statusEl, '已刪除物件');
    });
}

function wirePropertiesPanel(statusEl) {
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

    el('btnAddLassoNode').addEventListener('click', () => {
        const piece = store.getActivePiece();
        if (!piece) return;
        const path = piece.selection.type === 'lasso' && piece.selection.path ? piece.selection.path.slice() : [];
        const last = path[path.length - 1];
        path.push(last ? { x: last.x + 20, y: last.y + 20 } : { x: 50, y: 50 });
        store.updatePiece(piece.id, { selection: { type: 'lasso', path, closed: false } });
        announce(statusEl, `已新增節點，共 ${path.length} 個`);
    });

    el('btnCloseLassoPath').addEventListener('click', () => {
        const piece = store.getActivePiece();
        if (!piece || piece.selection.type !== 'lasso' || !piece.selection.path) return;
        if (piece.selection.path.length < 3) return announce(statusEl, '套索至少需要 3 個節點才能封閉路徑');
        store.updatePiece(piece.id, { selection: { ...piece.selection, closed: true } });
        announce(statusEl, '套索路徑已封閉');
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

    el('bgThreshold').addEventListener('input', () => {
        el('bgThresholdValue').textContent = el('bgThreshold').value;
    });
    el('bgThreshold').addEventListener('change', () => {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { bgRemoval: { ...piece.bgRemoval, threshold: Number(el('bgThreshold').value) } });
    });

    el('bgSoftness').addEventListener('input', () => {
        el('bgSoftnessValue').textContent = el('bgSoftness').value;
    });
    el('bgSoftness').addEventListener('change', () => {
        const piece = store.getActivePiece();
        if (!piece) return;
        store.updatePiece(piece.id, { bgRemoval: { ...piece.bgRemoval, softness: Number(el('bgSoftness').value) } });
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
        if (!blob) return announce(statusEl, '尚未設定選取範圍，無法輸出');
        const filename = `${(el('exportFileName').value || piece.name || 'piece').trim()}.png`;
        downloadBlob(blob, filename);
        announce(statusEl, `已輸出 ${filename}`);
    });
}

function renderLassoNodeList(container, piece, statusEl) {
    container.innerHTML = '';
    const path = piece.selection.path || [];
    path.forEach((node, i) => {
        const row = document.createElement('div');
        row.className = 'lasso-node-row';

        const idx = document.createElement('span');
        idx.className = 'ts-text is-description';
        idx.textContent = String(i + 1);
        row.appendChild(idx);

        const xWrap = document.createElement('div');
        xWrap.className = 'ts-input is-fluid';
        const xInput = document.createElement('input');
        xInput.type = 'number';
        xInput.value = Math.round(node.x);
        xInput.setAttribute('aria-label', `節點 ${i + 1} X 座標`);
        xInput.addEventListener('change', () => {
            const p = path.slice();
            p[i] = { ...p[i], x: Number(xInput.value) };
            store.updatePiece(piece.id, { selection: { type: 'lasso', path: p, closed: piece.selection.closed } });
        });
        xWrap.appendChild(xInput);
        row.appendChild(xWrap);

        const yWrap = document.createElement('div');
        yWrap.className = 'ts-input is-fluid';
        const yInput = document.createElement('input');
        yInput.type = 'number';
        yInput.value = Math.round(node.y);
        yInput.setAttribute('aria-label', `節點 ${i + 1} Y 座標`);
        yInput.addEventListener('change', () => {
            const p = path.slice();
            p[i] = { ...p[i], y: Number(yInput.value) };
            store.updatePiece(piece.id, { selection: { type: 'lasso', path: p, closed: piece.selection.closed } });
        });
        yWrap.appendChild(yInput);
        row.appendChild(yWrap);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'ts-button is-icon is-small';
        delBtn.setAttribute('aria-label', `刪除節點 ${i + 1}`);
        delBtn.innerHTML = '<span class="ts-icon is-xmark-icon" aria-hidden="true"></span>';
        delBtn.addEventListener('click', () => {
            const p = path.slice();
            p.splice(i, 1);
            store.updatePiece(piece.id, { selection: { type: 'lasso', path: p, closed: piece.selection.closed } });
            announce(statusEl, '已刪除節點');
        });
        row.appendChild(delBtn);

        container.appendChild(row);
    });
}

function syncPropertiesPanel(statusEl) {
    const piece = store.getActivePiece();
    const emptyState = el('propertiesEmptyState');
    const body = el('propertiesBody');

    if (!piece) {
        emptyState.style.display = '';
        body.style.display = 'none';
        return;
    }
    emptyState.style.display = 'none';
    body.style.display = '';

    el('pieceNameInput').value = piece.name;
    el('rotationDisplay').textContent = `${piece.rotation}°`;

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
        renderLassoNodeList(el('lassoNodeList'), piece, statusEl);
    }

    el('bgRemovalEnabled').checked = piece.bgRemoval.enabled;
    el('bgSampleR').value = piece.bgRemoval.sampleColor.r;
    el('bgSampleG').value = piece.bgRemoval.sampleColor.g;
    el('bgSampleB').value = piece.bgRemoval.sampleColor.b;
    el('bgThreshold').value = piece.bgRemoval.threshold;
    el('bgThresholdValue').textContent = piece.bgRemoval.threshold;
    el('bgSoftness').value = piece.bgRemoval.softness;
    el('bgSoftnessValue').textContent = piece.bgRemoval.softness;
    el('exportFileName').value = el('exportFileName').value || piece.name;
}
