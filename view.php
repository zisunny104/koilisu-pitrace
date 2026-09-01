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
       只有編輯器主體（.editor-shell）真正吃掉剩餘空間，其餘列（工具列）維持自身高度。 */
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

    :root {
        --pitrace-dock-width: 380px;
        --pitrace-list-width: 200px;
    }

    /* 編輯器主體（左側物件清單 + 中央畫布 + 右側預覽／設定 dock）。
       Mobile/Tablet（<1024px）：單欄堆疊，維持整頁捲動的今日行為，DOM 順序＝畫布→物件清單→dock。
       Desktop+（≥1024px）：三欄並排，左右兩欄固定寬度、中央畫布吃滿剩餘空間；
       用 order 把左欄視覺移到最前面，不用改 DOM 順序（維持手機堆疊時「先看畫布」的順序）。
       右側 dock 內部兩個面板（物件預覽／物件設定）各自捲動，不需要捲動整頁。 */
    .editor-shell {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        gap: 1rem;
    }

    #editorDock {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    #scanPaneBox,
    #previewPaneBox,
    #pieceListSidebar {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    @media (min-width: 1024px) {
        /* 頁尾是 .main-content 的 flex 手足、同樣掛在 body 底下——如果把 100vh 鎖在 body 上，
           兩者會競爬同一個高度，頁尾沒辦法被推到視窗外。改鎖在 .main-content 自己身上：
           body 恢復自然高度，頁尾落在 .main-content 之後正常往下排、要捲動才看得到；
           .main-content 內部既有的 flex 收縮鏈（min-height:0 一路往下）依然有這個有界高度可以依據，
           dock 面板的 overflow-y:auto 不受影響。
           注意：基礎規則的 flex:1（flex-basis:0%）會讓 flex-grow 演算法接管高度、蓋掉 height，
           變成「內容多高就長多高」——跟原本錨在 body 上時同一種失效模式。這裡要连同 flex 一起覆寫成
           flex:none，讓 height:100vh 以一般區塊盒模型生效，不再被 flex-grow 決定。 */
        .main-content {
            flex: none;
            height: 100vh;
        }

        /* 寬版模式：把固定 100vh 的錨點再往下移一層到 main#main-content 本身，
           讓標題區塊跟頁尾一樣「需要捲動才看得到」——.main-content／#pageContainer
           改回依內容自然撐高（標題+分隔線的高度 + main 的 100vh），總高度超出一個視窗，
           body 因此變高、可捲動，原理跟上面頁尾能被捲到完全一樣，只是這次換成標題。 */
        .main-content.is-fluid {
            flex: 1;
            height: auto;
        }

        .main-content.is-fluid main#main-content {
            flex: none;
            height: 100vh;
        }

        .editor-shell {
            flex-direction: row;
        }

        #pieceListSidebar {
            flex: 0 0 var(--pitrace-list-width);
            width: var(--pitrace-list-width);
            min-height: 0;
            overflow: hidden;
            order: 1;
        }

        #scanPaneBox {
            min-width: 0;
            order: 2;
        }

        #editorDock {
            flex: 0 0 var(--pitrace-dock-width);
            width: var(--pitrace-dock-width);
            min-height: 0;
            overflow: hidden;
            order: 3;
        }

        #previewPaneBox {
            flex: 0 0 auto;
        }

        #previewPaneBox .pane-canvas-wrap {
            flex: none;
            min-height: 0;
            height: 220px;
        }

        /* 左欄只有 pieceListBox 一個面板，直接吃滿 #pieceListSidebar 整欄高度；
           自己要是 flex column，#pieceList 的 flex:1/min-height:0 才有依據可縮。 */
        #pieceListBox {
            flex: 1 1 auto;
            min-height: 140px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        /* 桌面版欄位較窄，改採單欄直向清單（取代手機版的橫向捲動 strip），
           避免縮圖用 auto-fill 網格塞進窄欄位時最後一列數量對不齊、看起來跑版。 */
        #pieceList {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            padding: 0.5rem;
        }

        #pieceList .piece-thumb {
            width: 100%;
        }

        /* 物件設定不再是 popover，改成跟 previewPaneBox 一樣的固定面板，
           吃掉 dock 讓出來的剩餘高度、內部自己捲動。 */
        #propertiesPanel {
            flex: 1 1 auto;
            min-height: 160px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        #propertiesPanelBody {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
        }
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
        min-height: 1.75rem;
        padding: 0.2rem 0.6rem;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--ts-gray-600, #666);
        background: var(--ts-gray-100, #f2f2f2);
        border-bottom: 1px solid var(--ts-gray-300, #ddd);
        box-sizing: border-box;
    }

    /* 標題列裡的圖示按鈕沿用 Tocas .is-small（32px）還是偏高，蓋掉 --height 縮到跟標題列文字更貼近。 */
    .pane-card-header .ts-button.is-icon {
        --height: 1.5rem;
        --icon-size: 1rem;
    }

    .pane-card-header-title {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .pane-canvas-wrap {
        position: relative;
        flex: 1;
        min-height: 340px;
        overflow: hidden;
        background: #2b2b2b;
    }

    /* 預覽底色：預設棋盤格才看得出透明範圍，另外提供純黑／純白／灰三種切換，
       方便針對淺色或深色去背結果分別檢查邊緣有沒有殘留的背景色。 */
    .pane-canvas-wrap.is-preview.bg-checker {
        background:
            linear-gradient(45deg, #d0d0d0 25%, transparent 25%, transparent 75%, #d0d0d0 75%) 0 0/16px 16px,
            linear-gradient(45deg, #d0d0d0 25%, #fff 25%, #fff 75%, #d0d0d0 75%) 8px 8px/16px 16px;
    }

    .pane-canvas-wrap.is-preview.bg-black {
        background: #1a1a1a;
    }

    .pane-canvas-wrap.is-preview.bg-white {
        background: #fff;
    }

    .pane-canvas-wrap.is-preview.bg-gray {
        /* 跟面板標題列用同一組 Tocas 灰階變數，深色主題才會一起跟著變暗。 */
        background: var(--ts-gray-200, #e8e8e8);
    }

    /* 還沒選取物件時一律強制灰底，不管目前記住的底色偏好是哪一種：棋盤格在「根本沒有內容」
       時看起來像是在暗示有透明範圍，容易誤導。等選到物件後才恢復顯示使用者選擇的底色
       （靠 CSS 來源順序：這條規則排在四個 bg-* 之後，同層級 class 數比大小時後到者赢）。 */
    .pane-canvas-wrap.is-preview.is-empty {
        background: var(--ts-gray-200, #e8e8e8);
    }

    /* 不套 Tocas .ts-selection：那個元件每個選項都是一個帶內距、圓角、底色的「按鈕」，
       四個色塊擠在標題列裡會多一層視覺噪音。這裡直接排緊湊的色塊列，選取狀態靠外框表示。 */
    .preview-bg-toggle {
        display: flex;
        align-items: center;
        gap: 0.3rem;
    }

    .preview-bg-toggle-item {
        display: flex;
        cursor: pointer;
    }

    .preview-bg-swatch {
        display: block;
        width: 14px;
        height: 14px;
        border-radius: 3px;
        border: 1px solid var(--ts-gray-400, #bbb);
        box-sizing: border-box;
    }

    .preview-bg-toggle-item input:checked + .preview-bg-swatch {
        outline: 2px solid var(--ts-primary-700, #2563eb);
        outline-offset: 1px;
    }

    .preview-bg-swatch.is-checker {
        background:
            linear-gradient(45deg, #d0d0d0 25%, transparent 25%, transparent 75%, #d0d0d0 75%) 0 0/8px 8px,
            linear-gradient(45deg, #d0d0d0 25%, #fff 25%, #fff 75%, #d0d0d0 75%) 4px 4px/8px 8px;
    }

    .preview-bg-swatch.is-black {
        background: #1a1a1a;
    }

    .preview-bg-swatch.is-white {
        background: #fff;
    }

    .preview-bg-swatch.is-gray {
        background: var(--ts-gray-400, #999);
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

    /* 依目前工具切換游標樣式（見 scan-view.js 的 _updateCursorClass）：
       套索加/減選用十字＋色塊角標（藍色＋／紅色－）辨識目前是加選還是減選；
       橡皮擦改用 cursor:none，實際筆刷範圍改由 canvas 疊圖即時畫出（見 eraser.js drawOverlay），
       因為 CSS 游標圖是螢幕固定尺寸，沒辦法反映縮放後筆刷實際涵蓋的影像範圍。 */
    #scanCanvas.cursor-crosshair {
        cursor: crosshair;
    }

    #scanCanvas.cursor-lasso-add {
        cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Cg stroke='%23000' stroke-width='3' stroke-linecap='round'%3E%3Cline x1='16' y1='3' x2='16' y2='12'/%3E%3Cline x1='16' y1='20' x2='16' y2='29'/%3E%3Cline x1='3' y1='16' x2='12' y2='16'/%3E%3Cline x1='20' y1='16' x2='29' y2='16'/%3E%3C/g%3E%3Cg stroke='%23fff' stroke-width='1.2' stroke-linecap='round'%3E%3Cline x1='16' y1='3' x2='16' y2='12'/%3E%3Cline x1='16' y1='20' x2='16' y2='29'/%3E%3Cline x1='3' y1='16' x2='12' y2='16'/%3E%3Cline x1='20' y1='16' x2='29' y2='16'/%3E%3C/g%3E%3Ccircle cx='24' cy='24' r='6.5' fill='%233b82f6' stroke='%23fff' stroke-width='1.5'/%3E%3Cline x1='24' y1='21.5' x2='24' y2='26.5' stroke='%23fff' stroke-width='1.6' stroke-linecap='round'/%3E%3Cline x1='21.5' y1='24' x2='26.5' y2='24' stroke='%23fff' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") 16 16, crosshair;
    }

    #scanCanvas.cursor-lasso-subtract {
        cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Cg stroke='%23000' stroke-width='3' stroke-linecap='round'%3E%3Cline x1='16' y1='3' x2='16' y2='12'/%3E%3Cline x1='16' y1='20' x2='16' y2='29'/%3E%3Cline x1='3' y1='16' x2='12' y2='16'/%3E%3Cline x1='20' y1='16' x2='29' y2='16'/%3E%3C/g%3E%3Cg stroke='%23fff' stroke-width='1.2' stroke-linecap='round'%3E%3Cline x1='16' y1='3' x2='16' y2='12'/%3E%3Cline x1='16' y1='20' x2='16' y2='29'/%3E%3Cline x1='3' y1='16' x2='12' y2='16'/%3E%3Cline x1='20' y1='16' x2='29' y2='16'/%3E%3C/g%3E%3Ccircle cx='24' cy='24' r='6.5' fill='%23ef4444' stroke='%23fff' stroke-width='1.5'/%3E%3Cline x1='21.5' y1='24' x2='26.5' y2='24' stroke='%23fff' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") 16 16, crosshair;
    }

    #scanCanvas.cursor-eraser {
        cursor: none;
    }

    #scanCanvas.cursor-pan,
    #scanCanvas.is-pan-armed {
        cursor: grab;
    }

    /* 畫布內下方置中的浮動工具列（工具選取＋縮放）。比照 focus-mode 舊有浮動列的 pill 樣式。 */
    .canvas-floating-toolbar {
        position: absolute;
        bottom: 1rem;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10;
        max-width: calc(100% - 2rem);
        overflow-x: auto;
        background: var(--ts-gray-100, #f2f2f2);
        border: 1px solid var(--ts-gray-300, #ddd);
        border-radius: 12px;
        padding: 0.5rem 0.75rem;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
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

    /* 浮動工具列已經靠 overflow-x:auto 處理擠不下的情況（見上面 .canvas-floating-toolbar），
       不能再讓 .pane-toolbar 的 flex-wrap:wrap 生效，否則兩種「擠不下」的因應方式會打架
       （換行造成的高度增加、又被 overflow-x 的捲軸邏輯裁切）。寬度夠時維持單行，
       真的放不下就交給既有的橫向捲動，而不是換成兩行。 */
    .canvas-floating-toolbar.pane-toolbar {
        flex-wrap: nowrap;
    }

    /* #pieceList 沒有明確尺寸的父層可依附，不能沿用 .pane-empty-state 的絕對定位手法，
       改走一般文件流置中。 */
    .piece-list-empty-state,
    .pane-empty-state-static {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        text-align: center;
        padding: 1.5rem 1rem;
    }

    /* 「匯入圖片」跟「專案」選單語意上是兩件事（前者匯入照片、後者管理整個專案檔），
       特意不用 .ts-buttons 黏在一起，避免看起來像同一顆按鈕的展開選單。 */
    .pane-toolbar-buttons {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        /* #scanPaneBox 是 .ts-box，Tocas 對它套用 overflow:hidden（做圓角裁切）；標題列預設不換行，
           寬度不夠時原本是右側的按鈕群組（含全螢幕切換）被無聲裁掉、視覺上「消失」而非還在只是換行。
           固定不縮，讓左邊的標題（見 .pane-card-header-title 的 ellipsis）先被壓縮/截斷。 */
        flex-shrink: 0;
    }

    /* 「匯出全部」下拉選單：不用原生 popover（top-layer 定位在不同瀏覽器間不夠穩定），
       改用相對定位容器 + JS 切換 hidden，跟畫布浮動工具列同一手法自己控制位置。 */
    .pane-menu-wrap {
        position: relative;
        display: inline-flex;
    }

    .pane-dropdown-menu {
        position: absolute;
        top: calc(100% + 0.4rem);
        right: 0;
        z-index: 20;
        min-width: 14rem;
        background: var(--ts-gray-50, #fff);
        border: 1px solid var(--ts-gray-300, #ddd);
        border-radius: var(--ts-border-radius-container, 8px);
        box-shadow: var(--ts-elevated-shadow, 0 8px 24px rgba(0, 0, 0, 0.2));
        padding: 0.3rem;
    }

    .pane-dropdown-menu[hidden] {
        display: none;
    }

    .pane-dropdown-menu .item {
        border-radius: var(--ts-border-radius-secondary, 6px);
        white-space: nowrap;
        cursor: pointer;
    }

    /* Tocas 的 .ts-selection 用 display:none 藏原生 radio、且完全沒有 focus-visible 樣式，
       導致鍵盤使用者連 Tab 進工具選取群組都做不到。改用可視覺隱藏但仍可聚焦的手法，
       並補上 focus-visible 外框，讓原生 radiogroup 方向鍵切換恢復作用。
       不限定在 .ts-selection 底下，套用到頁面上所有 [role="radiogroup"] 結構
       （浮動工具列的選取工具、預覽底色切換……），才不用每加一組就複製一次規則；
       focus-visible 外框也用 + * 抓緊鄰的下一個元素，不管它實際 class 是什麼。 */
    [role="radiogroup"] input[type="radio"] {
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

    [role="radiogroup"] input[type="radio"]:focus-visible + * {
        outline: 2px solid var(--ts-primary-700, #2563eb);
        outline-offset: 2px;
    }

    /* 左側工作區「單獨全螢幕」模式：畫布固定滿版，編輯工具列改為浮動於畫布上方，
       其餘區塊（專案列、預覽欄、物件清單、屬性面板）暫時隱藏，避免鍵盤 Tab 誤入不可見控制項。 */
    #main-content.is-focus-mode #projectToolbar,
    #main-content.is-focus-mode > .ts-divider,
    #main-content.is-focus-mode #editorDock,
    #main-content.is-focus-mode #pieceListSidebar {
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

    .piece-thumb-strip {
        display: flex;
        gap: 0.75rem;
        overflow-x: auto;
        padding: 0.25rem 0.25rem 0.75rem;
    }

    .piece-thumb-item {
        position: relative;
        flex-shrink: 0;
    }

    .piece-thumb {
        width: 120px;
        border: 2px solid transparent;
        border-radius: 8px;
        padding: 0;
        background: var(--ts-gray-100, #f2f2f2);
        cursor: pointer;
        text-align: left;
        overflow: hidden;
    }

    .piece-thumb-delete {
        position: absolute;
        top: 0.3rem;
        right: 0.3rem;
        opacity: 0;
        transition: opacity 0.1s;
    }

    .piece-thumb-item:hover .piece-thumb-delete,
    .piece-thumb-item:focus-within .piece-thumb-delete {
        opacity: 1;
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
        display: flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.35rem 0.5rem;
        font-size: 0.8rem;
    }

    .piece-thumb .thumb-color-dot {
        flex-shrink: 0;
        width: 8px;
        height: 8px;
        border-radius: 50%;
    }

    .piece-thumb .thumb-label-text {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .lasso-loop-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0.5rem;
        align-items: center;
        margin-bottom: 0.4rem;
    }

    .range-row {
        display: flex;
        align-items: center;
        gap: 0.6rem;
    }

    .range-row .ts-range {
        flex: 1;
    }

    .range-row .ts-input {
        width: 4.5rem;
        flex: none;
    }

    .rgb-inputs {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
    }

    .rgb-inputs .ts-input {
        width: 5rem;
    }

    .bg-sample-swatch {
        width: 2rem;
        height: 2rem;
        border-radius: 4px;
        border: 1px solid var(--ts-gray-300, #ddd);
        flex: none;
        background: #fff;
    }

    #statusRegion {
        min-height: 1.2em;
    }

    /* Tocas 的 ts-snackbar 只提供膠囊樣式，定位／淡入淡出／自動消失都需要自己接上，
       這裡讓它固定在畫面下方置中，作為 announce() 狀態訊息的可視化版本。 */
    .pitrace-snackbar {
        position: fixed;
        left: 50%;
        bottom: 1.5rem;
        transform: translate(-50%, 0.5rem);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease, transform 0.2s ease;
        z-index: 1000;
        max-width: calc(100vw - 2rem);
    }

    .pitrace-snackbar.is-shown {
        opacity: 1;
        transform: translate(-50%, 0);
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
                            <div class="pane-toolbar-buttons" id="scanSelectWrap" style="display:none;">
                                <div class="ts-select" id="scanSelectInnerWrap" style="display:none;">
                                    <select id="scanSelect" aria-label="切換圖片"></select>
                                </div>
                                <button id="btnRemoveScan" class="ts-button is-icon is-small is-negative"
                                    aria-label="移除目前圖片" title="移除目前圖片">
                                    <span class="ts-icon is-trash-icon" aria-hidden="true"></span>
                                </button>
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

                <!-- 編輯器主體：左側物件清單 + 中央畫布 + 右側預覽/設定 dock（桌面以上固定側欄；平板/手機退回堆疊） -->
                <div class="editor-shell" id="editorShell">
                    <div class="ts-box is-raised" id="scanPaneBox">
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-image-icon" aria-hidden="true"></span>
                                <span>工作區</span>
                            </span>
                            <div class="pane-toolbar-buttons">
                                <div class="ts-buttons">
                                    <button id="btnUndo" class="ts-button is-icon is-small is-ghost" aria-label="復原上一步"
                                        title="復原（Ctrl+Z）" disabled>
                                        <span class="ts-icon is-reply-icon" aria-hidden="true"></span>
                                    </button>
                                    <button id="btnRedo" class="ts-button is-icon is-small is-ghost" aria-label="重做"
                                        title="重做（Ctrl+Shift+Z）" disabled>
                                        <span class="ts-icon is-share-icon" aria-hidden="true"></span>
                                    </button>
                                </div>
                                <button id="btnFocusMode" class="ts-button is-icon is-small is-ghost" aria-label="切換全螢幕工作區"
                                    title="切換全螢幕工作區" aria-pressed="false">
                                    <span class="ts-icon is-expand-icon" aria-hidden="true"></span>
                                </button>
                            </div>
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
                            <div class="canvas-floating-toolbar pane-toolbar" role="toolbar" aria-label="編輯工具">
                                <div class="ts-selection is-compact" role="radiogroup" aria-label="選取工具">
                                    <label class="item" data-tooltip="矩形選取（M）">
                                        <input type="radio" name="tool" value="rect" id="tool-rect" checked aria-label="矩形選取">
                                        <div class="text"><span class="ts-icon is-crop-simple-icon" aria-hidden="true"></span>
                                            <span class="has-hidden">矩形</span></div>
                                    </label>
                                    <label class="item" data-tooltip="套索選取（L）">
                                        <input type="radio" name="tool" value="lasso" id="tool-lasso" aria-label="套索選取">
                                        <div class="text"><span class="ts-icon is-draw-polygon-icon" aria-hidden="true"></span>
                                            <span class="has-hidden">套索</span></div>
                                    </label>
                                    <label class="item" data-tooltip="平移（H）">
                                        <input type="radio" name="tool" value="pan" id="tool-pan" aria-label="平移">
                                        <div class="text"><span class="ts-icon is-hand-icon" aria-hidden="true"></span> <span
                                                class="has-hidden">平移</span></div>
                                    </label>
                                    <label class="item" data-tooltip="取樣背景色（I）">
                                        <input type="radio" name="tool" value="eyedropper" id="tool-eyedropper" aria-label="取樣背景色">
                                        <div class="text"><span class="ts-icon is-eye-dropper-icon" aria-hidden="true"></span>
                                            <span class="has-hidden">取樣背景色</span></div>
                                    </label>
                                    <label class="item" data-tooltip="橡皮擦（E）">
                                        <input type="radio" name="tool" value="eraser" id="tool-eraser" aria-label="橡皮擦">
                                        <div class="text"><span class="ts-icon is-eraser-icon" aria-hidden="true"></span>
                                            <span class="has-hidden">橡皮擦</span></div>
                                    </label>
                                </div>

                                <div class="ts-buttons">
                                    <button id="btnZoomOut" class="ts-button is-icon" aria-label="縮小畫面" data-tooltip="縮小畫面">
                                        <span class="ts-icon is-magnifying-glass-minus-icon" aria-hidden="true"></span>
                                    </button>
                                    <span id="zoomDisplay" class="ts-button" role="button" tabindex="0"
                                        aria-label="目前縮放 100%，按 Enter 可輸入數值">100%</span>
                                    <input type="text" id="zoomInput" class="ts-button" inputmode="decimal"
                                        aria-label="輸入縮放百分比" style="display:none;">
                                    <button id="btnZoomIn" class="ts-button is-icon" aria-label="放大畫面" data-tooltip="放大畫面">
                                        <span class="ts-icon is-magnifying-glass-plus-icon" aria-hidden="true"></span>
                                    </button>
                                    <button id="btnZoomFit" class="ts-button is-icon" aria-label="縮放至符合視窗" data-tooltip="縮放至符合視窗">
                                        <span class="ts-icon is-expand-icon" aria-hidden="true"></span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 物件縮圖清單：獨立左欄，桌面版直向排列；不再跟預覽/設定擠在同一個右側 dock。 -->
                    <aside class="editor-list" id="pieceListSidebar" aria-label="物件清單">
                        <div class="ts-box is-raised" id="pieceListBox">
                            <div class="pane-card-header">
                                <span class="pane-card-header-title">
                                    <span class="ts-icon is-layer-group-icon" aria-hidden="true"></span>
                                    <span>物件清單</span>
                                </span>
                                <div class="pane-toolbar-buttons">
                                    <div class="pane-menu-wrap">
                                        <button id="btnExportAll" class="ts-button is-icon is-small is-ghost"
                                            aria-label="匯出全部物件" title="匯出全部物件"
                                            aria-haspopup="menu" aria-expanded="false">
                                            <span class="ts-icon is-file-export-icon" aria-hidden="true"></span>
                                        </button>
                                        <div class="ts-menu pane-dropdown-menu" id="exportAllMenu" role="menu"
                                            aria-label="匯出全部物件" hidden>
                                            <button type="button" class="item" role="menuitem" id="btnExportAllPNG">
                                                <span class="ts-icon is-file-image-icon" aria-hidden="true"></span>
                                                <span>全部匯出為 PNG</span>
                                            </button>
                                            <button type="button" class="item" role="menuitem" id="btnExportAllSVG">
                                                <span class="ts-icon is-bezier-curve-icon" aria-hidden="true"></span>
                                                <span>全部匯出為 SVG</span>
                                            </button>
                                            <button type="button" class="item" role="menuitem" id="btnExportAllZip">
                                                <span class="ts-icon is-file-zipper-icon" aria-hidden="true"></span>
                                                <span>全部匯出 PNG + SVG（ZIP）</span>
                                            </button>
                                        </div>
                                    </div>
                                    <button id="btnAddPiece" class="ts-button is-icon is-small is-ghost"
                                        aria-label="新增物件" title="新增物件">
                                        <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                                    </button>
                                </div>
                            </div>
                            <div class="piece-thumb-strip" id="pieceList" role="list" aria-label="物件清單">
                                <!-- 動態生成 -->
                            </div>
                        </div>
                    </aside>

                    <aside class="editor-dock" id="editorDock" aria-label="物件預覽與設定">
                        <div class="ts-box is-raised" id="previewPaneBox">
                            <div class="pane-card-header">
                                <span class="pane-card-header-title">
                                    <span class="ts-icon is-wand-magic-sparkles-icon" aria-hidden="true"></span>
                                    <span>物件預覽</span>
                                </span>
                                <div class="preview-bg-toggle" role="radiogroup" aria-label="預覽底色">
                                    <label class="preview-bg-toggle-item" data-tooltip="棋盤格底">
                                        <input type="radio" name="previewBg" value="checker" id="previewBg-checker" checked aria-label="棋盤格底">
                                        <span class="preview-bg-swatch is-checker" aria-hidden="true"></span>
                                    </label>
                                    <label class="preview-bg-toggle-item" data-tooltip="黑底">
                                        <input type="radio" name="previewBg" value="black" id="previewBg-black" aria-label="黑底">
                                        <span class="preview-bg-swatch is-black" aria-hidden="true"></span>
                                    </label>
                                    <label class="preview-bg-toggle-item" data-tooltip="白底">
                                        <input type="radio" name="previewBg" value="white" id="previewBg-white" aria-label="白底">
                                        <span class="preview-bg-swatch is-white" aria-hidden="true"></span>
                                    </label>
                                    <label class="preview-bg-toggle-item" data-tooltip="灰底">
                                        <input type="radio" name="previewBg" value="gray" id="previewBg-gray" aria-label="灰底">
                                        <span class="preview-bg-swatch is-gray" aria-hidden="true"></span>
                                    </label>
                                </div>
                            </div>
                            <div class="pane-canvas-wrap is-preview bg-checker" id="previewCanvasWrap">
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

                        <div class="ts-box is-raised" id="propertiesPanel">
                            <div class="pane-card-header">
                                <span class="pane-card-header-title">
                                    <span class="ts-icon is-sliders-icon" aria-hidden="true"></span>
                                    <span>物件設定</span>
                                </span>
                            </div>
                            <div class="ts-content is-padded" id="propertiesPanelBody">
                            <div class="pane-empty-state-static" id="propertiesEmptyState">
                                <span class="ts-icon is-sliders-icon is-heading" aria-hidden="true"></span>
                                <div class="ts-text is-description">尚未選取物件</div>
                                <div class="ts-text is-description">請先在左側清單選取一個物件</div>
                            </div>

                        <div id="propertiesBody" style="display:none;">
                            <div class="ts-grid is-middle-aligned">
                                <div class="column is-fluid">
                                    <label class="ts-text is-label" for="rotationRange">旋轉角度</label>
                                </div>
                                <div class="column">
                                    <div class="ts-buttons">
                                        <button id="btnRotateLeft" class="ts-button is-icon is-small" aria-label="向左旋轉 90 度"
                                            data-tooltip="向左旋轉 90 度">
                                            <span class="ts-icon is-rotate-left-icon" aria-hidden="true"></span>
                                        </button>
                                        <button id="btnRotateRight" class="ts-button is-icon is-small" aria-label="向右旋轉 90 度"
                                            data-tooltip="向右旋轉 90 度">
                                            <span class="ts-icon is-rotate-right-icon" aria-hidden="true"></span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="has-top-spaced-small">
                                <div class="range-row">
                                    <div class="ts-range"><input type="range" id="rotationRange" min="-180" max="180" step="0.1" value="0"></div>
                                    <div class="ts-input"><input type="number" id="rotationValue" min="-180" max="180" step="any" value="0" aria-label="旋轉角度數值（度）"></div>
                                </div>
                            </div>

                            <div class="ts-grid has-top-spaced">
                                <div class="column is-16-wide">
                                    <label class="ts-text is-label">物件名稱</label>
                                    <div class="ts-input is-fluid">
                                        <input type="text" id="pieceNameInput" aria-label="物件名稱">
                                    </div>
                                </div>
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

                            <!-- 套索區塊清單（無障礙／精確編輯） -->
                            <div id="lassoFieldsGroup" class="has-top-spaced" style="display:none;">
                                <div class="ts-text is-label">套索區塊</div>
                                <div id="lassoLoopList" class="has-top-spaced-small"></div>
                                <div class="ts-wrap has-top-spaced-small">
                                    <button id="btnClearLasso" class="ts-button is-small is-outlined is-negative is-start-icon">
                                        <span class="ts-icon is-trash-icon" aria-hidden="true"></span>
                                        清除套索
                                    </button>
                                </div>
                            </div>

                            <div class="ts-divider has-vertically-spaced"></div>

                            <div class="ts-header is-start-icon">
                                <span class="ts-icon is-sun-icon" aria-hidden="true"></span>
                                影像增強
                            </div>

                            <div class="has-top-spaced-small">
                                <label class="ts-text is-label" for="enhanceContrast">對比度</label>
                                <div class="range-row">
                                    <div class="ts-range"><input type="range" id="enhanceContrast" min="-100" max="100" value="0"></div>
                                    <div class="ts-input"><input type="number" id="enhanceContrastValue" min="-100" max="100" value="0" aria-label="對比度數值"></div>
                                </div>
                            </div>

                            <div class="has-top-spaced-small">
                                <label class="ts-text is-label" for="enhanceBrightness">亮度</label>
                                <div class="range-row">
                                    <div class="ts-range"><input type="range" id="enhanceBrightness" min="-100" max="100" value="0"></div>
                                    <div class="ts-input"><input type="number" id="enhanceBrightnessValue" min="-100" max="100" value="0" aria-label="亮度數值"></div>
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
                                    <div id="bgSampleSwatch" class="bg-sample-swatch" aria-hidden="true"></div>
                                    <div class="ts-input"><input type="number" id="bgSampleR" min="0" max="255" aria-label="背景色 R"></div>
                                    <div class="ts-input"><input type="number" id="bgSampleG" min="0" max="255" aria-label="背景色 G"></div>
                                    <div class="ts-input"><input type="number" id="bgSampleB" min="0" max="255" aria-label="背景色 B"></div>
                                    <button id="btnAutoSampleBg" class="ts-button is-small is-outlined">自動取樣邊緣</button>
                                </div>
                            </div>

                            <div class="has-top-spaced">
                                <label class="ts-text is-label" for="bgThreshold">顏色距離門檻</label>
                                <div class="range-row">
                                    <div class="ts-range"><input type="range" id="bgThreshold" min="0" max="255" value="40"></div>
                                    <div class="ts-input"><input type="number" id="bgThresholdValue" min="0" max="255" value="40" aria-label="顏色距離門檻數值"></div>
                                </div>
                            </div>

                            <div class="has-top-spaced-small">
                                <label class="ts-text is-label" for="bgSoftness">邊緣柔化</label>
                                <div class="range-row">
                                    <div class="ts-range"><input type="range" id="bgSoftness" min="1" max="120" value="24"></div>
                                    <div class="ts-input"><input type="number" id="bgSoftnessValue" min="1" max="120" value="24" aria-label="邊緣柔化數值"></div>
                                </div>
                            </div>

                            <div class="ts-divider has-vertically-spaced"></div>

                            <div class="ts-header is-start-icon">
                                <span class="ts-icon is-bezier-curve-icon" aria-hidden="true"></span>
                                向量預覽
                            </div>

                            <label class="ts-checkbox has-top-spaced-small">
                                <input type="checkbox" id="svgVectorEnabled">
                                <div class="text">啟用向量預覽（SVG 全黑向量描邊）</div>
                            </label>

                            <div class="has-top-spaced-small">
                                <label class="ts-text is-label" for="svgSimplify">簡化程度</label>
                                <div class="range-row">
                                    <div class="ts-range"><input type="range" id="svgSimplify" min="0" max="3" step="0.1" value="0.75"></div>
                                    <div class="ts-input"><input type="number" id="svgSimplifyValue" min="0" max="3" step="0.1" value="0.75" aria-label="簡化程度數值"></div>
                                </div>
                                <div class="has-top-spaced-small ts-text is-description" id="svgNodeCount"></div>
                            </div>

                            <div class="ts-divider has-vertically-spaced"></div>

                            <div class="ts-buttons">
                                <button id="btnExportPNG" class="ts-button is-positive is-start-icon">
                                    <span class="ts-icon is-download-icon" aria-hidden="true"></span>
                                    匯出 PNG
                                </button>
                                <button id="btnExportSVG" class="ts-button is-positive is-start-icon">
                                    <span class="ts-icon is-download-icon" aria-hidden="true"></span>
                                    匯出 SVG
                                </button>
                            </div>
                        </div>
                        </div>
                        </div>
                    </aside>
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
        document.querySelector('.main-content').classList.toggle('is-fluid', isFluid);
        btn.setAttribute('aria-pressed', String(isFluid));
        const label = isFluid ? '維持標準寬度' : '使用完整頁面寬度';
        btn.setAttribute('aria-label', label);
        btn.title = label;
        icon.className = `ts-icon ${isFluid ? 'is-arrows-left-right-to-line-icon' : 'is-arrows-left-right-icon'}`;
        document.cookie = `preferred-width=${mode}; path=/; max-age=31536000`;

        // 只有 ≥1024px（CSS @media 的錨定範圍一致）才需要跟著捲動；手機/平板進這個分支時
        // #btnToggleWidth 本來就被 widescreen-only 的欄位隱藏，不會被使用者手動觸發，
        // 這裡的寬度守衛只是保護 cookie 還原時（上次在桌面設成 fluid、這次用手機開頁面）的邊界情況。
        if (window.innerWidth >= 1024) {
            if (isFluid) {
                document.getElementById('main-content').scrollIntoView({ block: 'start' });
            } else {
                window.scrollTo({ top: 0 });
            }
        }
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
