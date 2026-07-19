// Render an emoji category marker to an ImageData for MapLibre's addImage().
// A rounded "coin" with a small pointer — reads cleanly on the dark map.

export function makePinImage(emoji: string): ImageData {
  const scale = 2;
  const w = 44 * scale;
  const h = 54 * scale;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  const cx = 22;
  const cy = 20;
  const r = 17;

  // Pointer triangle
  ctx.beginPath();
  ctx.moveTo(cx - 7, cy + 8);
  ctx.lineTo(cx + 7, cy + 8);
  ctx.lineTo(cx, cy + 24);
  ctx.closePath();
  ctx.fillStyle = '#0e1728';
  ctx.fill();

  // Coin
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#0e1728';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#3b82f6';
  ctx.stroke();

  // Emoji
  ctx.font = '20px -apple-system, "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, cx, cy + 1);

  return ctx.getImageData(0, 0, w, h);
}
