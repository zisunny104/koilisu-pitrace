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

    .pane-card {
        border-radius: 12px;
    }

    .pane-card-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.6rem 1rem;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--ts-gray-600, #666);
        background: var(--ts-gray-100, #f2f2f2);
        border-bottom: 1px solid var(--ts-gray-300, #ddd);
    }

    .pane-canvas-wrap {
        position: relative;
        height: 58vh;
        min-height: 340px;
        overflow: hidden;
        background: #2b2b2b;
    }

    .pane-canvas-wrap.is-preview {
        background: #e8e8e8;
    }

    .pane-canvas-wrap canvas {
        display: block;
        width: 100%;
        height: 100%;
        outline-offset: -2px;
    }

    .pane-canvas-wrap canvas:focus-visible {
        outline: 3px solid var(--ts-primary-500, #3b82f6);
    }

    .pane-toolbar {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
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
        display: block;
        object-fit: contain;
        background:
            linear-gradient(45deg, #d0d0d0 25%, transparent 25%, transparent 75%, #d0d0d0 75%) 0 0/12px 12px,
            linear-gradient(45deg, #d0d0d0 25%, #fff 25%, #fff 75%, #d0d0d0 75%) 6px 6px/12px 12px;
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
    </style>
</head>

<body>
    <a href="#main-content" class="skip-link">跳到主要內容</a>

    <div class="main-content">
        <div class="ts-container has-vertically-padded">

            <!-- 標題 -->
            <div class="ts-header is-heavy is-large is-start-icon">
                <span class="ts-icon is-file-image-icon" aria-hidden="true"></span>
                Pitrace 拾印 <span
                    style="font-size:0.875rem;color:var(--ts-gray-500);font-weight:normal;margin-left:0.5rem;">v<?= htmlspecialchars($appVersion) ?></span>
            </div>
            <div class="ts-text is-secondary">
                掃描手繪稿，去背、校正、輸出透明 PNG，全程本機處理不上傳。
            </div>

            <div class="ts-divider has-vertically-spaced"></div>

            <main id="main-content">

                <!-- 專案操作列 -->
                <div class="pane-toolbar" role="toolbar" aria-label="專案操作" id="projectToolbar">
                    <button id="btnNewProject" class="ts-button is-outlined is-start-icon">
                        <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                        新增專案
                    </button>
                    <button id="btnOpenProject" class="ts-button is-outlined is-start-icon">
                        <span class="ts-icon is-folder-open-icon" aria-hidden="true"></span>
                        開啟專案
                    </button>
                    <button id="btnSaveProject" class="ts-button is-outlined is-start-icon">
                        <span class="ts-icon is-floppy-disk-icon" aria-hidden="true"></span>
                        儲存專案
                    </button>
                    <button id="btnImportImage" class="ts-button is-primary is-start-icon">
                        <span class="ts-icon is-upload-icon" aria-hidden="true"></span>
                        匯入圖片
                    </button>
                    <input type="file" id="fileOpenProject" accept=".pitra" class="visually-hidden">
                    <input type="file" id="fileImportImage" accept="image/png,image/jpeg,image/webp" multiple
                        class="visually-hidden">

                    <div class="ts-input is-underlined" style="min-width:12rem;">
                        <input type="text" id="projectNameInput" value="未命名專案" aria-label="專案名稱">
                    </div>

                    <div class="ts-select" id="scanSelectWrap" style="display:none;">
                        <select id="scanSelect" aria-label="切換掃描檔案"></select>
                    </div>
                </div>

                <div aria-live="polite" class="ts-text is-description visually-hidden" id="statusRegion"></div>

                <div class="ts-divider has-vertically-spaced-small"></div>

                <!-- 編輯工具列 -->
                <div class="pane-toolbar has-bottom-spaced-small" role="toolbar" aria-label="編輯工具" id="mainToolbar">
                    <div class="ts-selection is-compact" role="radiogroup" aria-label="選取工具">
                        <label class="item" title="矩形選取（M）">
                            <input type="radio" name="tool" value="rect" id="tool-rect" checked>
                            <div class="text"><span class="ts-icon is-vector-square-icon" aria-hidden="true"></span>
                                矩形</div>
                        </label>
                        <label class="item" title="套索選取（L）">
                            <input type="radio" name="tool" value="lasso" id="tool-lasso">
                            <div class="text"><span class="ts-icon is-draw-polygon-icon" aria-hidden="true"></span>
                                套索</div>
                        </label>
                        <label class="item" title="平移（H）">
                            <input type="radio" name="tool" value="pan" id="tool-pan">
                            <div class="text"><span class="ts-icon is-hand-icon" aria-hidden="true"></span> 平移</div>
                        </label>
                        <label class="item" title="取樣背景色（I）">
                            <input type="radio" name="tool" value="eyedropper" id="tool-eyedropper">
                            <div class="text"><span class="ts-icon is-eye-dropper-icon" aria-hidden="true"></span>
                                取樣背景色</div>
                        </label>
                    </div>

                    <button id="btnUndo" class="ts-button is-icon" aria-label="復原上一步" title="復原（Ctrl+Z）" disabled>
                        <span class="ts-icon is-arrow-rotate-left-icon" aria-hidden="true"></span>
                    </button>
                    <button id="btnRedo" class="ts-button is-icon" aria-label="重做" title="重做（Ctrl+Shift+Z）" disabled>
                        <span class="ts-icon is-arrow-rotate-right-icon" aria-hidden="true"></span>
                    </button>

                    <button id="btnRotateLeft" class="ts-button is-icon" aria-label="向左旋轉 90 度" title="向左旋轉 90 度">
                        <span class="ts-icon is-rotate-left-icon" aria-hidden="true"></span>
                    </button>
                    <button id="btnRotateRight" class="ts-button is-icon" aria-label="向右旋轉 90 度" title="向右旋轉 90 度">
                        <span class="ts-icon is-rotate-right-icon" aria-hidden="true"></span>
                    </button>

                    <button id="btnZoomOut" class="ts-button is-icon" aria-label="縮小畫面" title="縮小畫面">
                        <span class="ts-icon is-magnifying-glass-minus-icon" aria-hidden="true"></span>
                    </button>
                    <span class="ts-text is-description" id="zoomDisplay" style="min-width:3.5rem;text-align:center;">100%</span>
                    <button id="btnZoomIn" class="ts-button is-icon" aria-label="放大畫面" title="放大畫面">
                        <span class="ts-icon is-magnifying-glass-plus-icon" aria-hidden="true"></span>
                    </button>
                    <button id="btnZoomFit" class="ts-button is-icon" aria-label="縮放至符合視窗" title="縮放至符合視窗">
                        <span class="ts-icon is-expand-icon" aria-hidden="true"></span>
                    </button>
                </div>

                <!-- 雙視窗編輯區 -->
                <div class="ts-grid is-relaxed">
                    <div class="column desktop-:is-16-wide desktop+:is-9-wide">
                        <div class="ts-box is-raised pane-card">
                            <div class="pane-card-header">
                                <span class="ts-icon is-image-icon" aria-hidden="true"></span>
                                <span>原始掃描</span>
                            </div>
                            <div class="pane-canvas-wrap">
                                <canvas id="scanCanvas" tabindex="0" aria-label="原始掃描畫布，方向鍵平移、+/− 縮放、0 符合視窗"></canvas>
                            </div>
                        </div>
                    </div>

                    <div class="column desktop-:is-16-wide desktop+:is-7-wide">
                        <div class="ts-box is-raised pane-card">
                            <div class="pane-card-header">
                                <span class="ts-icon is-wand-magic-sparkles-icon" aria-hidden="true"></span>
                                <span>即時預覽</span>
                            </div>
                            <div class="pane-canvas-wrap is-preview">
                                <canvas id="previewCanvas" aria-label="目前作品的即時預覽，棋盤格代表透明區域"></canvas>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 作品縮圖清單 -->
                <div class="ts-box is-raised has-top-spaced">
                    <div class="ts-content is-padded is-dense">
                        <div class="ts-grid is-middle-aligned">
                            <div class="column is-fluid">
                                <div class="ts-header is-start-icon">
                                    <span class="ts-icon is-layer-group-icon" aria-hidden="true"></span>
                                    作品清單
                                </div>
                            </div>
                            <div class="column">
                                <button id="btnAddPiece" class="ts-button is-small is-outlined is-start-icon">
                                    <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                                    新增作品
                                </button>
                                <button id="btnDeletePiece" class="ts-button is-small is-outlined is-negative is-start-icon">
                                    <span class="ts-icon is-trash-icon" aria-hidden="true"></span>
                                    刪除作品
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="piece-thumb-strip" id="pieceList" role="list" aria-label="作品清單">
                        <!-- 動態生成 -->
                    </div>
                </div>

                <!-- 屬性面板 -->
                <div class="ts-box is-raised has-top-spaced" id="propertiesPanel">
                    <div class="ts-content is-padded">
                        <div class="ts-header is-start-icon">
                            <span class="ts-icon is-sliders-icon" aria-hidden="true"></span>
                            作品設定
                        </div>

                        <div id="propertiesEmptyState" class="ts-text is-description has-top-spaced">
                            請先按「新增作品」，再框選範圍
                        </div>

                        <div id="propertiesBody" style="display:none;">
                            <div class="ts-grid has-top-spaced">
                                <div class="column is-16-wide">
                                    <label class="ts-text is-label">作品名稱</label>
                                    <div class="ts-input is-fluid">
                                        <input type="text" id="pieceNameInput" aria-label="作品名稱">
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
                                        <input type="text" id="exportFileName" placeholder="輸出檔名（不含副檔名）" aria-label="輸出檔名">
                                    </div>
                                </div>
                                <div class="column">
                                    <button id="btnExportPNG" class="ts-button is-positive is-start-icon">
                                        <span class="ts-icon is-download-icon" aria-hidden="true"></span>
                                        輸出 PNG
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
    </script>
</body>

</html>
