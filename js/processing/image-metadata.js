// 從 PNG/JPEG 檔案位元組直接解析既有的 DPI metadata，不依賴任何第三方函式庫、不需要使用者
// 手動輸入。偵測不到時（螢幕截圖、被去除 metadata 的檔案、非 PNG/JPEG 格式）回傳 null，
// 由呼叫端決定要不要讓使用者手動填。

// PNG：8-byte 簽章後每個 chunk 是 [4-byte length][4-byte type][data][4-byte CRC]。
// pHYs（9-byte payload）：pixelsPerUnitX/Y 各 4-byte big-endian uint32 + 1-byte unit。
// pHYs 依規範一定在 IDAT 之前，掃到 IDAT 就能提早結束。
export function readPngPhys(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 8) return null;
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;

    let offset = 8;
    while (offset + 8 <= bytes.length) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
        const dataStart = offset + 8;
        if (type === 'IDAT') break;
        if (type === 'pHYs' && length === 9 && dataStart + 9 <= bytes.length) {
            const pixelsPerUnitX = view.getUint32(dataStart);
            const unit = bytes[dataStart + 8];
            if (unit === 1) {
                const dpi = Math.round(pixelsPerUnitX / 39.3701);
                return dpi > 0 ? dpi : null;
            }
            return null; // unit 0：純比例、無實體單位可換算
        }
        offset = dataStart + length + 4; // +4 跳過 CRC
    }
    return null;
}

// JPEG：0xFFD8 開頭，每個 marker 後接 2-byte 長度 + payload，直到 SOS(0xFFDA) 或找到 APP0。
// APP0 payload 以 "JFIF\0" 開頭時帶 units(1 byte: 0=無, 1=DPI, 2=每公分) + Xdensity(2-byte BE)。
export function readJpegJfifDensity(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

    let offset = 2;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) break;
        const marker = bytes[offset + 1];
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2;
            continue;
        }
        if (marker === 0xda) break; // SOS：進入掃描資料，APP0 一定在這之前
        const segLength = view.getUint16(offset + 2);
        const payloadStart = offset + 4;
        if (marker === 0xe0 && payloadStart + 7 <= bytes.length) {
            const isJfif =
                bytes[payloadStart] === 0x4a &&
                bytes[payloadStart + 1] === 0x46 &&
                bytes[payloadStart + 2] === 0x49 &&
                bytes[payloadStart + 3] === 0x46 &&
                bytes[payloadStart + 4] === 0x00;
            if (isJfif) {
                const units = bytes[payloadStart + 5];
                const xDensity = view.getUint16(payloadStart + 6);
                if (units === 1) return xDensity > 0 ? xDensity : null;
                if (units === 2) return xDensity > 0 ? Math.round(xDensity * 2.54) : null;
                return null; // units 0：無單位
            }
        }
        offset = payloadStart + segLength - 2;
    }
    return null;
}

/**
 * @param {Uint8Array} bytes 檔案原始位元組
 * @param {string} mime
 * @returns {number|null}
 */
export function detectImageDpi(bytes, mime) {
    try {
        if (mime === 'image/png') return readPngPhys(bytes);
        if (mime === 'image/jpeg' || mime === 'image/jpg') return readJpegJfifDensity(bytes);
        return null;
    } catch {
        return null; // 檔案格式異常時安靜回傳 null，不影響匯入流程
    }
}
