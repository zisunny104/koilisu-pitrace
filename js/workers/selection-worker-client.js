// selection-worker.js 的主執行緒端包裝：整個分頁 session 只建立一次 Worker（避免每次
// 平面化都重新載入模組），用 requestId 對應多個並行中的請求各自的 Promise。

let worker = null;
let nextRequestId = 1;
const pending = new Map();

function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./selection-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
        const { requestId, flattened, error } = e.data;
        const request = pending.get(requestId);
        if (!request) return;
        pending.delete(requestId);
        if (error) request.reject(new Error(error));
        else request.resolve(flattened);
    };
    worker.onerror = (e) => {
        for (const request of pending.values()) request.reject(e.error ?? new Error(e.message));
        pending.clear();
    };
    return worker;
}

/** @param {Array<{path:{x:number,y:number}[], closed:boolean, mode:'add'|'subtract'}>} loops */
export function flattenLoopsAsync(loops) {
    return new Promise((resolve, reject) => {
        const requestId = nextRequestId++;
        pending.set(requestId, { resolve, reject });
        ensureWorker().postMessage({ requestId, loops });
    });
}
