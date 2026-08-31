// 簡易 pub/sub store：管理 Pitrace 專案資料模型。
// 不使用任何前端框架或狀態庫，靠原生 EventTarget 做局部重繪通知。

let counter = 0;
function makeId(prefix) {
    counter += 1;
    return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
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
        selection: { type: 'rect', rect: null, path: null, closed: false },
        rotation: 0,
        bgRemoval: {
            enabled: true,
            sampleColor: { r: 255, g: 255, b: 255 },
            threshold: 40,
            softness: 24,
        },
        ...overrides,
    };
}

const HISTORY_LIMIT = 50;
const HISTORY_COALESCE_MS = 500;

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
        this._bitmapCache.forEach((bmp) => bmp.close && bmp.close());
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

    async getScanBitmap(scanId) {
        if (this._bitmapCache.has(scanId)) {
            return this._bitmapCache.get(scanId);
        }
        const scan = this.project.scans.find((s) => s.id === scanId);
        if (!scan) return null;
        const blob = new Blob([scan.bytes], { type: scan.mime });
        const bitmap = await createImageBitmap(blob);
        this._bitmapCache.set(scanId, bitmap);
        return bitmap;
    }

    addPiece(scanId, overrides = {}) {
        this._pushHistoryStep();
        const piece = createPiece(scanId, overrides);
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
