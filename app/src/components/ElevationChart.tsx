// A compact elevation profile (SVG area chart) + total gain for one activity.
// Profile = ~30 sampled elevations in meters; gain in meters.
export default function ElevationChart({
  profile,
  gainM,
}: {
  profile: number[] | null;
  gainM: number | null;
}) {
  if (!profile || profile.length < 2) return null;
  const W = 300;
  const H = 56;
  const pad = 2;
  const min = Math.min(...profile);
  const max = Math.max(...profile);
  const range = max - min || 1;
  const pts = profile.map((e, i) => {
    const x = pad + (i / (profile.length - 1)) * (W - 2 * pad);
    const y = H - pad - ((e - min) / range) * (H - 2 * pad - 6);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z`;
  const gainFt = gainM != null ? Math.round(gainM * 3.28084) : null;
  return (
    <div className="elev-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="elev-svg" preserveAspectRatio="none" aria-hidden>
        <path d={area} className="elev-area" />
        <path d={line} className="elev-line" />
      </svg>
      {gainFt != null && gainFt > 0 && (
        <div className="elev-label">↑ {gainFt.toLocaleString()} ft climbed</div>
      )}
    </div>
  );
}
