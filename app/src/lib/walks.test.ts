import { describe, expect, it } from 'vitest';
import { walkSegments, type Ping } from './walks';

// Build a straight line of pings ~15 m apart at a given cadence (seconds apart).
function line(startLat: number, n: number, secApart: number, metersApart: number): Ping[] {
  const dLat = metersApart / 111_320; // ~m per deg lat
  const out: Ping[] = [];
  let t = Date.parse('2026-01-01T12:00:00Z');
  for (let i = 0; i < n; i++) {
    out.push({ lat: startLat + i * dLat, lng: -77.5, recorded_at: new Date(t).toISOString() });
    t += secApart * 1000;
  }
  return out;
}

describe('walkSegments', () => {
  it('keeps a slow continuous walk', () => {
    // 10 pts, 15 m / 12 s ≈ 1.25 m/s (a walk)
    const segs = walkSegments(line(39, 10, 12, 15));
    expect(segs.length).toBe(1);
    expect(segs[0].length).toBe(10);
  });

  it('drops a driving-speed track (too fast)', () => {
    // 15 m / 1 s = 15 m/s ≈ 33 mph → excluded
    expect(walkSegments(line(39, 10, 1, 15))).toHaveLength(0);
  });

  it('splits on a long time gap', () => {
    const a = line(39, 10, 12, 20);
    const b = line(40, 10, 12, 20).map((p) => ({
      ...p,
      recorded_at: new Date(Date.parse(p.recorded_at) + 3_600_000).toISOString(),
    }));
    // The jump between a and b is a huge distance + gap → two separate walks.
    expect(walkSegments([...a, ...b]).length).toBe(2);
  });

  it('ignores a too-short segment', () => {
    // only 2 points → below MIN_SEG_POINTS
    expect(walkSegments(line(39, 2, 12, 15))).toHaveLength(0);
  });
});
