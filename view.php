<!DOCTYPE html>
<html id="html" lang="zh-tw">

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

    /* 分隔線＋main 包成同一個 flex 子項：預設（非寬版）跟直接把兩者當 #pageContainer
       的手足擺著效果一樣，只是多包一層；寬版模式要把 100vh 錨點下移時（見下方 media
       query）才用得到這層，讓分隔線能跟著 main 一起被鎖進同一個 100vh 區塊。 */
    #mainAnchor {
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

        /* 寬版模式：把固定 100vh 的錨點再往下移一層到 #mainAnchor（分隔線＋main 的外層），
           讓標題區塊跟頁尾一樣「需要捲動才看得到」——.main-content／#pageContainer
           改回依內容自然撐高（標題的高度 + #mainAnchor 的 100vh），總高度超出一個視窗，
           body 因此變高、可捲動，原理跟上面頁尾能被捲到完全一樣，只是這次換成標題。
           錨點刻意落在 #mainAnchor 而非 main 本身：捲動切換寬版時分隔線會露在畫面最上緣，
           專案操作列（含專案名稱輸入框）才有一條分隔線墊在上面，不會直接貼死在視窗頂端。
           main 內部仍是 flex:1/min-height:0（見上方基礎規則），會自動吃掉扣掉分隔線後
           剩下的高度，不需要另外算 calc()。 */
        .main-content.is-fluid {
            flex: 1;
            height: auto;
        }

        .main-content.is-fluid #mainAnchor {
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

    /* 沒有這個，觸控拖曳會被瀏覽器當成頁面捲動／雙指縮放頁面，跟畫布自己的平移/縮放/選取搶手勢 */
    #scanCanvas {
        touch-action: none;
    }

    .pane-canvas-wrap canvas:focus-visible {
        outline: 3px solid var(--ts-primary-500, #3b82f6);
    }

    /* 依目前工具切換游標樣式（見 scan-view.js 的 _updateCursorClass）：
       矩形/套索共用一套修飾鍵游標——已有選取時，預設（無修飾鍵）＝加選，用十字＋藍色＋角標；
       Alt＝減選，用十字＋紅色－角標；Shift＝取代整個選取，跟完全沒有選取時一樣用純十字；
       橡皮擦改用 cursor:none，實際筆刷範圍改由 canvas 疊圖即時畫出（見 eraser.js drawOverlay），
       因為 CSS 游標圖是螢幕固定尺寸，沒辦法反映縮放後筆刷實際涵蓋的影像範圍；
       平移游標（cursor-pan / is-pan-armed）也同時涵蓋滑鼠中鍵按住拖曳的情況（見 scan-view.js
       _onPointerDown 的 evt.button === 1 分支）。 */
    #scanCanvas.cursor-crosshair {
        cursor: crosshair;
    }

    #scanCanvas.cursor-select-add {
        cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Cg stroke='%23000' stroke-width='3' stroke-linecap='round'%3E%3Cline x1='16' y1='3' x2='16' y2='12'/%3E%3Cline x1='16' y1='20' x2='16' y2='29'/%3E%3Cline x1='3' y1='16' x2='12' y2='16'/%3E%3Cline x1='20' y1='16' x2='29' y2='16'/%3E%3C/g%3E%3Cg stroke='%23fff' stroke-width='1.2' stroke-linecap='round'%3E%3Cline x1='16' y1='3' x2='16' y2='12'/%3E%3Cline x1='16' y1='20' x2='16' y2='29'/%3E%3Cline x1='3' y1='16' x2='12' y2='16'/%3E%3Cline x1='20' y1='16' x2='29' y2='16'/%3E%3C/g%3E%3Ccircle cx='24' cy='24' r='6.5' fill='%233b82f6' stroke='%23fff' stroke-width='1.5'/%3E%3Cline x1='24' y1='21.5' x2='24' y2='26.5' stroke='%23fff' stroke-width='1.6' stroke-linecap='round'/%3E%3Cline x1='21.5' y1='24' x2='26.5' y2='24' stroke='%23fff' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") 16 16, crosshair;
    }

    #scanCanvas.cursor-select-subtract {
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
        padding: 0.35rem 0.4rem;
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

    /* 底色＋漸層都取自 Tocas 既有的灰階變數，深淺模式切換時變數本身就會跟著變，
       不用另外寫一份深色版規則。 */
    .skeleton {
        background-image: linear-gradient(90deg,
            var(--ts-gray-200, #e8e8e8) 0%,
            var(--ts-gray-100, #f2f2f2) 50%,
            var(--ts-gray-200, #e8e8e8) 100%);
        background-size: 200% 100%;
        animation: pitrace-skeleton-shimmer 1.4s ease-in-out infinite;
    }

    @keyframes pitrace-skeleton-shimmer {
        0% {
            background-position: 200% 0;
        }

        100% {
            background-position: -200% 0;
        }
    }

    @media (prefers-reduced-motion: reduce) {

        .skeleton,
        .piece-thumb-progress-bar {
            animation: none !important;
        }
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

    /* Tocas .ts-selection.is-compact 每顆選項的 .text 內距是給文字按鈕留的（左右各 15px），
       這裡放的是純圖示（文字靠 has-hidden 視覺隱藏），沿用文字按鈕的內距讓圖示浮在一大片
       空白中。另外 .item 本身的高度是自己算出來的（圖示+內距），比 .ts-selection 用來排列
       整列的 --height（Tocas 緊湊尺寸的列高，跟旁邊縮放按鈕共用同一個值）矮一截，垂直置中
       之下上下就多出說不出所以然的留白。改用固定寬高＝--height（跟縮放的正方形圖示按鈕
       對齊）取代內距，撐滿列高、拿掉多餘空白，並靠 icon 自己 flex 置中；.ts-selection 自己
       的內距也歸零（外層 .canvas-floating-toolbar 已經給過一次間距，不需要疊兩層），改用
       gap 讓按鈕之間保留呼吸空間，不會因為拿掉內距而彼此貼死。 */
    .canvas-floating-toolbar .ts-selection.is-compact {
        padding-left: 0;
        padding-right: 0;
        gap: 0.3rem;
    }

    .canvas-floating-toolbar .ts-selection.is-compact .item {
        height: 100%;
    }

    .canvas-floating-toolbar .ts-selection.is-compact .item .text {
        width: var(--height);
        height: 100%;
        padding: 0;
        justify-content: center;
    }

    /* 拿掉內距後按鈕本身有空間了，圖示卻還是沿用文字按鈕的預設字級（14px），在正方形按鈕裡
       顯小。放大圖示字級，視覺份量才配得上按鈕本身的大小。 */
    .canvas-floating-toolbar .ts-selection.is-compact .item .text .ts-icon {
        font-size: 1.2rem;
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

    /* 「匯入」跟「專案」選單語意上是兩件事（前者匯入照片、後者管理整個專案檔），
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

    /* 標題列裡兩組性質不同的按鈕群（例如底色切換 vs 顯示模式選單）之間的細直線分隔，
       跟隔壁的 .ts-divider（水平、獨立一整行）用途不同，這裡要嵌在同一行 flex 裡當視覺區隔。 */
    .pane-toolbar-divider {
        width: 1px;
        align-self: stretch;
        margin: 0.25rem 0;
        background: var(--ts-gray-300, #ddd);
    }

    /* 選取工具／其他工具兩叢各自獨立，讓彈出鈕跟著正在使用的那叢工具走，不會固定黏在
       整排工具的最後面。叢間距比叢內距寬，視覺上分得出是兩組。 */
    .pane-tool-cluster {
        display: flex;
        align-items: center;
        gap: 0.6rem;
    }

    /* 工具 radiogroup 跟它的模式彈出鈕（選取模式／橡皮擦筆刷大小）視覺上是同一組，
       窄 gap 包成一叢、不用分隔線隔開，比照 Figma 工具列「圖示鈕＋緊貼小箭頭」的作法。 */
    .pane-tool-subcluster {
        display: flex;
        align-items: center;
        gap: 0.3rem;
    }

    /* 彈出鈕只是「還有更多選項」的箭頭指示，縮小成窄長條，附屬於旁邊工具而非平行按鈕。 */
    .pane-tool-chevron.ts-button.is-icon {
        --height: 1.6rem;
        min-width: 1.2rem;
        padding-left: 0.15rem;
        padding-right: 0.15rem;
    }

    .pane-tool-chevron .ts-icon {
        font-size: 0.85rem;
    }

    /* 「匯出全部」下拉選單：不用原生 popover（top-layer 定位在不同瀏覽器間不夠穩定），
       改用相對定位容器 + JS 切換 hidden，跟畫布浮動工具列同一手法自己控制位置。 */
    .pane-menu-wrap {
        position: relative;
        display: inline-flex;
    }

    /* 選取模式／橡皮擦筆刷大小彈出鈕會被 JS 搬進 .ts-selection 裡、緊跟在使用中的那顆
       工具後面。但 .ts-selection 本身的 flex gap（0.3rem）是設計給「平行的工具選項」用的
       間距（例如矩形跟套索之間），彈出鈕不是平行選項、是附屬於前一顆工具的箭頭，兩者
       關係要更緊——用負邊距把 flex gap 吃掉大半，只留一點點視覺呼吸空間，跟旁邊真正
       獨立的工具選項拉出間距差異。 */
    .ts-selection .pane-menu-wrap {
        margin-left: -3px;
    }

    .pane-menu-wrap[hidden] {
        display: none;
    }

    /* 縮放百分比顯示／輸入框沿用 Tocas .ts-button 預設的一般按鈕橫向留白／最小寬度
       （給文字按鈕用，min-width: 75px），跟左右緊鄰的縮放圖示鈕（is-icon，幾乎無留白）
       比起來顯得鬆散，這裡收窄讓整叢更緊密；min-width 只留剛好夠放最寬字串「800%」
       （縮放上限 8 倍）的空間，避免縮放百分比變動時寬度跳動。 */
    #zoomDisplay,
    #zoomInput {
        min-width: 52px;
        padding-left: 0.3rem;
        padding-right: 0.3rem;
    }

    .pane-dropdown-menu {
        position: absolute;
        top: calc(100% + 0.4rem);
        right: 0;
        z-index: 20;
        min-width: 14rem;
        /* portal 出去的選單用 shrink-to-fit 量寬度，不夾上限的話會被內部不換行的長句撐寬。 */
        max-width: 16rem;
        background: var(--ts-gray-50, #fff);
        border: 1px solid var(--ts-gray-300, #ddd);
        border-radius: var(--ts-border-radius-container, 8px);
        box-shadow: var(--ts-elevated-shadow, 0 8px 24px rgba(0, 0, 0, 0.2));
        padding: 0.25rem;
    }

    .pane-dropdown-menu[hidden] {
        display: none;
    }

    /* .ts-icon 基礎規則寫死 display:inline，跟原生 [hidden] 的 UA 樣式 specificity 打平時
       後者輸，用複合選擇器疊高 specificity 才能穩贏、不需要 !important。 */
    .ts-icon[hidden] {
        display: none;
    }

    /* 選中狀態、密度、字級一律交給 Tocas 原生的 is-selected/is-dense/is-small/is-separated
       修飾 class（見各選單標籤），這裡只補 Tocas 沒有內建的 nowrap/cursor。 */
    .pane-dropdown-menu .item {
        white-space: nowrap;
        cursor: pointer;
    }

    .pane-dropdown-menu .range-row {
        gap: 0.4rem;
    }

    .pane-dropdown-menu .has-top-spaced-small {
        margin-top: 0.35rem;
    }

    .pane-dropdown-menu .ts-text.is-description {
        font-size: 0.78rem;
        line-height: 1.35;
    }

    /* 圖片清單下拉：每列是「切換使用中圖片」「重新命名」「刪除」三個各自獨立的可點擊目標，
       不能整列包成一個 <button>（按鈕不能巢狀），改用 flex row 並排三顆按鈕。 */
    .pane-scan-menu-row {
        display: flex;
        align-items: center;
        gap: 0.2rem;
    }

    .pane-scan-menu-row .item {
        flex: 1 1 auto;
        min-width: 0;
    }

    .pane-scan-menu-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* 重新命名時整列換成的輸入框，寬度跟 select 按鈕的可用空間一致，避免切換時選單忽寬忽窄。 */
    .pane-scan-menu-rename-input {
        flex: 1 1 auto;
        min-width: 0;
        width: 100%;
    }

    #btnImportImageLabel {
        max-width: 12rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
        position: relative;
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

    /* 選擇器特異度刻意跟上面棋盤格那條規則打平（都是兩層 class），
       靠來源順序（這條在後面）贏過去蓋掉棋盤格，而不是被它蓋掉。 */
    .piece-thumb .thumb-placeholder.skeleton {
        background-image: linear-gradient(90deg,
            var(--ts-gray-200, #e8e8e8) 0%,
            var(--ts-gray-100, #f2f2f2) 50%,
            var(--ts-gray-200, #e8e8e8) 100%);
        background-size: 200% 100%;
        animation: pitrace-skeleton-shimmer 1.4s ease-in-out infinite;
    }

    /* 批次匯出時（見 toolbar.js exportAllBundle）用 data-export-state 驅動狀態。 */
    .piece-thumb-progress {
        position: absolute;
        left: 0.3rem;
        right: 0.3rem;
        bottom: 0.3rem;
        height: 4px;
        border-radius: 2px;
        background: var(--ts-gray-300, #ddd);
        overflow: hidden;
        opacity: 0;
        transition: opacity 0.15s ease;
    }

    .piece-thumb[data-export-state] .piece-thumb-progress {
        opacity: 1;
    }

    .piece-thumb-progress-bar {
        position: absolute;
        top: 0;
        left: -30%;
        width: 30%;
        height: 100%;
        border-radius: 2px;
        background: var(--ts-primary-500, #3b82f6);
    }

    /* 處理中：跑馬燈式不定進度（單一物件的匯出運算是不可分割的一整塊同步工作，
       算不出真正的百分比，用滑動色塊表示「還在動」）。 */
    .piece-thumb[data-export-state="active"] .piece-thumb-progress-bar {
        animation: pitrace-progress-indeterminate 1.1s ease-in-out infinite;
    }

    /* 完成：滿條＋綠色，停留到整批匯出結束後才淡出（見 toolbar.js）。 */
    .piece-thumb[data-export-state="done"] .piece-thumb-progress-bar {
        left: 0;
        width: 100%;
        background: var(--ts-positive-500, #22c55e);
        transition: left 0.2s ease, width 0.2s ease;
    }

    /* 跳過：該物件尚未設定選取範圍，這次批次匯出沒有產生任何檔案，滿條但用中性灰區隔於成功。 */
    .piece-thumb[data-export-state="skipped"] .piece-thumb-progress-bar {
        left: 0;
        width: 100%;
        background: var(--ts-gray-500, #999);
        transition: left 0.2s ease, width 0.2s ease;
    }

    @keyframes pitrace-progress-indeterminate {
        0% {
            left: -30%;
        }

        100% {
            left: 100%;
        }
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

    /* Tocas 數字輸入框預設左右各 15px 內距是給一般寬度輸入框設計的，range-row 這裡
       固定只有 4.5rem 寬，滑桿數值又可能到三位數（例如橡皮擦筆刷大小上限 300），
       內距太寬會把數字擠到跟微調箭頭黏在一起、最後一位數看起來被裁掉。 */
    .range-row .ts-input input {
        padding-left: 0.3rem;
        padding-right: 0.3rem;
    }

    .rotation-row {
        display: flex;
        align-items: center;
        gap: 0.35rem;
    }

    .rotation-row .ts-input {
        flex: 1;
    }

    .name-row {
        display: flex;
        align-items: center;
        gap: 0.35rem;
    }

    .name-row .ts-input {
        flex: 1;
        position: relative;
    }

    /* 名稱欄位目前顯示值（不管是 OCR 建議還是手動打的）跟已存檔的物件名稱不一致時，
       右側內嵌套用／還原兩顆小圓鈕，取代「按 Enter 才生效、切走就作廢」這種看不見
       的隱性規則，讓使用者可以明確選擇。輸入框右邊留白，避免文字被按鈕蓋住。 */
    .name-row .ts-input input {
        padding-right: 3.6rem;
    }

    .name-input-actions {
        position: absolute;
        top: 50%;
        right: 0.3rem;
        transform: translateY(-50%);
        display: flex;
        gap: 0.25rem;
    }

    .name-input-actions[hidden] {
        display: none;
    }

    .name-input-action {
        --height: 1.35rem;
        min-width: 1.35rem;
        padding: 0;
        border-radius: 50%;
    }

    .name-input-action .ts-icon {
        font-size: 0.7rem;
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
       這裡讓它固定在畫面下方置中，作為 announce() 狀態訊息的可視化版本。.main-content 鎖了
       viewport 高度（見上面「頁尾是 flex 手足」那段），畫布下方的浮動工具列
       （.canvas-floating-toolbar）上緣實測落在離視窗底部約 11rem 處，這裡把 snackbar 的
       bottom 拉到 12rem，讓它穩定浮在工具列上方、不會疊在一起。 */
    .pitrace-snackbar {
        position: fixed;
        left: 50%;
        bottom: 12rem;
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

    /* Tocas 沒有拖放區元件，這裡用最小自訂樣式做拖曳匯入圖片／開啟專案時的視覺回饋。 */
    #main-content.is-drag-target {
        outline: 3px dashed var(--ts-primary-500, #3b82f6);
        outline-offset: -3px;
        border-radius: 8px;
        background: var(--ts-primary-50, rgba(59, 130, 246, 0.06));
    }
    </style>
</head>

<body class="is-rounded">
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
                <div class="column mobile:has-hidden">
                    <button id="btnToggleWidth" class="ts-button is-icon is-outlined" aria-label="使用完整頁面寬度"
                        title="使用完整頁面寬度" aria-pressed="false">
                        <span class="ts-icon is-arrows-left-right-icon" aria-hidden="true"></span>
                    </button>
                </div>
            </div>

            <div id="mainAnchor">
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
                                <div class="pane-menu-wrap">
                                    <button id="btnImportImage" class="ts-button is-primary is-start-icon">
                                        <span class="ts-icon is-upload-icon" aria-hidden="true"></span>
                                        <span id="btnImportImageLabel">匯入</span>
                                        <span class="ts-icon is-chevron-down-icon" id="btnImportImageChevron"
                                            aria-hidden="true" hidden></span>
                                    </button>
                                    <!-- 匯入前是單純的「匯入」按鈕；有圖片後變成下拉選單：清單本身（切換圖片）
                                         是較常用的操作放上面，「匯入」放最下面、用分隔線隔開。 -->
                                    <div class="ts-menu is-dense is-small is-separated pane-dropdown-menu" id="scanMenu" role="menu"
                                        aria-label="圖片清單" hidden>
                                        <!-- 動態生成 -->
                                    </div>
                                </div>
                                <button class="ts-button is-outlined is-end-icon" data-dropdown="projectMenuDropdown">
                                    專案
                                    <span class="ts-icon is-chevron-down-icon" aria-hidden="true"></span>
                                </button>
                            </div>
                        </div>
                    </div>
                    <input type="file" id="fileOpenProject" accept=".pitra" class="visually-hidden">
                    <input type="file" id="fileImportImage"
                        accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" multiple
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
                                <div class="ts-text is-description">點擊上方「匯入」，或將圖片／PDF／.pitra 專案檔拖曳到此區域</div>
                            </div>
                            <div class="pane-loading-state skeleton" id="scanLoadingState" style="display:none">
                                <div class="ts-text is-description">圖片載入中…</div>
                            </div>
                            <div class="canvas-floating-toolbar pane-toolbar" role="toolbar" aria-label="編輯工具">
                                <button id="btnAddPieceFloating" class="ts-button is-icon" aria-label="新增物件"
                                    data-tooltip="新增物件">
                                    <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                                </button>
                                <div class="pane-toolbar-divider" aria-hidden="true"></div>
                                <div class="pane-tool-cluster">
                                    <div class="pane-tool-subcluster">
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
                                        </div>

                                        <div class="pane-menu-wrap" id="selectionModeMenuWrap">
                                            <button id="btnSelectionModeMenu" class="ts-button is-icon is-ghost pane-tool-chevron"
                                                aria-label="選取模式：加選" aria-haspopup="menu" aria-expanded="false"
                                                data-tooltip="選取模式（目前：加選）">
                                                <span class="ts-icon is-chevron-down-icon" aria-hidden="true"></span>
                                            </button>
                                            <div class="ts-menu is-dense is-small is-separated pane-dropdown-menu" id="selectionModeMenu" role="menu"
                                                aria-label="選取模式" hidden>
                                                <button type="button" class="item is-selected" role="menuitemradio" aria-checked="true" data-mode="add">加選（＋）</button>
                                                <button type="button" class="item" role="menuitemradio" aria-checked="false" data-mode="subtract">減選（－）</button>
                                                <button type="button" class="item" role="menuitemradio" aria-checked="false" data-mode="new">取代全部</button>
                                            </div>
                                        </div>
                                    </div>

                                    <div class="pane-tool-subcluster">
                                        <div class="ts-selection is-compact" role="radiogroup" aria-label="其他工具">
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

                                        <div class="pane-menu-wrap" id="eraserSizeMenuWrap" hidden>
                                            <button id="btnEraserSizeMenu" class="ts-button is-icon is-ghost pane-tool-chevron"
                                                aria-label="橡皮擦筆刷大小" aria-haspopup="menu" aria-expanded="false"
                                                data-tooltip="橡皮擦筆刷大小">
                                                <span class="ts-icon is-chevron-down-icon" aria-hidden="true"></span>
                                            </button>
                                            <div class="ts-menu is-small pane-dropdown-menu" id="eraserSizeMenu" hidden>
                                                <label class="ts-text is-label" for="eraserRadius">筆刷大小</label>
                                                <div class="range-row">
                                                    <div class="ts-range"><input type="range" id="eraserRadius" min="5" max="300" value="40"></div>
                                                    <div class="ts-input"><input type="number" id="eraserRadiusValue" min="5" max="300" value="40" aria-label="橡皮擦筆刷大小數值"></div>
                                                </div>
                                                <div class="has-top-spaced-small ts-text is-description">快捷鍵 [ / ]（Shift 加大步進）也可以調整；按住 Alt 拖曳＝還原（負向筆刷）。</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- 縮放控制群組本身是深色實心的 .ts-buttons 分段按鈕，已經自帶明顯的容器邊界，
                                     跟工具那疊淺灰膠囊之間不需要再疊一條分隔線重複宣告「這裡是分界」。 -->
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
                                        <div class="ts-menu is-dense is-small is-separated pane-dropdown-menu" id="exportAllMenu" role="menu"
                                            aria-label="匯出全部物件" hidden>
                                            <button type="button" class="item" role="menuitem" id="btnExportAllPNG">
                                                <span class="ts-icon is-file-image-icon" aria-hidden="true"></span>
                                                <span>PNG</span>
                                            </button>
                                            <button type="button" class="item" role="menuitem" id="btnExportAllSVG">
                                                <span class="ts-icon is-bezier-curve-icon" aria-hidden="true"></span>
                                                <span>SVG</span>
                                            </button>
                                            <button type="button" class="item" role="menuitem" id="btnExportAllZip">
                                                <span class="ts-icon is-file-zipper-icon" aria-hidden="true"></span>
                                                <span>PNG + SVG（ZIP）</span>
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
                                <div class="pane-toolbar-buttons">
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
                                    <div class="pane-toolbar-divider" aria-hidden="true"></div>
                                    <div class="pane-menu-wrap">
                                        <button id="btnPreviewMode" class="ts-button is-icon is-small is-ghost"
                                            aria-label="預覽模式：結果" title="預覽模式：結果"
                                            aria-haspopup="menu" aria-expanded="false">
                                            <span class="ts-icon is-check-icon" aria-hidden="true" id="btnPreviewModeIcon"></span>
                                        </button>
                                        <div class="ts-menu is-dense is-small is-separated pane-dropdown-menu" id="previewModeMenu" role="menu"
                                            aria-label="預覽模式" hidden>
                                            <button type="button" class="item" role="menuitemradio" aria-checked="false"
                                                id="previewMode-original" data-mode="original" data-icon="is-image-icon"
                                                title="原始掃描顏色，不套用增強或去背">
                                                <span class="ts-icon is-image-icon" aria-hidden="true"></span>
                                                <span>原始</span>
                                            </button>
                                            <button type="button" class="item" role="menuitemradio" aria-checked="false"
                                                id="previewMode-mask" data-mode="mask" data-icon="is-circle-half-stroke-icon"
                                                title="去背遮罩灰階視覺化">
                                                <span class="ts-icon is-circle-half-stroke-icon" aria-hidden="true"></span>
                                                <span>遮罩</span>
                                            </button>
                                            <button type="button" class="item" role="menuitemradio" aria-checked="false"
                                                id="previewMode-overlay" data-mode="overlay" data-icon="is-layer-group-icon"
                                                title="原圖疊加去背範圍標示">
                                                <span class="ts-icon is-layer-group-icon" aria-hidden="true"></span>
                                                <span>疊加</span>
                                            </button>
                                            <button type="button" class="item" role="menuitemradio" aria-checked="true"
                                                id="previewMode-result" data-mode="result" data-icon="is-check-icon"
                                                title="最終去背合成結果">
                                                <span class="ts-icon is-check-icon" aria-hidden="true"></span>
                                                <span>結果</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="pane-canvas-wrap is-preview bg-checker" id="previewCanvasWrap">
                                <canvas id="previewCanvas" aria-label="目前物件的即時預覽，棋盤格代表透明區域"></canvas>
                                <div class="pane-empty-state" id="previewEmptyState">
                                    <span class="ts-icon is-crop-icon is-heading" aria-hidden="true"></span>
                                    <div class="ts-text is-description">還沒有可以預覽的選區呢</div>
                                    <div class="ts-text is-description">框選一個物件後會顯示在這裡</div>
                                </div>
                                <div class="pane-loading-state skeleton" id="previewLoadingState" style="display:none">
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
                            <label class="ts-text is-label" for="rotationValue">旋轉角度</label>
                            <div class="has-top-spaced-small rotation-row">
                                <button id="btnRotateLeft" class="ts-button is-icon is-small" aria-label="向左旋轉 90 度"
                                    data-tooltip="向左旋轉 90 度">
                                    <span class="ts-icon is-rotate-left-icon" aria-hidden="true"></span>
                                </button>
                                <button id="btnRotateMinus" class="ts-button is-icon is-small" aria-label="微調 -1 度（按住 Shift 為 -15 度）"
                                    data-tooltip="微調 −1°（Shift −15°）">
                                    <span class="ts-icon is-minus-icon" aria-hidden="true"></span>
                                </button>
                                <div class="ts-input">
                                    <input type="number" id="rotationValue" min="-180" max="180" step="any" value="0"
                                        aria-label="旋轉角度數值（度），可在此滾動滑鼠滾輪調整">
                                </div>
                                <button id="btnRotatePlus" class="ts-button is-icon is-small" aria-label="微調 +1 度（按住 Shift 為 +15 度）"
                                    data-tooltip="微調 +1°（Shift +15°）">
                                    <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                                </button>
                                <button id="btnRotateRight" class="ts-button is-icon is-small" aria-label="向右旋轉 90 度"
                                    data-tooltip="向右旋轉 90 度">
                                    <span class="ts-icon is-rotate-right-icon" aria-hidden="true"></span>
                                </button>
                            </div>

                            <div class="ts-grid has-top-spaced">
                                <div class="column is-16-wide">
                                    <label class="ts-text is-label">物件名稱</label>
                                    <div class="has-top-spaced-small name-row">
                                        <div class="ts-input is-fluid">
                                            <input type="text" id="pieceNameInput" aria-label="物件名稱">
                                            <div class="name-input-actions" id="pieceNameActions" hidden>
                                                <button type="button" id="btnPieceNameApply"
                                                    class="ts-button is-icon is-small is-positive name-input-action"
                                                    aria-label="套用名稱" data-tooltip="套用">
                                                    <span class="ts-icon is-check-icon" aria-hidden="true"></span>
                                                </button>
                                                <button type="button" id="btnPieceNameRevert"
                                                    class="ts-button is-icon is-small name-input-action"
                                                    aria-label="還原名稱" data-tooltip="還原">
                                                    <span class="ts-icon is-arrow-rotate-left-icon" aria-hidden="true"></span>
                                                </button>
                                            </div>
                                        </div>
                                        <button id="btnOcrSuggestName" type="button" class="ts-button is-icon is-small"
                                            aria-label="辨識圖片文字，套用到名稱欄位"
                                            data-tooltip="辨識文字建議名稱（第一次使用需下載 OCR 引擎，較慢）">
                                            <span class="ts-icon is-wand-magic-sparkles-icon" aria-hidden="true"></span>
                                        </button>
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
                                    <button id="btnFlattenLasso" class="ts-button is-small is-outlined is-start-icon">
                                        <span class="ts-icon is-layer-group-icon" aria-hidden="true"></span>
                                        平面化選取
                                    </button>
                                    <button id="btnClearLasso" class="ts-button is-small is-outlined is-negative is-start-icon">
                                        <span class="ts-icon is-trash-icon" aria-hidden="true"></span>
                                        清除套索
                                    </button>
                                </div>
                            </div>

                            <!-- 橡皮擦：所有筆觸自動合併成單一擦除區域，不逐筆列出，只提供整批清除 -->
                            <div id="eraseFieldsGroup" class="has-top-spaced">
                                <div class="ts-text is-label">橡皮擦</div>
                                <div id="eraseStrokeStatus" class="ts-text is-description has-top-spaced-small"></div>
                                <div class="ts-wrap has-top-spaced-small">
                                    <button id="btnClearErase" class="ts-button is-small is-outlined is-negative is-start-icon">
                                        <span class="ts-icon is-trash-icon" aria-hidden="true"></span>
                                        清除擦除
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
                                    <div id="bgSampleSwatch" class="bg-sample-swatch" aria-hidden="true"></div>
                                    <div class="ts-input"><input type="number" id="bgSampleR" min="0" max="255" aria-label="背景色 R"></div>
                                    <div class="ts-input"><input type="number" id="bgSampleG" min="0" max="255" aria-label="背景色 G"></div>
                                    <div class="ts-input"><input type="number" id="bgSampleB" min="0" max="255" aria-label="背景色 B"></div>
                                    <button id="btnAutoSampleBg" class="ts-button is-small is-outlined">自動取樣邊緣</button>
                                </div>
                            </div>

                            <div class="has-top-spaced">
                                <label class="ts-text is-label" for="bgStrength">去背強度</label>
                                <div class="range-row">
                                    <div class="ts-range"><input type="range" id="bgStrength" min="0" max="100" value="50"></div>
                                    <div class="ts-input"><input type="number" id="bgStrengthValue" min="0" max="100" value="50" aria-label="去背強度數值"></div>
                                </div>
                                <div class="has-top-spaced-small ts-text is-description">數值愈高愈積極把接近背景色的區域判定為背景；實心筆跡的顏色跟背景差異遠遠超過安全範圍，不會因為調整這個數值而變透明。</div>
                            </div>

                            <div class="has-top-spaced">
                                <label class="ts-text is-label" for="bgDespeckle">去除雜點</label>
                                <div class="range-row">
                                    <div class="ts-range"><input type="range" id="bgDespeckle" min="0" max="100" value="0"></div>
                                    <div class="ts-input"><input type="number" id="bgDespeckleValue" min="0" max="100" value="0" aria-label="去除雜點數值"></div>
                                </div>
                                <div class="has-top-spaced-small ts-text is-description">把跟主要筆畫不相連、面積很小的獨立雜點視為背景去掉；預設 0（不去除），數值愈高能去掉的雜點愈大，細線本身不會被砍斷。</div>
                            </div>

                            <div class="has-top-spaced">
                                <label class="ts-text is-label" for="bgStrokeEnhance">增強筆畫</label>
                                <div class="range-row">
                                    <div class="ts-range"><input type="range" id="bgStrokeEnhance" min="0" max="100" value="0"></div>
                                    <div class="ts-input"><input type="number" id="bgStrokeEnhanceValue" min="0" max="100" value="0" aria-label="增強筆畫數值"></div>
                                </div>
                                <div class="has-top-spaced-small ts-text is-description">把去背後留下的筆畫往外增厚，讓太細、斷開的線條變粗、重新連起來；預設 0（不調整）。</div>
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

                            <div class="has-top-spaced-small">
                                <label class="ts-text is-label" for="scanDpiInput">掃描 DPI</label>
                                <div class="ts-input"><input type="number" id="scanDpiInput" min="1" step="1" placeholder="未偵測到"></div>
                                <div class="has-top-spaced-small ts-text is-description">匯入時自動從檔案讀取，讀不到時可以手動填；留空則匯出 SVG 不含實體尺寸單位。</div>
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
                        <a href="https://github.com/zisunny104/pitrace" target="_blank"
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
        document.body.className = theme === 'system' ?
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
                document.querySelector('#mainAnchor .ts-divider').scrollIntoView({ block: 'start' });
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
            const next = nowFluid ? 'contained' : 'fluid';
            setWidthMode(next);
            // 切成滿版寬度時順便進瀏覽器全螢幕；切回標準寬度時如果還在全螢幕就跟著退出。
            // requestFullscreen 需要使用者手勢才會成功，這裡是在 click handler 內呼叫，符合條件；
            // 部分環境（例如被 iframe 嵌入、使用者已停用權限）仍可能被拒絕，失敗就靜默略過，
            // 不影響寬度切換本身已經生效。
            if (next === 'fluid') {
                if (document.documentElement.requestFullscreen) {
                    document.documentElement.requestFullscreen().catch(() => {});
                }
            } else if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
        });
        // 使用者按 Esc 或瀏覽器自己的介面離開全螢幕時，滿版寬度也跟著退回標準寬度，
        // 讓「全寬度」跟「全螢幕」維持同步，不會卡在「已經不是全螢幕、但頁面還滿版」的中間狀態。
        document.addEventListener('fullscreenchange', function() {
            if (!document.fullscreenElement && document.getElementById('pageContainer').classList.contains('is-fluid')) {
                setWidthMode('contained');
            }
        });
    });
    </script>
</body>

</html>
