// 平面化選取的重運算搬到背景執行緒跑，避免點下按鈕當下讓分頁整個沒回應（見
// selection-geometry.js 的 flattenLoops：點陣化＋marching squares＋巢狀深度比對，
// 資料量大時單次可能耗時數百毫秒到數秒）。flattenLoops 本身不碰 DOM／store，
// 純資料進、純資料出，原封不動搬進 Worker 執行即可，邏輯完全沒變。

import { flattenLoops } from '../canvas/selection-geometry.js';

self.onmessage = (e) => {
    const { requestId, loops } = e.data;
    try {
        const flattened = flattenLoops(loops);
        self.postMessage({ requestId, flattened });
    } catch (err) {
        self.postMessage({ requestId, error: String(err) });
    }
};
