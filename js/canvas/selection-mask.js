// 套索選取範圍的遮罩合成：依 loop 順序逐一疊加，mode==='subtract' 一律明確挖空、
// mode==='add' 一律明確加回，不受重疊次數的奇偶影響（不是 evenodd 規則）。

export function buildSelectionMask(loops, width, height, offsetX = 0, offsetY = 0, scale = 1) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    for (const loop of loops) {
        ctx.globalCompositeOperation = loop.mode === 'subtract' ? 'destination-out' : 'source-over';
        ctx.beginPath();
        loop.path.forEach((p, i) => {
            const x = (p.x - offsetX) * scale;
            const y = (p.y - offsetY) * scale;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = '#000';
        ctx.fill();
    }
    return canvas;
}
