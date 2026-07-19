// Render an emoji category marker to an ImageData for MapLibre's addImage().
// A bright teardrop pin so it pops on the dark map (dark pins were invisible).

export function makePinImage(emoji: string): ImageData {
  const scale = 2;
  const w = 46 * scale;
  const h = 58 * scale;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  const cx = 23;
  const cy = 21;
  const r = 18;

  // Soft drop shadow for depth on the dark map.
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;

  // Pointer + coin as one bright shape.
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy + 9);
  ctx.lineTo(cx + 8, cy + 9);
  ctx.lineTo(cx, cy + 28);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Ring (no shadow) + emoji.
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#3b82f6';
  ctx.stroke();

  ctx.font = '21px -apple-system, "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, cx, cy + 1);

  return ctx.getImageData(0, 0, w, h);
}
