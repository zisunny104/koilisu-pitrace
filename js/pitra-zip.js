// 手寫、零依賴的 ZIP（STORED，不壓縮）讀寫模組。
// Pitrace 刻意不使用 fflate/jszip 等第三方函式庫：.pitra 內容物本來就是已壓縮的
// PNG/JPEG/WebP 加上小型 JSON，壓縮增益很小；手寫可完全避免任何外部依賴與 CDN 執行期呼叫。

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;
const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
    const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1F);
    const day = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0xF) << 5) | (date.getDate() & 0x1F);
    return { time, day };
}

/**
 * @param {{name: string, data: Uint8Array}[]} entries
 * @returns {Uint8Array}
 */
export function zipWrite(entries) {
    const encoder = new TextEncoder();
    const prepared = entries.map((e) => ({
        nameBytes: encoder.encode(e.name),
        data: e.data,
        crc: crc32(e.data),
    }));

    let localSectionSize = 0;
    let centralSectionSize = 0;
    for (const p of prepared) {
        localSectionSize += LOCAL_HEADER_SIZE + p.nameBytes.length + p.data.length;
        centralSectionSize += CENTRAL_HEADER_SIZE + p.nameBytes.length;
    }

    const total = localSectionSize + centralSectionSize + EOCD_SIZE;
    const buf = new Uint8Array(total);
    const view = new DataView(buf.buffer);
    const { time, day } = dosDateTime();
    const localOffsets = [];
    let offset = 0;

    for (const p of prepared) {
        localOffsets.push(offset);
        view.setUint32(offset, LOCAL_SIG, true); offset += 4;
        view.setUint16(offset, 20, true); offset += 2; // version needed
        view.setUint16(offset, 0x0800, true); offset += 2; // flags: UTF-8 檔名
        view.setUint16(offset, 0, true); offset += 2; // compression: stored
        view.setUint16(offset, time, true); offset += 2;
        view.setUint16(offset, day, true); offset += 2;
        view.setUint32(offset, p.crc, true); offset += 4;
        view.setUint32(offset, p.data.length, true); offset += 4; // compressed size
        view.setUint32(offset, p.data.length, true); offset += 4; // uncompressed size
        view.setUint16(offset, p.nameBytes.length, true); offset += 2;
        view.setUint16(offset, 0, true); offset += 2; // extra length
        buf.set(p.nameBytes, offset); offset += p.nameBytes.length;
        buf.set(p.data, offset); offset += p.data.length;
    }

    const centralStart = offset;
    for (let i = 0; i < prepared.length; i++) {
        const p = prepared[i];
        view.setUint32(offset, CENTRAL_SIG, true); offset += 4;
        view.setUint16(offset, 20, true); offset += 2; // version made by
        view.setUint16(offset, 20, true); offset += 2; // version needed
        view.setUint16(offset, 0x0800, true); offset += 2;
        view.setUint16(offset, 0, true); offset += 2;
        view.setUint16(offset, time, true); offset += 2;
        view.setUint16(offset, day, true); offset += 2;
        view.setUint32(offset, p.crc, true); offset += 4;
        view.setUint32(offset, p.data.length, true); offset += 4;
        view.setUint32(offset, p.data.length, true); offset += 4;
        view.setUint16(offset, p.nameBytes.length, true); offset += 2;
        view.setUint16(offset, 0, true); offset += 2; // extra length
        view.setUint16(offset, 0, true); offset += 2; // comment length
        view.setUint16(offset, 0, true); offset += 2; // disk number start
        view.setUint16(offset, 0, true); offset += 2; // internal attrs
        view.setUint32(offset, 0, true); offset += 4; // external attrs
        view.setUint32(offset, localOffsets[i], true); offset += 4;
        buf.set(p.nameBytes, offset); offset += p.nameBytes.length;
    }
    const centralSize = offset - centralStart;

    view.setUint32(offset, EOCD_SIG, true); offset += 4;
    view.setUint16(offset, 0, true); offset += 2; // disk number
    view.setUint16(offset, 0, true); offset += 2; // disk with central dir
    view.setUint16(offset, prepared.length, true); offset += 2;
    view.setUint16(offset, prepared.length, true); offset += 2;
    view.setUint32(offset, centralSize, true); offset += 4;
    view.setUint32(offset, centralStart, true); offset += 4;
    view.setUint16(offset, 0, true); offset += 2; // comment length

    return buf;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Map<string, Uint8Array>}
 */
export function zipRead(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const minOffset = Math.max(0, bytes.length - EOCD_SIZE - 65535);
    let eocdOffset = -1;
    for (let i = bytes.length - EOCD_SIZE; i >= minOffset; i--) {
        if (view.getUint32(i, true) === EOCD_SIG) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset === -1) {
        throw new Error('不是有效的 .pitra（ZIP）檔案：找不到目錄結尾記錄');
    }

    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralOffset = view.getUint32(eocdOffset + 16, true);

    const decoder = new TextDecoder();
    const result = new Map();
    let offset = centralOffset;

    for (let i = 0; i < entryCount; i++) {
        const sig = view.getUint32(offset, true);
        if (sig !== CENTRAL_SIG) {
            throw new Error('.pitra 中央目錄毀損，無法讀取');
        }
        const compression = view.getUint16(offset + 10, true);
        const compSize = view.getUint32(offset + 20, true);
        const nameLen = view.getUint16(offset + 28, true);
        const extraLen = view.getUint16(offset + 30, true);
        const commentLen = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);
        const nameBytes = bytes.subarray(offset + CENTRAL_HEADER_SIZE, offset + CENTRAL_HEADER_SIZE + nameLen);
        const name = decoder.decode(nameBytes);

        if (compression !== 0) {
            throw new Error(`不支援的壓縮方式（${name}）：Pitrace 只能讀取未壓縮（STORED）的 .pitra 檔`);
        }

        const localNameLen = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + LOCAL_HEADER_SIZE + localNameLen + localExtraLen;
        const data = bytes.slice(dataStart, dataStart + compSize);

        result.set(name, data);
        offset += CENTRAL_HEADER_SIZE + nameLen + extraLen + commentLen;
    }

    return result;
}
