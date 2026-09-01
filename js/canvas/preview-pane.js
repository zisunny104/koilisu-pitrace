// 右側「即時預覽」與 PNG 匯出共用的純渲染管線。renderGeometry() 先做「裁切／套索遮罩 →
// 橡皮擦擦除 → 旋轉 → 降採樣」這段跟顏色無關的幾何處理，得到 originalImageData（未經任何
// 增強/去背，是使用者原始掃描的真實像素）；renderPiece()/renderMaskPreview()/
// renderOverlayPreview() 三者共用的 computeMaskForPiece() 再從 originalImageData 複製一份
// 「分析圖」套用對比度/亮度增強＋computeMask() 算出遮罩，最終輸出永遠用
// compositeOriginalWithMask() 合成——增強只影響「抓不抓得到筆跡」，不會滲入最終顏色。
// 非破壞性——原始掃描位元組從不被修改，橡皮擦筆刷跟增強參數都只是存在 piece 上的資料，
// 每次都是重新算過，不是疊加在前一次算完的像素上。
// 增強放在去背「之前」：淡色筆跡（例如很淺的彩色筆）跟背景的顏色距離本來就小，
// 拉對比度能把這個距離撐大，讓它跨過去背的顏色距離門檻被判定為前景——如果增強放在去背
// 之後（只調整已經算完 alpha 的像素 RGB），選取範圍不會因此變大，淡色筆跡還是會被吃掉，
// 使用者只會看到顏色被調整、內容沒有變多。背景取樣色也要套用同一套增強公式再拿去比對，
// 否則「拉開的像素」跟「沒拉開的取樣色」基準點不一致，距離計算會失真。
// 互動預覽限制在 maxPreviewDim 內以維持效能；匯出一律以完整原始解析度重新渲染，
// 因此「預覽縮圖」與「最終輸出」不是同一份縮小過的資料。

import { store } from '../state.js';
import { selectionBounds } from '../tools/transform.js';
import { computeMask, compositeOriginalWithMask } from '../processing/bg-remove.js';
import { traceAlphaContours } from '../processing/vectorize.js';
import { announce } from '../a11y.js';
import { buildSelectionMask } from './selection-mask.js';
import { getPreviewMode, onPreviewModeChange } from '../ui/preview-mode.js';

const overlayTintRgb = '249, 115, 22'; // 跟 scan-view.js 選取範圍同一組橘色，維持視覺語言一致

const maxPreviewDim = 1400;
const defaultSimplifyTolerance = 0.75;

function downscaleCanvas(canvas, maxDim) {
    if (!maxDim || (canvas.width <= maxDim && canvas.height <= maxDim)) return canvas;
    const scale = maxDim / Math.max(canvas.width, canvas.height);
    const dw = Math.max(1, Math.round(canvas.width * scale));
    const dh = Math.max(1, Math.round(canvas.height * scale));
    const scaled = new OffscreenCanvas(dw, dh);
    scaled.getContext('2d').drawImage(canvas, 0, 0, dw, dh);
    return scaled;
}

