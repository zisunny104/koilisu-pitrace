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
        return JSON.parse(decoder.decode(data));
    });

    return {
        schema: manifest.schema,
        name: manifest.name,
        createdAt: manifest.createdAt,
        scans,
        pieces,
    };
}
