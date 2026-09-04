// 簡易 pub/sub store：管理 Pitrace 專案資料模型。
// 不使用任何前端框架或狀態庫，靠原生 EventTarget 做局部重繪通知。

let counter = 0;
function makeId(prefix) {
    counter += 1;
    return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

function stripExtension(filename) {
    return filename.replace(/\.[^.]+$/, '');
}

function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
        if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
}

export function createEmptyProject(name = '未命名專案') {
    return {
        schema: 1,
        name,
        createdAt: new Date().toISOString(),
        scans: [],
        pieces: [],
    };
}

export function createPiece(scanId, overrides = {}) {
    return {
        id: makeId('piece'),
        scanId,
        name: '未命名物件',
        selection: { type: 'rect', rect: null, loops: [] },
        rotation: 0,
        eraseStrokes: [],
        eraseRadius: 40,
        bgRemoval: {
            enabled: true,
            sampleColor: { r: 255, g: 255, b: 255 },
            strength: 50,
        },
        svgExport: {
            enabled: false,
            simplifyTolerance: 0.75,
        },
        ...overrides,
    };
}

const PIECE_COLOR_PALETTE = [
    '#10b981', '#ec4899', '#8b5cf6', '#ef4444',
    '#06b6d4', '#65a30d', '#4338ca', '#0d9488',
];

// 依物件在專案中的順序自動輪流配色；piece.color 是保留給未來手動自訂顏色的擴充點，目前尚未使用。
export function getPieceColor(piece) {
    if (piece.color) return piece.color;
    const idx = store.project.pieces.indexOf(piece);
    return PIECE_COLOR_PALETTE[(idx < 0 ? 0 : idx) % PIECE_COLOR_PALETTE.length];
}

const HISTORY_LIMIT = 50;
const HISTORY_COALESCE_MS = 500;
// 逐像素運算（去背、遮罩、匯出）能撐住的上限（約 7746x7746，600dpi A4/A3 掃描仍有餘裕）。
// 超過這個量的掃描圖不會被拒絕，而是等比例縮小＋轉 WebP 後才進入編輯流程（見 _downscaleScan）。
const MAX_SCAN_PIXELS = 60_000_000;
// 同時最多快取幾張已解碼的 ImageBitmap（LRU，每張上限約 240MB＝60MP×4bytes）：
// 專案掃描圖一多，全部解碼常駐會讓分頁記憶體隨掃描圖數量線性成長，
// 超過此數就釋放最舊未使用的一張，下次要用再重新解碼。
const MAX_CACHED_BITMAPS = 4;

class Store extends EventTarget {
    constructor() {
        super();
        this.project = createEmptyProject();
        this.activeScanId = null;
        this.activePieceId = null;
        this.activeTool = 'rect';
        this._bitmapCache = new Map(); // scanId -> ImageBitmap（運算快取，不參與序列化）
        this._undoStack = [];
        this._redoStack = [];
        this._pendingBefore = null; // 連續操作（拖曳、滑桿）合併成一步之前的快照
        this._coalesceTimer = null;
    }

    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    _resetHistory() {
        if (this._coalesceTimer) clearTimeout(this._coalesceTimer);
        this._coalesceTimer = null;
        this._pendingBefore = null;
        this._undoStack = [];
        this._redoStack = [];
        this.emit('history-changed', {});
    }

    _snapshotPieces() {
        return structuredClone(this.project.pieces);
    }

    // undo/redo 還原快照時，把內容沒變的物件／欄位換回目前存活物件的參照，而不是直接吃
    // structuredClone 出來的全新物件——preview-pane.js 的 geometryCache 是用 `===` 比對
    // selection/eraseStrokes/rotation 判斷要不要重算，換成全新參照會讓每個物件都被判定
    //「已變更」，逐一步 undo/redo 都要整批重新運算縮圖，卡頓的根源就在這裡。
    _reconcilePieces(snapshotPieces) {
        const liveById = new Map(this.project.pieces.map((p) => [p.id, p]));
        return snapshotPieces.map((snap) => {
            const live = liveById.get(snap.id);
            if (!live) return snap;
            if (deepEqual(live, snap)) return live;
            const reconciled = { ...snap };
            for (const key of Object.keys(snap)) {
                if (key !== 'id' && deepEqual(live[key], snap[key])) reconciled[key] = live[key];
            }
            return reconciled;
        });
    }