/** 掃描 alpha 通道找出非透明像素的最小外框；整張全透明時回傳 null。 */
function opaqueBounds(imageData) {
    const { data, width, height } = imageData;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    let i = 3;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++, i += 4) {
            if (data[i] === 0) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    if (maxX < minX || maxY < minY) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// 選取範圍（矩形／套索外框）常常比實際去背後留下的內容大一圈，匯出前裁掉那圈完全透明的邊界。
// 沒有透明像素（去背關閉）或整張都透明時原樣回傳，避免多做一次無意義的複製或產生 0 尺寸畫布。
function cropToOpaqueBounds(canvas) {
    const ctx = canvas.getContext('2d');
    const bounds = opaqueBounds(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (!bounds || (bounds.x === 0 && bounds.y === 0 && bounds.w === canvas.width && bounds.h === canvas.height)) {
        return canvas;
    }
    const cropped = new OffscreenCanvas(bounds.w, bounds.h);
    cropped.getContext('2d').drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
    return cropped;
}

/**
 * 幾何處理管線（裁切／套索遮罩 → 橡皮擦擦除 → 旋轉 → 降採樣），跟顏色無關，
 * 四種預覽模式與 PNG/SVG 匯出都共用這一段。
 * @param {object} piece
 * @param {{maxDim?: number}} opts maxDim 為 0 表示不限制（匯出用完整解析度）
 * @returns {Promise<{canvas: OffscreenCanvas, originalImageData: ImageData}|null>}
 */
async function renderGeometry(piece, opts = {}) {
    if (!piece) return null;
    const bitmap = await store.getScanBitmap(piece.scanId);
    if (!bitmap) return null;

    const bounds = selectionBounds(piece);
    if (!bounds || bounds.w <= 0 || bounds.h <= 0) return null;

    const x = Math.max(0, Math.round(bounds.x));
    const y = Math.max(0, Math.round(bounds.y));
    const w = Math.min(bitmap.width - x, Math.round(bounds.w));
    const h = Math.min(bitmap.height - y, Math.round(bounds.h));
    if (w <= 0 || h <= 0) return null;

    let canvas = new OffscreenCanvas(w, h);
    let ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);

    const closedLoops = piece.selection.type === 'lasso' ? (piece.selection.loops ?? []).filter((l) => l.closed && l.path.length > 2) : [];
    if (closedLoops.length) {
        const mask = buildSelectionMask(closedLoops, w, h, x, y);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(mask, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
    }

    // 橡皮擦筆劃存在跟選取範圍同一套原始影像座標系，在這裡（裁切之後、旋轉之前）套用才會對得上
    // 使用者在工作區實際拖曳看到的畫面——工作區左側畫布一律顯示未旋轉的原圖。
    if (piece.eraseStrokes?.length) eraseStrokesInPlace(ctx, piece.eraseStrokes, x, y);

    const rotation = ((piece.rotation % 360) + 360) % 360;
    if (rotation !== 0) {
        const rad = (rotation * Math.PI) / 180;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));
        const rw = Math.max(1, Math.round(w * cos + h * sin));
        const rh = Math.max(1, Math.round(w * sin + h * cos));
        const rotated = new OffscreenCanvas(rw, rh);
        const rctx = rotated.getContext('2d');
        rctx.translate(rw / 2, rh / 2);
        rctx.rotate(rad);
        rctx.drawImage(canvas, -w / 2, -h / 2);
        canvas = rotated;
        ctx = rctx;
    }

    // 降採樣放在去背之前：縮圖／預覽只需要 maxDim 內的像素量，逐像素去背卻是照 canvas
    // 當下尺寸算成本——先縮小再去背，才不會為了畫一張 160px 縮圖去跑一次全解析度逐像素運算。
    // 匯出（maxDim: 0）不受影響，downscaleCanvas 對 !maxDim 是 no-op，仍在完整原始解析度去背。
    canvas = downscaleCanvas(canvas, opts.maxDim ?? maxPreviewDim);
    ctx = canvas.getContext('2d');

    const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { canvas, originalImageData };
}

/**
 * 從 originalImageData 複製一份分析圖套用增強，算出去背遮罩；originalImageData 本身不受影響。
 * @param {object} piece
 * @param {ImageData} originalImageData
 * @returns {Float32Array|null} bgRemoval 未啟用時回傳 null
 */
function computeMaskForPiece(piece, originalImageData) {
    if (!piece.bgRemoval?.enabled) return null;
    const { width, height } = originalImageData;
    const analysisCanvas = new OffscreenCanvas(width, height);
    const actx = analysisCanvas.getContext('2d');
    actx.putImageData(originalImageData, 0, 0);

    const hasEnhance = !!(piece.enhance?.contrast || piece.enhance?.brightness);
    if (hasEnhance) applyEnhance(actx, analysisCanvas, piece.enhance);

    const analysisImageData = actx.getImageData(0, 0, width, height);
    const sampleColorEnhanced = hasEnhance
        ? enhanceColor(piece.bgRemoval.sampleColor, piece.enhance)
        : piece.bgRemoval.sampleColor;

    return computeMask(analysisImageData, sampleColorEnhanced, {
        threshold: piece.bgRemoval.threshold,
        softness: piece.bgRemoval.softness,
        bgRadius: piece.bgRemoval.bgRadius,
        isolationSuppress: piece.bgRemoval.isolationSuppress,
    });
}

