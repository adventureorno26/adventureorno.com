// The shape of a route, drawn small.
//
// WHY THIS EXISTS. Erica, 2026-08-18: *"I can't rename a string of letters I have no idea
// where the route is."* A review card asked her to name an activity and showed only its
// auto-generated name — so answering it would have been guessing, which is the one thing
// the whole review design exists to prevent.
//
// Deliberately NOT a map. A tile layer here would cost a network round trip per card, and
// the question the card asks is "which outing is this?" — for that, the SHAPE plus the
// place name plus a way to open it is enough, and it renders instantly from data the card
// already carries.
import polyline from '@mapbox/polyline';

export default function RouteThumb({
  encoded,
  width = 132,
  height = 96,
  className,
}: {
  encoded: string | null | undefined;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!encoded) return null;
  let pts: [number, number][] = [];
  try {
    pts = polyline.decode(encoded) as [number, number][];
  } catch {
    return null;
  }
  if (pts.length < 2) return null;

  const lats = pts.map((p) => p[0]);
  const lngs = pts.map((p) => p[1]);
  const la0 = Math.min(...lats);
  const la1 = Math.max(...lats);
  const lo0 = Math.min(...lngs);
  const lo1 = Math.max(...lngs);
  // Latitude-corrected, or every route looks stretched sideways.
  const kx = Math.cos((((la0 + la1) / 2) * Math.PI) / 180);
  const pad = 8;
  const dx = Math.max((lo1 - lo0) * kx, 1e-9);
  const dy = Math.max(la1 - la0, 1e-9);
  const s = Math.min((width - 2 * pad) / dx, (height - 2 * pad) / dy);
  const ox = (width - dx * s) / 2;
  const oy = (height - dy * s) / 2;
  const d = pts
    .map((p, i) => {
      const x = ox + (p[1] - lo0) * kx * s;
      const y = height - (oy + (p[0] - la0) * s);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const start = pts[0];
  const sx = ox + (start[1] - lo0) * kx * s;
  const sy = height - (oy + (start[0] - la0) * s);

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="The shape of this route"
    >
      <path
        d={d}
        fill="none"
        stroke="var(--accent, #2a78d6)"
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={sx} cy={sy} r="3.2" fill="var(--accent, #2a78d6)" />
    </svg>
  );
}
