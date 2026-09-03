// .pitra 專案檔格式：manifest.json + sources/<scanId>.<ext> + pieces/<pieceId>.json
// 封裝在 pitra-zip.js 手寫的 ZIP（STORED）容器中。Portable 模式：原始圖片位元組原封不動一起打包。

import { zipWrite, zipRead } from './pitra-zip.js';

export const PITRA_SCHEMA_VERSION = 1;

const MIME_EXT = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
};

function extFromMime(mime) {
    return MIME_EXT[mime] || '.bin';
}

// 舊版 .pitra 的套索選取只有單一 path/closed，新版改為 loops 陣列（支援複合路徑）；載入時就地轉換一次。
function normalizeLoadedPiece(piece) {
    const sel = piece.selection;
    if (sel?.type === 'lasso') {
        if (!sel.loops && sel.path) {
            piece.selection = { type: 'lasso', loops: [{ path: sel.path, closed: !!sel.closed, mode: 'add' }] };
        } else if (sel.loops) {
            sel.loops = sel.loops.map((loop) => ({ mode: 'add', ...loop }));
        }
    }

    // 舊版 threshold/softness 是使用者當初逐一物件手動調過的數值（同一個 RGB 距離尺度，
    // 現在演算法改回同一套 RGB 距離運算後兩者完全相容）——不能丟掉，很多物件的最佳效果
    // 就是靠這組數值調出來的（例如同一個專案裡從 threshold:2 到 threshold:124 都有，
    // 差異很大，套統一預設值只會讓一部分物件變差）。維持 strength 欄位是為了滑桿有個
    // 起始位置＋往後使用者微調時的介面模型，但只要 threshold/softness 還在，
    // computeMask() 一律優先採用這兩個原始數值，確保重新開啟舊專案至少跟當初存檔時一樣好。
    if (piece.bgRemoval && piece.bgRemoval.strength === undefined) {
        piece.bgRemoval = {
            enabled: piece.bgRemoval.enabled ?? true,
            sampleColor: piece.bgRemoval.sampleColor ?? { r: 255, g: 255, b: 255 },
            strength: 50,
            ...(piece.bgRemoval.threshold !== undefined && piece.bgRemoval.softness !== undefined
                ? { threshold: piece.bgRemoval.threshold, softness: piece.bgRemoval.softness }
                : {}),
        };
    }
    if (piece.enhance) delete piece.enhance;

    return piece;
}

/**
 * @param {import('./state.js').Project} project
 * @returns {Uint8Array}
 */
export function serializeProject(project) {
    const entries = [];
    const encoder = new TextEncoder();

    const manifest = {
        schema: PITRA_SCHEMA_VERSION,
        name: project.name,
        createdAt: project.createdAt,
        mode: 'portable',
        scans: project.scans.map((s) => ({
            id: s.id,
            filename: s.filename,
            mime: s.mime,
            width: s.width,
            height: s.height,
            dpi: s.dpi ?? null,
        })),
        pieceOrder: project.pieces.map((p) => p.id),
    };
    entries.push({ name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest, null, 2)) });

    for (const scan of project.scans) {
        entries.push({
            name: `sources/${scan.id}${extFromMime(scan.mime)}`,
            data: new Uint8Array(scan.bytes),
        });
    }
    for (const piece of project.pieces) {
        entries.push({ name: `pieces/${piece.id}.json`, data: encoder.encode(JSON.stringify(piece, null, 2)) });
    }

    return zipWrite(entries);
}

/**
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {import('./state.js').Project}
 */
export function parseProjectZip(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const files = zipRead(u8);
    const decoder = new TextDecoder();

    const manifestBytes = files.get('manifest.json');
    if (!manifestBytes) {
        throw new Error('找不到 manifest.json，這不是有效的 .pitra 專案檔');
    }
    const manifest = JSON.parse(decoder.decode(manifestBytes));

    const scans = manifest.scans.map((s) => {
        const entry = [...files.entries()].find(([name]) => name.startsWith(`sources/${s.id}.`));
        if (!entry) {
            throw new Error(`遺失原始圖片資料：${s.filename}`);
        }
        return { ...s, bytes: entry[1].buffer };
    });

    const pieces = manifest.pieceOrder.map((id) => {
        const data = files.get(`pieces/${id}.json`);
        if (!data) {
            throw new Error(`遺失物件資料：${id}`);
        }
        return normalizeLoadedPiece(JSON.parse(decoder.decode(data)));
    });

    return {
        schema: manifest.schema,
        name: manifest.name,
        createdAt: manifest.createdAt,
        scans,
        pieces,
    };
}