/**
 * 「結果」模式：最終去背輸出，供互動預覽與 PNG/SVG 匯出共用。
 * @param {object} piece
 * @param {{maxDim?: number}} opts maxDim 為 0 表示不限制（匯出用完整解析度）
 * @returns {Promise<OffscreenCanvas|null>}
 */
export async function renderPiece(piece, opts = {}) {
    const geo = await renderGeometry(piece, opts);
    if (!geo) return null;
    const { canvas, originalImageData } = geo;

    const maskAlpha = computeMaskForPiece(piece, originalImageData);
    if (maskAlpha) {
        const composited = compositeOriginalWithMask(originalImageData, maskAlpha, piece.bgRemoval.sampleColor, {
            bgRadius: piece.bgRemoval.bgRadius,
        });
        canvas.getContext('2d').putImageData(composited, 0, 0);
    }

    return canvas;
}

/** 「原始」模式：完全跳過增強／去背，顯示使用者原始掃描的真實顏色。 */
export async function renderOriginalPreview(piece, opts = {}) {
    const geo = await renderGeometry(piece, opts);
    return geo ? geo.canvas : null;
}

/** 「遮罩」模式：把去背遮罩轉成灰階圖（黑=完全透明、白=完全保留、灰=部分透明）。 */
export async function renderMaskPreview(piece, opts = {}) {
    const geo = await renderGeometry(piece, opts);
    if (!geo) return null;
    const { canvas, originalImageData } = geo;
    const { width, height } = originalImageData;
    const maskAlpha = computeMaskForPiece(piece, originalImageData);

    const out = new ImageData(width, height);
    const od = out.data;
    for (let i = 0, p = 0; i < width * height; i++, p += 4) {
        const v = maskAlpha ? Math.round(Math.max(0, Math.min(1, maskAlpha[i])) * 255) : 0;
        od[p] = v;
        od[p + 1] = v;
        od[p + 2] = v;
        od[p + 3] = 255;
    }
    canvas.getContext('2d').putImageData(out, 0, 0);
    return canvas;
}

/** 「疊加」模式：原圖上疊一層以遮罩 alpha 為不透明度的橘色 tint，標示目前會保留的範圍。 */
export async function renderOverlayPreview(piece, opts = {}) {
    const geo = await renderGeometry(piece, opts);
    if (!geo) return null;
    const { canvas, originalImageData } = geo;
    const maskAlpha = computeMaskForPiece(piece, originalImageData);
    if (!maskAlpha) return canvas;

    const ctx = canvas.getContext('2d');
    const { width, height } = originalImageData;
    const [tintR, tintG, tintB] = overlayTintRgb.split(',').map(Number);
    const tint = new OffscreenCanvas(width, height);
    const tctx = tint.getContext('2d');
    const tintData = tctx.createImageData(width, height);
    const td = tintData.data;
    for (let i = 0, p = 0; i < width * height; i++, p += 4) {
        td[p] = tintR;
        td[p + 1] = tintG;
        td[p + 2] = tintB;
        td[p + 3] = Math.round(Math.max(0, Math.min(1, maskAlpha[i])) * 255 * 0.55);
    }
    tctx.putImageData(tintData, 0, 0);
    ctx.drawImage(tint, 0, 0);
    return canvas;
}

