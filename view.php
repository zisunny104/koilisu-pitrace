<!DOCTYPE html>
<html id="html" class="is-rounded" lang="zh-tw">

<?php
// 計算此應用展開後的 URL 基準路徑（例： /koilisu/apps/pitrace）
$appBasePath = rtrim(str_replace($_SERVER['DOCUMENT_ROOT'], '', __DIR__), '/\\');
$appBasePath = str_replace('\\', '/', $appBasePath);
$appConfig = require __DIR__ . '/config.php';
$appVersion = $appConfig['version'] ?? '0.0.0';
?>

<head>
    <meta charset="UTF-8">
    <title>Pitrace 拾印 - KoiLiSu | prjToka</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tocas-ui/5.7.0/tocas.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/tocas-ui/5.7.0/tocas.min.js"></script>

    <style type="text/css">
    body {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
    }

    .main-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    /* 內容區採 flex 直向撐滿可用視窗高度，避免視窗夠高時工作區底下留白、或視窗偏矮時底部列被切一截；
       只有雙視窗編輯區（.pane-row）真正吃掉剩餘空間，其餘列（工具列、清單、屬性面板）維持自身高度。 */
    #pageContainer {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    main#main-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    .pane-row {
        flex: 1;
        min-height: 0;
    }

    .pane-row > .column {
        display: flex;
        flex-direction: column;
    }

    .pane-row > .column > .ts-box {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    /* 無障礙：只在鍵盤聚焦時顯示的跳轉連結 */
    .skip-link {
        position: absolute;
        left: -9999px;
        top: 0;
        z-index: 10000;
        padding: 0.6rem 1rem;
        background: var(--ts-primary-600, #2563eb);
        color: #fff;
        border-radius: 0 0 8px 0;
        text-decoration: none;
    }

    .skip-link:focus {
        left: 0;
    }

    /* 視覺隱藏但螢幕報讀器可讀 */
    .visually-hidden {
        position: absolute !important;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }

    .pane-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        min-height: 3.5rem;
        padding: 0.6rem 1rem;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--ts-gray-600, #666);
        background: var(--ts-gray-100, #f2f2f2);
        border-bottom: 1px solid var(--ts-gray-300, #ddd);
        box-sizing: border-box;
    }

    .pane-card-header-title {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .pane-canvas-wrap {
        position: relative;
        flex: 1;
        min-height: 340px;
        overflow: hidden;
        background: #2b2b2b;
    }

    .pane-canvas-wrap.is-preview {
        background: #e8e8e8;
    }

    .pane-canvas-wrap canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        outline-offset: -2px;
    }

    .pane-canvas-wrap canvas:focus-visible {
        outline: 3px solid var(--ts-primary-500, #3b82f6);
    }

    .pane-empty-state,
    .pane-loading-state {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        text-align: center;
        padding: 1rem;
        pointer-events: none;
    }

    .pane-toolbar {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    /* 「匯入圖片」跟「專案」選單語意上是兩件事（前者匯入照片、後者管理整個專案檔），
       特意不用 .ts-buttons 黏在一起，避免看起來像同一顆按鈕的展開選單。 */
    .pane-toolbar-buttons {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    /* Tocas 的 .ts-selection 用 display:none 藏原生 radio、且完全沒有 focus-visible 樣式，
       導致鍵盤使用者連 Tab 進工具選取群組都做不到。改用可視覺隱藏但仍可聚焦的手法，
       並補上 focus-visible 外框，讓原生 radiogroup 方向鍵切換恢復作用。 */
    #mainToolbar [role="radiogroup"] input[type="radio"] {
        display: block;
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }

    #mainToolbar [role="radiogroup"] input[type="radio"]:focus-visible + .text {
        outline: 2px solid var(--ts-primary-700, #2563eb);
        outline-offset: 2px;
    }

    /* 左側工作區「單獨全螢幕」模式：畫布固定滿版，編輯工具列改為浮動於畫布上方，
       其餘區塊（專案列、預覽欄、物件清單、屬性面板）暫時隱藏，避免鍵盤 Tab 誤入不可見控制項。 */
    #main-content.is-focus-mode #projectToolbar,
    #main-content.is-focus-mode > .ts-divider,
    #main-content.is-focus-mode #previewPaneColumn,
    #main-content.is-focus-mode #pieceListBox,
    #main-content.is-focus-mode #propertiesPanel {
        display: none !important;
    }

    #main-content.is-focus-mode #scanPaneBox {
        position: fixed;
        inset: 0;
        z-index: 1000;
        margin: 0;
        border-radius: 0;
        display: flex;
        flex-direction: column;
    }

    #main-content.is-focus-mode #mainToolbar {
        position: fixed;
        top: 1rem;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1001;
        max-width: calc(100vw - 2rem);
        overflow-x: auto;
        background: var(--ts-gray-100, #f2f2f2);
        border: 1px solid var(--ts-gray-300, #ddd);
        border-radius: 12px;
        padding: 0.5rem 0.75rem;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    }

    .piece-thumb-strip {
        display: flex;
        gap: 0.75rem;
        overflow-x: auto;
        padding: 0.25rem 0.25rem 0.75rem;
    }

    .piece-thumb {
        flex-shrink: 0;
        width: 120px;
        border: 2px solid transparent;
        border-radius: 8px;
        padding: 0;
        background: var(--ts-gray-100, #f2f2f2);
        cursor: pointer;
        text-align: left;
        overflow: hidden;
    }

    .piece-thumb[aria-current="true"] {
        border-color: var(--ts-primary-500, #3b82f6);
    }

    .piece-thumb canvas,
    .piece-thumb .thumb-placeholder {
        width: 100%;
        height: 90px;
        object-fit: contain;
        background:
            linear-gradient(45deg, #d0d0d0 25%, transparent 25%, transparent 75%, #d0d0d0 75%) 0 0/12px 12px,
            linear-gradient(45deg, #d0d0d0 25%, #fff 25%, #fff 75%, #d0d0d0 75%) 6px 6px/12px 12px;
    }

    .piece-thumb canvas {
        display: block;
    }

    .piece-thumb .thumb-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .piece-thumb .thumb-label {
        display: block;
        padding: 0.35rem 0.5rem;
        font-size: 0.8rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .lasso-node-row {
        display: grid;
        grid-template-columns: auto 1fr 1fr auto;
        gap: 0.5rem;
        align-items: center;
        margin-bottom: 0.4rem;
    }

    .range-row {
        display: flex;
        align-items: center;
        gap: 0.6rem;
    }

    .range-row input[type="range"] {
        flex: 1;
    }

    .rgb-inputs {
        display: flex;
        gap: 0.5rem;
    }

    .rgb-inputs .ts-input {
        width: 5rem;
    }

    #statusRegion {
        min-height: 1.2em;
    }

    /* Tocas 沒有拖放區元件，這裡用最小自訂樣式做拖曳匯入圖片時的視覺回饋。 */
    #main-content.is-drag-target {
        outline: 3px dashed var(--ts-primary-500, #3b82f6);
        outline-offset: -3px;
        border-radius: 8px;
        background: var(--ts-primary-50, rgba(59, 130, 246, 0.06));
    }
    </style>
</head>

<body>
    <a href="#main-content" class="skip-link">跳到主要內容</a>

    <div class="main-content">
        <div class="ts-container has-vertically-padded" id="pageContainer">

            <!-- 標題 -->
            <div class="ts-grid is-middle-aligned">
                <div class="column is-fluid">
                    <div class="ts-header is-heavy is-large is-start-icon">
                        <span class="ts-icon is-file-image-icon" aria-hidden="true"></span>
                        Pitrace 拾印 <span
                            style="font-size:0.875rem;color:var(--ts-gray-500);font-weight:normal;margin-left:0.5rem;">v<?= htmlspecialchars($appVersion) ?></span>
                    </div>
                    <div class="ts-text is-secondary">
                        匯入圖片，去背、校正、匯出透明 PNG，全程本機處理不上傳。
                    </div>
                </div>
                <div class="column mobile:has-hidden tablet:has-hidden desktop:has-hidden">
                    <button id="btnToggleWidth" class="ts-button is-icon is-outlined" aria-label="使用完整頁面寬度"
                        title="使用完整頁面寬度" aria-pressed="false">
                        <span class="ts-icon is-arrows-left-right-icon" aria-hidden="true"></span>
                    </button>
                </div>
            </div>

            <div class="ts-divider has-vertically-spaced"></div>

            <main id="main-content">

                <!-- 專案操作列 -->
                <div class="pane-toolbar" role="toolbar" aria-label="專案操作" id="projectToolbar">
                    <div class="ts-grid is-middle-aligned mobile:is-stacked" style="flex:1 1 100%;">
                        <div class="column is-fluid">
                            <div class="ts-input is-underlined">
                                <input type="text" id="projectNameInput" value="未命名專案" aria-label="專案名稱">
                            </div>
                        </div>
                        <div class="column">
                            <div class="pane-toolbar-buttons">
                                <button id="btnImportImage" class="ts-button is-primary is-start-icon">
                                    <span class="ts-icon is-upload-icon" aria-hidden="true"></span>
                                    匯入圖片
                                </button>
                                <button class="ts-button is-outlined is-end-icon" data-dropdown="projectMenuDropdown">
                                    專案
                                    <span class="ts-icon is-chevron-down-icon" aria-hidden="true"></span>
                                </button>
                            </div>
                            <div class="ts-select" id="scanSelectWrap" style="display:none;">
                                <select id="scanSelect" aria-label="切換圖片"></select>
                            </div>
                        </div>
                    </div>
                    <input type="file" id="fileOpenProject" accept=".pitra" class="visually-hidden">
                    <input type="file" id="fileImportImage" accept="image/png,image/jpeg,image/webp" multiple
                        class="visually-hidden">
                </div>

                <!-- 專案選單下拉（放在 toolbar 外，避免干擾方向鍵巡覽） -->
                <div class="ts-dropdown" id="projectMenuDropdown">
                    <button id="btnNewProject" class="item">
                        <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                        新增專案
                    </button>
                    <button id="btnOpenProject" class="item">
                        <span class="ts-icon is-folder-open-icon" aria-hidden="true"></span>
                        開啟專案
                    </button>
                    <div class="divider"></div>
                    <button id="btnSaveProject" class="item">
                        <span class="ts-icon is-download-icon" aria-hidden="true"></span>
                        匯出專案
                    </button>
                </div>

                <div aria-live="polite" class="ts-text is-description visually-hidden" id="statusRegion"></div>

                <div class="ts-divider has-vertically-spaced-small"></div>

                <!-- 編輯工具列 -->
                <div class="pane-toolbar has-bottom-spaced-small" role="toolbar" aria-label="編輯工具" id="mainToolbar">
                    <div class="ts-selection is-compact" role="radiogroup" aria-label="選取工具">
                        <label class="item" title="矩形選取（M）">
                            <input type="radio" name="tool" value="rect" id="tool-rect" checked aria-label="矩形選取">
                            <div class="text"><span class="ts-icon is-crop-simple-icon" aria-hidden="true"></span>
                                <span class="mobile:has-hidden">矩形</span></div>
                        </label>
                        <label class="item" title="套索選取（L）">
                            <input type="radio" name="tool" value="lasso" id="tool-lasso" aria-label="套索選取">
                            <div class="text"><span class="ts-icon is-draw-polygon-icon" aria-hidden="true"></span>
                                <span class="mobile:has-hidden">套索</span></div>
                        </label>
                        <label class="item" title="平移（H）">
                            <input type="radio" name="tool" value="pan" id="tool-pan" aria-label="平移">
                            <div class="text"><span class="ts-icon is-hand-icon" aria-hidden="true"></span> <span
                                    class="mobile:has-hidden">平移</span></div>
                        </label>
                        <label class="item" title="取樣背景色（I）">
                            <input type="radio" name="tool" value="eyedropper" id="tool-eyedropper" aria-label="取樣背景色">
                            <div class="text"><span class="ts-icon is-eye-dropper-icon" aria-hidden="true"></span>
                                <span class="mobile:has-hidden">取樣背景色</span></div>
                        </label>
                    </div>

                    <div class="ts-buttons">
                        <button id="btnUndo" class="ts-button is-icon" aria-label="復原上一步" title="復原（Ctrl+Z）"
                            disabled>
                            <span class="ts-icon is-reply-icon" aria-hidden="true"></span>
                        </button>
                        <button id="btnRedo" class="ts-button is-icon" aria-label="重做" title="重做（Ctrl+Shift+Z）"
                            disabled>
                            <span class="ts-icon is-share-icon" aria-hidden="true"></span>
                        </button>
                    </div>

                    <div class="ts-buttons">
                        <button id="btnRotateLeft" class="ts-button is-icon" aria-label="向左旋轉 90 度"
                            title="向左旋轉 90 度">
                            <span class="ts-icon is-rotate-left-icon" aria-hidden="true"></span>
                        </button>
                        <button id="btnRotateRight" class="ts-button is-icon" aria-label="向右旋轉 90 度"
                            title="向右旋轉 90 度">
                            <span class="ts-icon is-rotate-right-icon" aria-hidden="true"></span>
                        </button>
                    </div>

                    <div class="ts-buttons">
                        <button id="btnZoomOut" class="ts-button is-icon" aria-label="縮小畫面" title="縮小畫面">
                            <span class="ts-icon is-magnifying-glass-minus-icon" aria-hidden="true"></span>
                        </button>
                        <span id="zoomDisplay" class="ts-button" role="button" tabindex="0"
                            aria-label="目前縮放 100%，按 Enter 可輸入數值">100%</span>
                        <input type="text" id="zoomInput" class="ts-button" inputmode="decimal"
                            aria-label="輸入縮放百分比" style="display:none;">
                        <button id="btnZoomIn" class="ts-button is-icon" aria-label="放大畫面" title="放大畫面">
                            <span class="ts-icon is-magnifying-glass-plus-icon" aria-hidden="true"></span>
                        </button>
                        <button id="btnZoomFit" class="ts-button is-icon" aria-label="縮放至符合視窗" title="縮放至符合視窗">
                            <span class="ts-icon is-expand-icon" aria-hidden="true"></span>
                        </button>
                        <button id="btnFullscreen" class="ts-button is-icon" aria-label="全螢幕檢視" title="全螢幕檢視"
                            aria-pressed="false">
                            <span class="ts-icon is-window-maximize-icon" aria-hidden="true"></span>
                        </button>
                    </div>
                </div>

                <!-- 雙視窗編輯區 -->
                <div class="ts-grid pane-row">
                    <div class="column desktop-:is-16-wide desktop+:is-9-wide">
                        <div class="ts-box is-raised" id="scanPaneBox">
                            <div class="pane-card-header">
                                <span class="pane-card-header-title">
                                    <span class="ts-icon is-image-icon" aria-hidden="true"></span>
                                    <span>工作區</span>
                                </span>
                                <button id="btnFocusMode" class="ts-button is-icon is-outlined" aria-label="切換全螢幕工作區"
                                    title="切換全螢幕工作區" aria-pressed="false">
                                    <span class="ts-icon is-expand-icon" aria-hidden="true"></span>
                                </button>
                            </div>
                            <div class="pane-canvas-wrap">
                                <canvas id="scanCanvas" tabindex="0" aria-label="工作區畫布，方向鍵平移、+/− 縮放、0 符合視窗"></canvas>
                                <div class="pane-empty-state" id="scanEmptyState">
                                    <span class="ts-icon is-images-icon is-heading" aria-hidden="true"></span>
                                    <div class="ts-text is-description">還沒有匯入圖片</div>
                                    <div class="ts-text is-description">點擊上方「匯入圖片」，或將圖片檔案拖曳到此區域</div>
                                </div>
                                <div class="pane-loading-state" id="scanLoadingState" style="display:none">
                                    <span class="ts-loading is-centered" aria-hidden="true"></span>
                                    <div class="ts-text is-description">圖片載入中…</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="column desktop-:is-16-wide desktop+:is-7-wide" id="previewPaneColumn">
                        <div class="ts-box is-raised">
                            <div class="pane-card-header">
                                <span class="pane-card-header-title">
                                    <span class="ts-icon is-wand-magic-sparkles-icon" aria-hidden="true"></span>
                                    <span>物件預覽</span>
                                </span>
                            </div>
                            <div class="pane-canvas-wrap is-preview">
                                <canvas id="previewCanvas" aria-label="目前物件的即時預覽，棋盤格代表透明區域"></canvas>
                                <div class="pane-empty-state" id="previewEmptyState">
                                    <span class="ts-icon is-crop-icon is-heading" aria-hidden="true"></span>
                                    <div class="ts-text is-description">還沒有可以預覽的選區呢</div>
                                    <div class="ts-text is-description">框選一個物件後會顯示在這裡</div>
                                </div>
                                <div class="pane-loading-state" id="previewLoadingState" style="display:none">
                                    <span class="ts-loading is-centered" aria-hidden="true"></span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 物件縮圖清單 -->
                <div class="ts-box is-raised has-top-spaced" id="pieceListBox">
                    <div class="ts-content is-padded is-dense">
                        <div class="ts-grid is-middle-aligned mobile:is-stacked">
                            <div class="column is-fluid">
                                <div class="ts-header is-start-icon">
                                    <span class="ts-icon is-layer-group-icon" aria-hidden="true"></span>
                                    物件清單
                                </div>
                            </div>
                            <div class="column mobile:has-top-spaced-small">
                                <button id="btnAddPiece" class="ts-button is-small is-outlined is-start-icon">
                                    <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                                    新增物件
                                </button>
                                <button id="btnDeletePiece" class="ts-button is-small is-outlined is-negative is-start-icon">
                                    <span class="ts-icon is-trash-icon" aria-hidden="true"></span>
                                    刪除物件
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="piece-thumb-strip" id="pieceList" role="list" aria-label="物件清單">
                        <!-- 動態生成 -->
                    </div>
                </div>

                <!-- 屬性面板 -->
                <div class="ts-box is-raised has-top-spaced" id="propertiesPanel">
                    <div class="ts-content is-padded">
                        <div class="ts-header is-start-icon">
                            <span class="ts-icon is-sliders-icon" aria-hidden="true"></span>
                            物件設定
                        </div>

                        <div id="propertiesEmptyState" class="ts-text is-description has-top-spaced">
                            請先按「新增物件」，再框選範圍
                        </div>

                        <div id="propertiesBody" style="display:none;">
                            <div class="ts-grid has-top-spaced">
                                <div class="column is-16-wide">
                                    <label class="ts-text is-label">物件名稱</label>
                                    <div class="ts-input is-fluid">
                                        <input type="text" id="pieceNameInput" aria-label="物件名稱">
                                    </div>
                                </div>
                            </div>

                            <div class="ts-text is-description has-top-spaced-small">
                                目前旋轉角度：<span id="rotationDisplay">0°</span>
                            </div>

                            <!-- 矩形精確調整 -->
                            <div id="rectFieldsGroup" class="has-top-spaced">
                                <div class="ts-text is-label">矩形選取（像素）</div>
                                <div class="ts-grid has-top-spaced-small">
                                    <div class="column is-4-wide">
                                        <label class="ts-text is-label" for="selX">X</label>
                                        <div class="ts-input is-fluid"><input type="number" id="selX"></div>
                                    </div>
                                    <div class="column is-4-wide">
                                        <label class="ts-text is-label" for="selY">Y</label>
                                        <div class="ts-input is-fluid"><input type="number" id="selY"></div>
                                    </div>
                                    <div class="column is-4-wide">
                                        <label class="ts-text is-label" for="selW">寬</label>
                                        <div class="ts-input is-fluid"><input type="number" id="selW" min="1"></div>
                                    </div>
                                    <div class="column is-4-wide">
                                        <label class="ts-text is-label" for="selH">高</label>
                                        <div class="ts-input is-fluid"><input type="number" id="selH" min="1"></div>
                                    </div>
                                </div>
                            </div>

                            <!-- 套索節點清單（無障礙／精確編輯） -->
                            <div id="lassoFieldsGroup" class="has-top-spaced" style="display:none;">
                                <div class="ts-text is-label">套索節點</div>
                                <div id="lassoNodeList" class="has-top-spaced-small"></div>
                                <div class="ts-wrap has-top-spaced-small">
                                    <button id="btnAddLassoNode" class="ts-button is-small is-outlined is-start-icon">
                                        <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                                        新增節點
                                    </button>
                                    <button id="btnCloseLassoPath" class="ts-button is-small is-outlined is-start-icon">
                                        <span class="ts-icon is-check-icon" aria-hidden="true"></span>
                                        封閉路徑
                                    </button>
                                </div>
                            </div>

                            <div class="ts-divider has-vertically-spaced"></div>

                            <div class="ts-header is-start-icon">
                                <span class="ts-icon is-palette-icon" aria-hidden="true"></span>
                                去背景
                            </div>

                            <label class="ts-checkbox has-top-spaced-small">
                                <input type="checkbox" id="bgRemovalEnabled" checked>
                                <div class="text">啟用去背景</div>
                            </label>

                            <div class="has-top-spaced-small">
                                <div class="ts-text is-label">背景取樣色（RGB）</div>
                                <div class="rgb-inputs has-top-spaced-small">
                                    <div class="ts-input"><input type="number" id="bgSampleR" min="0" max="255" aria-label="背景色 R"></div>
                                    <div class="ts-input"><input type="number" id="bgSampleG" min="0" max="255" aria-label="背景色 G"></div>
                                    <div class="ts-input"><input type="number" id="bgSampleB" min="0" max="255" aria-label="背景色 B"></div>
                                    <button id="btnAutoSampleBg" class="ts-button is-small is-outlined">自動取樣邊緣</button>
                                </div>
                            </div>

                            <div class="has-top-spaced">
                                <label class="ts-text is-label" for="bgThreshold">顏色距離門檻：<output id="bgThresholdValue">40</output></label>
                                <div class="range-row">
                                    <input type="range" id="bgThreshold" min="0" max="255" value="40">
                                </div>
                            </div>

                            <div class="has-top-spaced-small">
                                <label class="ts-text is-label" for="bgSoftness">邊緣柔化：<output id="bgSoftnessValue">24</output></label>
                                <div class="range-row">
                                    <input type="range" id="bgSoftness" min="1" max="120" value="24">
                                </div>
                            </div>

                            <div class="ts-divider has-vertically-spaced"></div>

                            <div class="ts-grid is-middle-aligned">
                                <div class="column is-fluid">
                                    <div class="ts-input is-fluid">
                                        <input type="text" id="exportFileName" placeholder="匯出檔名（不含副檔名）" aria-label="匯出檔名">
                                    </div>
                                </div>
                                <div class="column">
                                    <button id="btnExportPNG" class="ts-button is-positive is-start-icon">
                                        <span class="ts-icon is-download-icon" aria-hidden="true"></span>
                                        匯出 PNG
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

            </main>
        </div>
    </div>

    <!-- 開利手底部 -->
    <div class="ts-content is-secondary is-vertically-padded">
        <div class="ts-container">
            <div class="ts-grid">
                <div class="column is-fluid">
                    <div class="ts-text is-description">
                        <a href="/koilisu/" style="color: inherit; text-decoration: none;">KoiLiSu 開利手</a> -
                        讓工具使用更順手的開放專案 | prjToka
                    </div>
                    <div class="ts-text is-description">
                        Built with ❤️ using Tocas UI |
                        <a href="https://github.com/zisunny104/koilisu-pitrace" target="_blank"
                            style="display: inline-block; padding: 2px 8px; background: #24292f; color: white; text-decoration: none; border-radius: 6px; font-size: 0.85em; font-weight: 500; margin-left: 4px;">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"
                                style="vertical-align: text-bottom; margin-right: 4px;">
                                <path
                                    d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                            </svg>
                            View on GitHub
                        </a>
                    </div>
                </div>
                <div class="column is-end-aligned">
                    <div class="ts-selection is-circular is-compact">
                        <label class="item">
                            <input type="radio" name="theme" value="light" id="theme-light">
                            <div class="text">淺色</div>
                        </label>
                        <label class="item">
                            <input checked type="radio" name="theme" value="system" id="theme-system">
                            <div class="text">系統</div>
                        </label>
                        <label class="item">
                            <input type="radio" name="theme" value="dark" id="theme-dark">
                            <div class="text">深色</div>
                        </label>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script type="module" src="<?= $appBasePath ?>/js/main.js"></script>

    <script>
    // 深淺色模式功能
    function setTheme(theme) {
        document.getElementById('html').className = theme === 'system' ?
            'is-rounded' :
            `is-rounded is-${theme}`;
        document.cookie = `preferred-theme=${theme}; path=/; max-age=31536000`;
    }

    function getPreferredTheme() {
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'preferred-theme') {
                return value;
            }
        }
        return 'system';
    }

    document.addEventListener('DOMContentLoaded', function() {
        const preferredTheme = getPreferredTheme();
        const themeRadio = document.getElementById(`theme-${preferredTheme}`);
        if (themeRadio) {
            themeRadio.checked = true;
            setTheme(preferredTheme);
        }
    });

    document.getElementById('theme-light').addEventListener('change', function() {
        if (this.checked) setTheme('light');
    });
    document.getElementById('theme-dark').addEventListener('change', function() {
        if (this.checked) setTheme('dark');
    });
    document.getElementById('theme-system').addEventListener('change', function() {
        if (this.checked) setTheme('system');
    });

    // 大螢幕版面寬度切換（容器寬度 / 滿版寬度）
    function setWidthMode(mode) {
        const container = document.getElementById('pageContainer');
        const btn = document.getElementById('btnToggleWidth');
        const icon = btn.querySelector('.ts-icon');
        const isFluid = mode === 'fluid';
        container.classList.toggle('is-fluid', isFluid);
        btn.setAttribute('aria-pressed', String(isFluid));
        const label = isFluid ? '維持標準寬度' : '使用完整頁面寬度';
        btn.setAttribute('aria-label', label);
        btn.title = label;
        icon.className = `ts-icon ${isFluid ? 'is-arrows-left-right-to-line-icon' : 'is-arrows-left-right-icon'}`;
        document.cookie = `preferred-width=${mode}; path=/; max-age=31536000`;
    }

    function getPreferredWidth() {
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'preferred-width') return value;
        }
        return 'contained';
    }

    document.addEventListener('DOMContentLoaded', function() {
        setWidthMode(getPreferredWidth());
        document.getElementById('btnToggleWidth').addEventListener('click', function() {
            const nowFluid = document.getElementById('pageContainer').classList.contains('is-fluid');
            setWidthMode(nowFluid ? 'contained' : 'fluid');
        });
    });
    </script>
</body>

</html>
