// 專案自動儲存：避免重新整理或分頁當掉時進度立刻消失。存放在 IndexedDB——掃描圖原始
// 位元組可能不小，localStorage 的字串式容量/效能撐不住。payload 直接沿用既有的 .pitra
// 序列化格式（pitra-format.js），固定用同一把 key 覆寫最新狀態，不做版本歷史。
// 編輯後 debounce 一段時間才真的寫入，避免每次拖曳/放開滑鼠都重新打包一次整個專案。

import { store, createEmptyProject } from './state.js';
import { serializeProject, parseProjectZip } from './pitra-format.js';
import { announce } from './a11y.js';

const DB_NAME = 'pitrace-autosave';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const SNAPSHOT_KEY = 'current';
const AUTOSAVE_DEBOUNCE_MS = 2500;

function openDb() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('此瀏覽器不支援 IndexedDB'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE_NAME);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function saveSnapshot(bytes, meta) {
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put({ bytes, ...meta }, SNAPSHOT_KEY);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch (err) {
        console.warn('[autosave] 寫入失敗，略過', err);
    }
}

export async function loadSnapshot() {
    try {
        const db = await openDb();
        const result = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });
        db.close();
        return result;
    } catch (err) {
        console.warn('[autosave] 讀取失敗，視為沒有自動儲存', err);
        return null;
    }
}

export async function clearSnapshot() {
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(SNAPSHOT_KEY);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch (err) {
        console.warn('[autosave] 清除失敗，略過', err);
    }
}

function formatTime(iso) {
    try {
        return new Date(iso).toLocaleString('zh-TW', { hour12: false });
    } catch {
        return iso;
    }
}

/**
 * 掛上自動儲存（訂閱 store 變化、debounce 寫入 IndexedDB）並在啟動時檢查是否有上次
 * 未正常關閉留下的快照，詢問使用者要不要復原。
 * @param {HTMLElement} statusEl
 */
export function initAutosave(statusEl) {
    let timer = null;
    let suspended = false; // 還原流程進行中先暫停自動儲存，避免自己覆寫自己剛讀出來的快照

    function scheduleSave() {
        if (suspended) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            const hasContent = store.project.scans.length > 0 || store.project.pieces.length > 0;
            if (!hasContent) {
                // 使用者主動清空專案（例如刪光所有掃描圖）也要清掉舊快照，
                // 不然下次重開會把已經刪除的內容從舊快照復活回來，變成刪不掉。
                clearSnapshot();
                return;
            }
            const bytes = serializeProject(store.project);
            saveSnapshot(bytes, { name: store.project.name, savedAt: new Date().toISOString() });
        }, AUTOSAVE_DEBOUNCE_MS);
    }

    store.addEventListener('project-changed', scheduleSave);
    store.addEventListener('piece-changed', scheduleSave);

    (async () => {
        const snapshot = await loadSnapshot();
        if (!snapshot) return;
        suspended = true;
        const when = formatTime(snapshot.savedAt);
        const restore = window.confirm(
            `偵測到上次未正常關閉留下的自動儲存記錄（${when}，專案「${snapshot.name || '未命名專案'}」）。\n\n要復原這份進度嗎？\n確定＝復原　取消＝捨棄`
        );
        if (restore) {
            try {
                const project = parseProjectZip(snapshot.bytes);
                store.setProject(project);
                const nameInput = document.getElementById('projectNameInput');
                if (nameInput) nameInput.value = project.name;
                announce(statusEl, `已從自動儲存復原專案「${project.name}」`);
            } catch (err) {
                announce(statusEl, `自動儲存的資料已損毀，無法復原：${err.message}`);
                await clearSnapshot();
            }
        } else {
            await clearSnapshot();
            announce(statusEl, '已捨棄自動儲存的進度');
        }
        suspended = false;
    })();
}
