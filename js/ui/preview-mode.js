// 預覽模式（原始/遮罩/疊加/結果）只是畫面呈現偏好，不寫進 piece 資料也不寫進 .pitra，
// 用獨立的 EventTarget pub/sub 讓 toolbar.js（負責寫入）跟 preview-pane.js（負責讀取重繪）
// 不需要互相 import，避免循環依賴。

const target = new EventTarget();
let mode = 'result';

export function getPreviewMode() {
    return mode;
}

export function setPreviewMode(next) {
    if (next === mode) return;
    mode = next;
    target.dispatchEvent(new Event('change'));
}

export function onPreviewModeChange(fn) {
    target.addEventListener('change', fn);
}