// 橡皮擦：把每一筆存下來的路徑（圓頭圓角線段，寬度＝筆刷直徑）用 destination-out 直接從
// 畫面挖掉，只影響 alpha，不碰 RGB——跟選取套索遮罩是同一種合成手法，只是資料來源不同
// （筆刷路徑 vs 使用者畫的封閉區塊）。單點筆劃（點一下沒拖曳）額外補畫一個圓，
// 否則 lineTo 沒有第二個點時 stroke() 什麼都不會畫。
function eraseStrokesInPlace(ctx, strokes, offsetX, offsetY) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokes) {
        const path = stroke.path ?? [];
        if (!path.length) continue;
        const r = stroke.radius ?? 40;
        if (path.length === 1) {
            ctx.beginPath();
            ctx.arc(path[0].x - offsetX, path[0].y - offsetY, r, 0, Math.PI * 2);
            ctx.fill();
            continue;
        }
        ctx.lineWidth = r * 2;
        ctx.beginPath();
        path.forEach((p, i) => {
            const px = p.x - offsetX;
            const py = p.y - offsetY;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.stroke();
    }
    ctx.restore();
}

function clamp8(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function contrastFactor(contrast) {
    return (259 * (contrast + 255)) / (255 * (259 - contrast));
}

function enhanceChannel(value, factor, brightness) {
    return clamp8(factor * (value - 128) + 128 + brightness);
}

// 標準對比度/亮度線性調整（僅動 RGB，alpha 不變）：對比度 -100~100 換算成縮放係數，
// 以 128 為支點放大/縮小到中灰的距離；亮度 -100~100 是加法位移。全透明像素略過不算，
// 省一點運算（去背後大面積透明邊界很常見）。
function applyEnhance(ctx, canvas, enhance) {
    const contrast = enhance?.contrast ?? 0;
    const brightness = enhance?.brightness ?? 0;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const factor = contrastFactor(contrast);
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        data[i] = enhanceChannel(data[i], factor, brightness);
        data[i + 1] = enhanceChannel(data[i + 1], factor, brightness);
        data[i + 2] = enhanceChannel(data[i + 2], factor, brightness);
    }
    ctx.putImageData(imageData, 0, 0);
}

// 背景取樣色要套用跟像素同一套增強公式才能拿去算顏色距離，見上面 renderPiece 裡的說明。
function enhanceColor(color, enhance) {
    const contrast = enhance?.contrast ?? 0;
    const brightness = enhance?.brightness ?? 0;
    const factor = contrastFactor(contrast);
    return {
        r: enhanceChannel(color.r, factor, brightness),
        g: enhanceChannel(color.g, factor, brightness),
        b: enhanceChannel(color.b, factor, brightness),
    };
}

/** 匯出一律以完整原始解析度重新渲染，不是把互動預覽的畫面截圖下來；並裁掉選取外框多餘的透明邊界。 */
export async function exportPiecePNG(piece) {
    const canvas = await renderPiece(piece, { maxDim: 0 });
    if (!canvas) return null;
    return cropToOpaqueBounds(canvas).convertToBlob({ type: 'image/png' });
}

/**
 * SVG 匯出與向量預覽共用：對輪廓描邊，回傳輪廓路徑資料。
 * 向量描邊只是形狀操作、只讀 alpha 通道，直接用 computeMaskForPiece() 的遮罩當 alpha 來源即可，
 * 不需要走 renderPiece() 整套「去背合成」流程（那是為了算出正確的 RGB 去污染顏色，
 * 但描邊完全用不到顏色，繞這一圈只是白白多算三個通道的局部背景估算＋逐像素去污染）。
 */
async function tracePieceVector(piece) {
    const geo = await renderGeometry(piece, { maxDim: 0 });
    if (!geo) return null;
    const { canvas, originalImageData } = geo;
    const { width, height } = originalImageData;
    const maskAlpha = computeMaskForPiece(piece, originalImageData);

    const alphaImage = new ImageData(width, height);
    if (maskAlpha) {
        const ad = alphaImage.data;
        for (let i = 0, p = 0; i < width * height; i++, p += 4) {
            ad[p + 3] = Math.round(Math.max(0, Math.min(1, maskAlpha[i])) * 255);
        }
    } else {
        alphaImage.data.fill(255); // 去背關閉：全圖視為不透明，跟 renderPiece 行為一致
    }
    canvas.getContext('2d').putImageData(alphaImage, 0, 0);

    const cropped = cropToOpaqueBounds(canvas);
    const ctx = cropped.getContext('2d');
    const imageData = ctx.getImageData(0, 0, cropped.width, cropped.height);
    const tolerance = piece.svgExport?.simplifyTolerance ?? defaultSimplifyTolerance;
    return traceAlphaContours(imageData, { threshold: 128, simplifyTolerance: tolerance });
}

/** 向量預覽：把描出的輪廓實心填黑畫在畫布上，讓使用者在匯出前先看到 SVG 會長怎樣。 */
export async function renderPieceVectorPreview(piece, opts = {}) {
    const traced = await tracePieceVector(piece);
    if (!traced) return null;
    const { pathD, width, height, nodeCount } = traced;
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    if (pathD) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000000';
        ctx.fill(new Path2D(pathD), 'evenodd');
    }
    return { canvas: downscaleCanvas(canvas, opts.maxDim ?? maxPreviewDim), nodeCount };
}