    // 立即記一步（新增／刪除作品這類離散動作）：先把任何合併中的連續編輯結清，維持步驟順序。
    _pushHistoryStep() {
        this._flushPendingHistory();
        this._undoStack.push(this._snapshotPieces());
        if (this._undoStack.length > HISTORY_LIMIT) this._undoStack.shift();
        this._redoStack = [];
        this.emit('history-changed', {});
    }

    // 連續編輯（拖曳選取、調整滑桿）：短時間內合併成同一步，停手後才真正記錄。
    _beginCoalescedEdit() {
        if (this._pendingBefore === null) {
            this._pendingBefore = this._snapshotPieces();
            this._redoStack = [];
        }
        if (this._coalesceTimer) clearTimeout(this._coalesceTimer);
        this._coalesceTimer = setTimeout(() => this._flushPendingHistory(), HISTORY_COALESCE_MS);
    }

    _flushPendingHistory() {
        if (this._coalesceTimer) {
            clearTimeout(this._coalesceTimer);
            this._coalesceTimer = null;
        }
        if (this._pendingBefore !== null) {
            this._undoStack.push(this._pendingBefore);
            if (this._undoStack.length > HISTORY_LIMIT) this._undoStack.shift();
            this._pendingBefore = null;
            this.emit('history-changed', {});
        }
    }

    get canUndo() {
        return this._undoStack.length > 0 || this._pendingBefore !== null;
    }

    get canRedo() {
        return this._redoStack.length > 0;
    }

    undo() {
        this._flushPendingHistory();
        if (this._undoStack.length === 0) return false;
        const prev = this._undoStack.pop();
        this._redoStack.push(this._snapshotPieces());
        this.project.pieces = this._reconcilePieces(prev);
        if (!this.project.pieces.find((p) => p.id === this.activePieceId)) {
            this.activePieceId = this.project.pieces[0]?.id ?? null;
        }
        this.emit('project-changed', {});
        this.emit('active-piece-changed', {});
        this.emit('history-changed', {});
        return true;
    }

    redo() {
        if (this._redoStack.length === 0) return false;
        const next = this._redoStack.pop();
        this._undoStack.push(this._snapshotPieces());
        this.project.pieces = this._reconcilePieces(next);
        if (!this.project.pieces.find((p) => p.id === this.activePieceId)) {
            this.activePieceId = this.project.pieces[0]?.id ?? null;
        }
        this.emit('project-changed', {});
        this.emit('active-piece-changed', {});
        this.emit('history-changed', {});
        return true;
    }

    setProject(project) {
        this._bitmapCache.forEach((bmp) => bmp?.close && bmp.close());
        this._bitmapCache.clear();
        this.project = project;
        this.activeScanId = project.scans[0]?.id ?? null;
        this.activePieceId = project.pieces[0]?.id ?? null;
        this.activeTool = 'rect';
        this._resetHistory();
        this.emit('project-changed', {});
        // scan-changed 要先於 active-piece-changed 觸發：前者驅動 ScanView.loadActiveScan()
        // 同步清掉舊 bitmap 參照，若順序相反，active-piece-changed 觸發的 draw() 會搶在
        // 清除之前對著剛被關閉的舊 bitmap 畫圖。
        this.emit('scan-changed', { scanId: this.activeScanId });
        this.emit('active-piece-changed', {});
    }

    async addScan({ filename, mime, bytes, width, height, dpi }) {
        const scan = { id: makeId('scan'), filename, mime, bytes, width, height, dpi: dpi ?? null };
        this.project.scans.push(scan);
        this.activeScanId = scan.id;
        this.emit('project-changed', {});
        this.emit('scan-changed', { scanId: scan.id });
        return scan;
    }

    // 重新命名掃描圖片：只改顯示用檔名，不動 bytes/mime。已存在的物件名稱是建立當下就
    // 定型的字串（跟專案名稱一樣不會事後跟著來源改名），這裡只影響之後用這張圖新增物件時的預設前綴。
    renameScan(scanId, filename) {
        const scan = this.project.scans.find((s) => s.id === scanId);
        if (!scan) return;
        scan.filename = filename;
        this.emit('project-changed', {});
        this.emit('scan-changed', { scanId });
    }

