// Modern colored teardrop map pins with a white line-glyph per category.
// Rendered to ImageData for MapLibre's addImage().

type Ctx = CanvasRenderingContext2D;

/* Simple monochrome (white) glyphs, drawn centered at (x, y) in a ~16px box. */
const GLYPHS: Record<string, (c: Ctx, x: number, y: number) => void> = {
  dining(c, x, y) {
    line(c, x - 4, y - 6, x - 4, y + 6);
    line(c, x - 6, y - 6, x - 6, y - 2);
    line(c, x - 2, y - 6, x - 2, y - 2);
    line(c, x + 4, y - 6, x + 4, y + 6);
    line(c, x + 4, y - 6, x + 6, y - 4);
  },
  winery(c, x, y) {
    c.beginPath();
    c.moveTo(x - 5, y - 6);
    c.lineTo(x, y);
    c.lineTo(x + 5, y - 6);
    c.stroke();
    line(c, x, y, x, y + 6);
    line(c, x - 4, y + 6, x + 4, y + 6);
  },
  brewery(c, x, y) {
    c.strokeRect(x - 5, y - 6, 8, 12);
    c.beginPath();
    c.arc(x + 5, y, 3, -Math.PI / 2, Math.PI / 2);
    c.stroke();
  },
  beach(c, x, y) {
    circle(c, x, y - 3, 3.2);
    c.beginPath();
    c.moveTo(x - 6, y + 5);
    c.quadraticCurveTo(x - 3, y + 2, x, y + 5);
    c.quadraticCurveTo(x + 3, y + 8, x + 6, y + 5);
    c.stroke();
  },
  camping(c, x, y) {
    c.beginPath();
    c.moveTo(x - 7, y + 6);
    c.lineTo(x, y - 6);
    c.lineTo(x + 7, y + 6);
    c.closePath();
    c.stroke();
    line(c, x, y - 6, x, y + 6);
  },
  sunrise(c, x, y) {
    c.beginPath();
    c.arc(x, y + 2, 3.4, Math.PI, 0);
    c.stroke();
    line(c, x - 7, y + 4, x + 7, y + 4);
    line(c, x, y - 6, x, y - 3);
  },
  sunset(c, x, y) {
    c.beginPath();
    c.arc(x, y - 1, 3.4, 0, Math.PI);
    c.stroke();
    line(c, x - 7, y - 1, x + 7, y - 1);
    line(c, x, y + 3, x, y + 6);
  },
  hiking(c, x, y) {
    c.beginPath();
    c.moveTo(x - 7, y + 6);
    c.lineTo(x - 1, y - 5);
    c.lineTo(x + 2, y - 1);
    c.lineTo(x + 4, y - 4);
    c.lineTo(x + 7, y + 6);
    c.closePath();
    c.stroke();
  },
  walking(c, x, y) {
    circle(c, x, y - 5, 2);
    line(c, x, y - 3, x, y + 1);
    line(c, x, y + 1, x - 3, y + 6);
    line(c, x, y + 1, x + 3, y + 6);
    line(c, x, y - 2, x + 3, y + 1);
  },
  running(c, x, y) {
    circle(c, x + 1, y - 5, 2);
    line(c, x + 1, y - 3, x - 1, y + 1);
    line(c, x - 1, y + 1, x - 4, y + 5);
    line(c, x - 1, y + 1, x + 3, y + 6);
    line(c, x, y - 2, x + 4, y - 1);
  },
  biking(c, x, y) {
    circle(c, x - 4, y + 3, 3);
    circle(c, x + 4, y + 3, 3);
    c.beginPath();
    c.moveTo(x - 4, y + 3);
    c.lineTo(x, y - 2);
    c.lineTo(x + 4, y + 3);
    c.moveTo(x, y - 2);
    c.lineTo(x + 2, y - 4);
    c.stroke();
  },
  jeeping(c, x, y) {
    c.beginPath();
    c.moveTo(x - 7, y + 2);
    c.lineTo(x - 5, y - 2);
    c.lineTo(x + 5, y - 2);
    c.lineTo(x + 7, y + 2);
    c.stroke();
    line(c, x - 7, y + 2, x + 7, y + 2);
    circle(c, x - 4, y + 4, 1.6);
    circle(c, x + 4, y + 4, 1.6);
  },
  viewpoint(c, x, y) {
    circle(c, x - 3, y + 1, 3);
    circle(c, x + 3, y + 1, 3);
    line(c, x - 1, y - 1, x + 1, y - 1);
  },
  stay(c, x, y) {
    c.beginPath();
    c.moveTo(x - 7, y + 4);
    c.lineTo(x - 7, y);
    c.lineTo(x + 7, y);
    c.lineTo(x + 7, y + 4);
    c.stroke();
    c.beginPath();
    c.arc(x - 4, y, 2, Math.PI, 0);
    c.stroke();
    line(c, x - 7, y + 2, x + 7, y + 2);
  },
  default(c, x, y) {
    c.beginPath();
    c.arc(x, y, 3, 0, Math.PI * 2);
    c.fillStyle = '#fff';
    c.fill();
  },
};

function line(c: Ctx, x1: number, y1: number, x2: number, y2: number) {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}
function circle(c: Ctx, x: number, y: number, r: number) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.stroke();
}

export function makePinImage(slug: string, color: string): ImageData {
  const scale = 2;
  const w = 46 * scale;
  const h = 58 * scale;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  c.scale(scale, scale);

  const cx = 23;
  const cy = 21;
  const r = 17;

  // Teardrop (coin + pointer) with a soft shadow.
  c.shadowColor = 'rgba(0,0,0,0.45)';
  c.shadowBlur = 4;
  c.shadowOffsetY = 2;
  c.beginPath();
  c.moveTo(cx - 8, cy + 8);
  c.lineTo(cx + 8, cy + 8);
  c.lineTo(cx, cy + 28);
  c.closePath();
  c.fillStyle = color;
  c.fill();
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();

  // White ring + white glyph (no shadow).
  c.shadowColor = 'transparent';
  c.lineWidth = 2;
  c.strokeStyle = 'rgba(255,255,255,0.9)';
  c.stroke();

  c.strokeStyle = '#ffffff';
  c.fillStyle = '#ffffff';
  c.lineWidth = 1.7;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  (GLYPHS[slug] ?? GLYPHS.default)(c, cx, cy);

  return c.getImageData(0, 0, w, h);
}