/** 匯出一律以完整原始解析度重新描邊，跟向量預覽一樣共用 tracePieceVector。 */
export async function exportPieceSVG(piece) {
    const traced = await tracePieceVector(piece);
    if (!traced) return null;
    const { pathD, width, height } = traced;
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
        `width="${width}" height="${height}">` +
        `<path d="${pathD}" fill="#000000" fill-rule="evenodd"/></svg>`;
    return new Blob([svg], { type: 'image/svg+xml' });
}

export class PreviewPane {
    constructor(canvas, statusEl) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.statusEl = statusEl;
        this.emptyStateEl = document.getElementById('previewEmptyState');
        this.loadingStateEl = document.getElementById('previewLoadingState');
        this.nodeCountEl = document.getElementById('svgNodeCount');
        this.wrapEl = document.getElementById('previewCanvasWrap');
        this._loadToken = null;

        store.addEventListener('active-piece-changed', () => this.refresh());
        store.addEventListener('piece-changed', () => this.refresh());
        store.addEventListener('scan-changed', () => this.refresh());
        // 容器尺寸會因版面 reflow（不只是 window resize）改變，同一種「canvas 緩衝區跟 CSS 框尺寸
        // 對不上、被瀏覽器整個拉伸」問題，用 ResizeObserver 盯容器本身才會可靠跟著重算。
        new ResizeObserver(() => this.refresh()).observe(canvas.parentElement);
        onPreviewModeChange(() => this.refresh());

        this.refresh();
    }

    announce(msg) {
        announce(this.statusEl, msg);
    }

    async refresh() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
        this.canvas.height = Math.max(1, Math.round(rect.height * dpr));

        const ctx = this.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const piece = store.getActivePiece();
        if (!piece) {
            this._loadToken = null;
            if (this.loadingStateEl) this.loadingStateEl.style.display = 'none';
            if (this.emptyStateEl) this.emptyStateEl.style.display = '';
            if (this.wrapEl) this.wrapEl.classList.add('is-empty');
            this._setNodeCount(null);
            return;
        }
        if (this.wrapEl) this.wrapEl.classList.remove('is-empty');

        // 大部分更新都很快完成，延遲顯示載入中效果可避免每次微調都閃爍。
        const token = (this._loadToken = {});
        const showLoadingTimer = setTimeout(() => {
            if (this._loadToken === token && this.loadingStateEl) this.loadingStateEl.style.display = '';
        }, 150);

        let rendered = null;
        let nodeCount = null;
        if (piece.svgExport?.enabled) {
            const vec = await renderPieceVectorPreview(piece, {});
            rendered = vec?.canvas ?? null;
            nodeCount = vec?.nodeCount ?? null;
        } else {
            const renderByMode = {
                original: renderOriginalPreview,
                mask: renderMaskPreview,
                overlay: renderOverlayPreview,
                result: renderPiece,
            };
            const render = renderByMode[getPreviewMode()] ?? renderPiece;
            rendered = await render(piece, {});
        }
        clearTimeout(showLoadingTimer);
        if (this._loadToken !== token) return; // 已有更新的渲染請求，捨棄過期結果
        if (this.loadingStateEl) this.loadingStateEl.style.display = 'none';
        this._setNodeCount(nodeCount);

        if (!rendered) {
            if (this.emptyStateEl) this.emptyStateEl.style.display = '';
            return;
        }

        if (this.emptyStateEl) this.emptyStateEl.style.display = 'none';

        const scale = Math.min(rect.width / rendered.width, rect.height / rendered.height, 1);
        const dw = rendered.width * scale;
        const dh = rendered.height * scale;
        const dx = (rect.width - dw) / 2;
        const dy = (rect.height - dh) / 2;
        ctx.drawImage(rendered, dx, dy, dw, dh);
    }

    _setNodeCount(nodeCount) {
        if (!this.nodeCountEl) return;
        this.nodeCountEl.textContent = Number.isFinite(nodeCount) ? `目前輪廓節點數：${nodeCount}` : '';
    }
}