    // 手動覆寫掃描圖片的 DPI（匯入時偵測不到，或使用者想校正自動偵測結果）。
    setScanDpi(scanId, dpi) {
        const scan = this.project.scans.find((s) => s.id === scanId);
        if (!scan) return;
        scan.dpi = dpi ?? null;
        this.emit('project-changed', {});
        this.emit('scan-changed', { scanId });
    }

    // 移除掃描圖片：連同引用它的物件一起刪除（物件離了來源圖片沒有意義），並釋放原始位元組
    // 與已解碼快取。跟「新增專案」一樣不可復原——若讓 undo 復活出指向已刪除圖片的物件，
    // renderPiece 只會拿到 null，是比不能復原更糟的半殘狀態，所以直接清空歷史紀錄。
    removeScan(scanId) {
        const idx = this.project.scans.findIndex((s) => s.id === scanId);
        if (idx === -1) return;

        this.project.scans.splice(idx, 1);
        this.project.pieces = this.project.pieces.filter((p) => p.scanId !== scanId);

        const bmp = this._bitmapCache.get(scanId);
        bmp?.close && bmp.close();
        this._bitmapCache.delete(scanId);

        if (this.activeScanId === scanId) {
            this.activeScanId = this.project.scans[0]?.id ?? null;
        }
        if (!this.project.pieces.find((p) => p.id === this.activePieceId)) {
            this.activePieceId = this.project.pieces[0]?.id ?? null;
        }

        this._resetHistory();
        this.emit('project-changed', {});
        // 同上 setProject()：scan-changed 要先於 active-piece-changed，才能讓
        // loadActiveScan() 先同步清掉剛被 close() 的舊 bitmap，避免 draw() 搶在前面炸掉。
        this.emit('scan-changed', { scanId: this.activeScanId });
        this.emit('active-piece-changed', {});
    }

    async getScanBitmap(scanId) {
        if (this._bitmapCache.has(scanId)) {
            const cached = this._bitmapCache.get(scanId);
            // 命中就搬到 Map 尾端（最近使用），LRU 淘汰才會先挑到真正沒在用的舊快取。
            this._bitmapCache.delete(scanId);
            this._bitmapCache.set(scanId, cached);
            return cached;
        }
        const scan = this.project.scans.find((s) => s.id === scanId);
        if (!scan) return null;
        const blob = new Blob([scan.bytes], { type: scan.mime });
        let bitmap = await createImageBitmap(blob);
        if (bitmap.width * bitmap.height > MAX_SCAN_PIXELS) {
            bitmap = await this._downscaleScan(scan, bitmap);
        }
        this._cacheBitmap(scanId, bitmap);
        return bitmap;
    }

