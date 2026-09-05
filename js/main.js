// 進入點：建立畫布控制器與面板，綁定 UI 事件，套用工具列鍵盤巡覽。
// 所有實際邏輯都在各自模組內；這裡只負責組裝。

import { ScanView } from './canvas/scan-view.js';
import { PreviewPane } from './canvas/preview-pane.js';
import { ThumbnailStrip } from './ui/thumbnails.js';
import { wireUI } from './ui/toolbar.js';
import { wireResizableColumns } from './ui/resizable-columns.js';
import { makeToolbarArrowNav } from './a11y.js';
import { wireToolShortcuts } from './tools/shortcuts.js';
import { initAutosave } from './autosave.js';

const statusEl = document.getElementById('statusRegion');
const scanView = new ScanView(document.getElementById('scanCanvas'), statusEl);
new PreviewPane(document.getElementById('previewCanvas'), statusEl);
new ThumbnailStrip(document.getElementById('pieceList'), statusEl);

wireUI({ scanView, statusEl });
wireResizableColumns();
wireToolShortcuts(statusEl);
initAutosave(statusEl);

makeToolbarArrowNav(document.getElementById('projectToolbar'));
makeToolbarArrowNav(document.querySelector('.canvas-floating-toolbar'));
