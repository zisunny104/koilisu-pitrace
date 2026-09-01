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
        enhance: {
            contrast: 0,
            brightness: 0,
        },
        bgRemoval: {
            enabled: true,
            sampleColor: { r: 255, g: 255, b: 255 },
            threshold: 40,
            softness: 24,
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
// 防解壓縮炸彈：拒絕解碼後超過此像素量的圖片（約 7746x7746，600dpi A4/A3 掃描仍有餘裕），
// 精心壓縮成小檔案、解碼後卻是數十億像素的惡意 PNG 會被擋下，避免分頁記憶體暴增當機。
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
        this.project.pieces = prev;
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
        this.project.pieces = next;
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
        this.emit('active-piece-changed', {});
        this.emit('scan-changed', { scanId: this.activeScanId });
    }

    async addScan({ filename, mime, bytes, width, height }) {
        const scan = { id: makeId('scan'), filename, mime, bytes, width, height };
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
        this.emit('active-piece-changed', {});
        this.emit('scan-changed', { scanId: this.activeScanId });
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
        const bitmap = await createImageBitmap(blob);
        if (bitmap.width * bitmap.height > MAX_SCAN_PIXELS) {
            const { width, height } = bitmap;
            bitmap.close();
            this._bitmapCache.set(scanId, null);
            this.emit('scan-oversized', { scanId, width, height });
            return null;
        }
        this._cacheBitmap(scanId, bitmap);
        return bitmap;
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
            this.activePieceId = this.project.pieces[0]?.id ?? null;
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
        if (piece) this.activeScanId = piece.scanId;
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