    // 超過 MAX_SCAN_PIXELS 的掃描圖：等比例縮小到上限內、重新編碼成 WebP，就地取代
    // scan.bytes/width/height/dpi（dpi 依同比例縮小才能維持 SVG mm 匯出的實際尺寸正確）。
    // 這是唯一能讓超大圖片進得了編輯流程的做法——瀏覽器對這種尺寸的逐像素運算（去背、遮罩）
    // 本來就撐不住，縮小是必要的，不是可選的加值功能。
    async _downscaleScan(scan, bitmap) {
        const scaleFactor = Math.sqrt((MAX_SCAN_PIXELS * 0.95) / (bitmap.width * bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scaleFactor));
        const height = Math.max(1, Math.round(bitmap.height * scaleFactor));
        const canvas = new OffscreenCanvas(width, height);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
        bitmap.close();

        const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.92 });
        scan.bytes = await webpBlob.arrayBuffer();
        scan.mime = 'image/webp';
        scan.width = width;
        scan.height = height;
        if (scan.dpi) scan.dpi = Math.round(scan.dpi * scaleFactor);

        this.emit('scan-downscaled', { scanId: scan.id, width, height });
        this.emit('project-changed', {});
        return createImageBitmap(new Blob([scan.bytes], { type: scan.mime }));
    }

    // 超過 MAX_CACHED_BITMAPS 張就釋放最舊的一張，但絕不淘汰目前正顯示中的掃描圖——
    // 它可能正被 ScanView 直接持有參照，關掉會讓畫面上的 canvas 炸掉。
    _cacheBitmap(scanId, bitmap) {
        this._bitmapCache.set(scanId, bitmap);
        let realCount = 0;
        for (const bmp of this._bitmapCache.values()) if (bmp) realCount += 1;
        while (realCount > MAX_CACHED_BITMAPS) {
            let evictId = null;
            for (const [id, bmp] of this._bitmapCache) {
                if (bmp && id !== this.activeScanId) {
                    evictId = id;
                    break;
                }
            }
            if (evictId == null) break; // 剩下的都在使用中，不再淘汰
            this._bitmapCache.get(evictId).close();
            this._bitmapCache.delete(evictId);
            realCount -= 1;
        }
    }

    addPiece(scanId, overrides = {}) {
        this._pushHistoryStep();
        // 物件預設名稱＝來源圖片檔名_流水號，而非專案名稱：一個專案常有多張掃描圖，
        // 用圖片檔名當前綴才看得出這個物件是切自哪一張，專案名稱在這裡沒有辨識度。
        // 流水號取現有物件中最大的同前綴編號 +1，而非單純用陣列長度，
        // 避免刪除中間的物件後，新物件的預設名稱跟留下來的物件撞名。
        const scan = this.project.scans.find((s) => s.id === scanId);
        const prefix = `${scan ? stripExtension(scan.filename) : '未命名物件'}_`;
        let maxSeq = 0;
        for (const p of this.project.pieces) {
            if (!p.name || !p.name.startsWith(prefix)) continue;
            const n = Number(p.name.slice(prefix.length));
            if (Number.isInteger(n) && n > maxSeq) maxSeq = n;
        }
        const defaultName = `${prefix}${maxSeq + 1}`;
        const piece = createPiece(scanId, { name: defaultName, ...overrides });
        this.project.pieces.push(piece);
        this.activePieceId = piece.id;
        this.emit('project-changed', {});
        this.emit('active-piece-changed', {});
        return piece;
    }

    updatePiece(pieceId, patch) {
        const piece = this.project.pieces.find((p) => p.id === pieceId);
        if (!piece) return;
        this._beginCoalescedEdit();
        Object.assign(piece, patch);
        this.emit('piece-changed', { pieceId });
    }

    deletePiece(pieceId) {
        const idx = this.project.pieces.findIndex((p) => p.id === pieceId);
        if (idx === -1) return;
        this._pushHistoryStep();
        this.project.pieces.splice(idx, 1);
        if (this.activePieceId === pieceId) {
            // 選取原本在清單中同一位置遞補上來的鄰居（刪的是最後一個則退回新的最後一個），
            // 讓連續刪除多個物件時焦點留在原地，不會每刪一個就跳到清單開頭。
            const fallbackIdx = Math.min(idx, this.project.pieces.length - 1);
            this.activePieceId = this.project.pieces[fallbackIdx]?.id ?? null;
            this.emit('active-piece-changed', {});
        }
        this.emit('project-changed', {});
    }

    getActivePiece() {
        return this.project.pieces.find((p) => p.id === this.activePieceId) ?? null;
    }

    getActiveScan() {
        return this.project.scans.find((s) => s.id === this.activeScanId) ?? null;
    }

    setActivePiece(pieceId) {
        const piece = this.project.pieces.find((p) => p.id === pieceId);
        this.activePieceId = pieceId;
        if (piece && piece.scanId !== this.activeScanId) {
            this.activeScanId = piece.scanId;
            // scan-changed 要先於 active-piece-changed 觸發：前者驅動 ScanView.loadActiveScan()
            // 切換工作區顯示的圖片，若順序相反，active-piece-changed 觸發的 draw() 會搶在
            // 換圖之前對著舊圖畫選取框/擦除標記，位置對不上新載入的圖。
            this.emit('scan-changed', { scanId: this.activeScanId });
        }
        this.emit('active-piece-changed', {});
    }

    setActiveScan(scanId) {
        this.activeScanId = scanId;
        this.emit('scan-changed', { scanId });
    }

    setActiveTool(tool) {
        this.activeTool = tool;
        this.emit('tool-changed', { tool });
    }
}

export const store = new Store();
export { makeId };
