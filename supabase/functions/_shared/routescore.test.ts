// The port must agree with the prototype it replaces.
//
// scripts/naming/route-scoring-results-2026-08-09.txt records what
// scripts/naming/route_namer.py actually produced on 13 real routes. Those recorded
// tallies are the fixtures below, so this reproduces the measured result WITHOUT
// touching the network — which also means a passing test can't be an Overpass fluke.
//
// Every case has the shape: given exactly these OSM hits, name the route.

import { describe, it, expect } from 'vitest';
import { decodePolyline } from './polyline';
import { samplePoints, buildOverpassQuery, scoreRoute, tally } from './routescore';
import type { OverpassElement } from './routescore';

/** Rebuild Overpass elements from a recorded tally. */
function hits(trails: Record<string, number>, parks: Record<string, number>): OverpassElement[] {
  const out: OverpassElement[] = [];
  for (const [name, n] of Object.entries(trails)) {
    for (let i = 0; i < n; i++) out.push({ type: 'way', tags: { name, highway: 'path' } });
  }
  for (const [name, n] of Object.entries(parks)) {
    for (let i = 0; i < n; i++) out.push({ type: 'area', tags: { name, leisure: 'park' } });
  }
  return out;
}

const top = (els: OverpassElement[], n = 9) => scoreRoute(els, n).candidates[0];

describe('route scoring reproduces the measured prototype output', () => {
  it('Warren County -> Dickey Ridge Trail (trail 7/9, inside Shenandoah NP 9/9)', () => {
    const s = scoreRoute(
      hits(
        {
          'Dickey Ridge Trail': 7,
          'Snead Farm Road': 2,
          'Fox Hollow Trail': 2,
          'Snead Farm Loop Trail': 1,
          'Pumphouse Access Trail': 1,
        },
        { 'Shenandoah National Park': 9 },
      ),
      9,
    );
    expect(s.strength).toBe('trail');
    expect(s.candidates[0]).toMatchObject({ name: 'Dickey Ridge Trail', kind: 'trail', count: 7 });
    // The park it runs through is always offered second, never hidden.
    expect(s.candidates[1]).toMatchObject({ name: 'Shenandoah National Park', kind: 'park' });
  });

  it('Shenandoah County -> Massanutten Trail', () => {
    expect(
      top(
        hits(
          { 'Massanutten Trail': 6, 'Veach GapTrail': 1, 'Veach Gap Trail': 1 },
          { 'George Washington National Forest': 9 },
        ),
      ).name,
    ).toBe('Massanutten Trail');
  });

  it('Top Hill -> Appalachian Trail', () => {
    expect(
      top(hits({ 'Appalachian Trail': 8 }, { 'Appalachian National Scenic Trail': 8 })).name,
    ).toBe('Appalachian Trail');
  });

  it('Locust Valley -> Appalachian National Scenic Trail', () => {
    expect(
      top(
        hits(
          { 'Appalachian National Scenic Trail': 8, 'Bear Spring Cabin Trail': 1 },
          { 'South Mountain State Battlefield': 6, 'Appalachian National Scenic Trail': 3 },
        ),
      ).name,
    ).toBe('Appalachian National Scenic Trail');
  });

  it('Clarke County -> Appalachian Trail, with Sky Meadows offered second', () => {
    // THE case for the whole design: both names are true, so neither is chosen silently.
    const s = scoreRoute(hits({ 'Appalachian Trail': 9 }, { 'Sky Meadows State Park': 8 }), 9);
    expect(s.candidates[0]).toMatchObject({ name: 'Appalachian Trail', confidence: 1 });
    expect(s.candidates[1]).toMatchObject({ name: 'Sky Meadows State Park', kind: 'park' });
  });

  it('Madison -> Shenandoah National Park (no single trail carries the route)', () => {
    const s = scoreRoute(
      hits(
        {
          'Berry Hollow Fire Road': 4,
          'Berry Hollow Trail': 4,
          'Old Rag Fire Road': 3,
          'Weakley Hollow Fire Road': 1,
        },
        { 'Shenandoah National Park': 9 },
      ),
      9,
    );
    expect(s.strength).toBe('park');
    expect(s.candidates[0].name).toBe('Shenandoah National Park');
  });

  it('Chesterfield -> Pocahontas State Park', () => {
    expect(
      top(
        hits(
          {
            'Beaver Lake Trail': 2,
            'Fendley Station Loop B': 1,
            'Loop Forest Trail': 1,
            'Co-Op Trail': 1,
            'FR 341': 1,
          },
          { 'Pocahontas State Park': 9 },
        ),
      ).name,
    ).toBe('Pocahontas State Park');
  });

  it('Bern Township -> Lake Border Trail', () => {
    expect(
      top(
        hits(
          { 'Lake Border Trail': 7 },
          { 'Blue Marsh Lake Recreation Area': 8, 'State Game Lands Number 280': 1 },
        ),
      ).name,
    ).toBe('Lake Border Trail');
  });

  it('Stream Weir -> George Washington National Forest', () => {
    expect(
      top(
        hits(
          { 'Shawl Gap Trail': 4, 'Massanutten Trail': 3, 'Tuscarora-Massanutten Trail': 2 },
          { 'George Washington National Forest': 9 },
        ),
      ).name,
    ).toBe('George Washington National Forest');
  });

  it('Riverpoint Drive Trailhead -> the containing area, since no trail carries it', () => {
    expect(
      top(hits({ 'Potomac Heritage Trail': 3 }, { 'Riverpoint Drive Trailhead': 6 })).name,
    ).toBe('Riverpoint Drive Trailhead');
  });

  it('Washington & Old Dominion -> the trail, not the regional park', () => {
    expect(
      top(
        hits(
          { 'Washington & Old Dominion Trail': 11, 'W&OD Bridle Trail': 5 },
          { 'Washington & Old Dominion Trail Regional Park': 7 },
        ),
        9,
      ).name,
    ).toBe('Washington & Old Dominion Trail');
  });

  it('Loudoun -> breaks a 9/9 tie deterministically (documented departure)', () => {
    // The prototype returned "W&OD Bridle Trail" here purely because Overpass listed
    // it first — Python's Counter breaks ties by insertion order. Both tally 9. We
    // break ties by the longer, more specific name, which is also the trail she
    // actually runs. Recorded output differs BY DESIGN; see routescore.ts DEPARTURE 1.
    const s = scoreRoute(
      hits(
        { 'W&OD Bridle Trail': 9, 'Washington & Old Dominion Trail': 9 },
        { 'Washington and Old Dominion Railroad Regional Park': 9 },
      ),
      9,
    );
    expect(s.candidates[0].name).toBe('Washington & Old Dominion Trail');
    // The bridle path is still offered — it is a real answer, just not the default.
    expect(s.candidates.map((c) => c.name)).toContain('W&OD Bridle Trail');
  });

  it('Red Rock -> NOTHING. No OSM data exists there, and 97 activities depend on it', () => {
    // §5.4. "No suggestion" must mean leave it alone. A suggester that helpfully
    // replaced a correct name with a town name would be worse than the bug it fixes.
    const s = scoreRoute([], 9);
    expect(s.candidates).toEqual([]);
    expect(s.strength).toBeNull();
  });
});

describe('negative controls', () => {
  it('a single stray hit never names a route', () => {
    const s = scoreRoute(hits({ 'Some Random Connector': 1 }, {}), 9);
    expect(s.candidates).toEqual([]);
    expect(s.strength).toBeNull();
  });

  it('unnamed OSM features are ignored entirely', () => {
    const s = scoreRoute(
      [
        { type: 'way', tags: { highway: 'path' } },
        { type: 'area', tags: { leisure: 'park' } },
        { type: 'way', tags: { name: '   ', highway: 'path' } },
      ],
      9,
    );
    expect(s.candidates).toEqual([]);
  });

  it('a park below 40% does not win on a technicality', () => {
    // 3 of 9 = 33%. Real, so still offered — but as a weak answer, not a confident one.
    const s = scoreRoute(hits({}, { 'Barely There Park': 3 }), 9);
    expect(s.strength).toBe('park-weak');
    expect(s.candidates[0].confidence).toBeCloseTo(0.33, 2);
  });

  it('separates what you walked ON from what you were INSIDE', () => {
    const t = tally([
      { type: 'way', tags: { name: 'A Trail', highway: 'path' } },
      { type: 'area', tags: { name: 'A Park', leisure: 'park' } },
      // A way with NO highway tag is not something you walked on.
      { type: 'way', tags: { name: 'A Park', leisure: 'park' } },
    ]);
    expect(t.trails).toEqual([{ name: 'A Trail', count: 1 }]);
    expect(t.parks).toEqual([{ name: 'A Park', count: 2 }]);
  });
});

describe('sampling and the query', () => {
  it('samples evenly and always includes both endpoints', () => {
    const pts = Array.from({ length: 100 }, (_, i) => [i, i] as [number, number]);
    const s = samplePoints(pts, 9);
    expect(s).toHaveLength(9);
    expect(s[0]).toEqual([0, 0]);
    expect(s[8]).toEqual([99, 99]);
  });

  it('a short route is used whole rather than padded', () => {
    const pts: [number, number][] = [
      [1, 1],
      [2, 2],
    ];
    expect(samplePoints(pts, 9)).toEqual(pts);
  });

  it('builds ONE query for the whole route, at fixed precision', () => {
    const q = buildOverpassQuery([
      [39.0501234567, -77.3121234567],
      [39.06, -77.32],
    ]);
    // Fixed precision keeps the query byte-identical for the same route, which is
    // what makes any of this reproducible.
    expect(q).toContain('is_in(39.050123,-77.312123)');
    expect(q).toContain('way(around:45,39.060000,-77.320000)');
    expect(q.startsWith('[out:json][timeout:60];')).toBe(true);
    expect((q.match(/is_in\(/g) ?? []).length).toBe(2);
  });
});

describe('polyline decoding', () => {
  it('decodes the canonical Google example', () => {
    // From Google's own encoded-polyline documentation.
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it('round-trips a real Strava-shaped fragment to sane coordinates', () => {
    const pts = decodePolyline('yzoiFxbqbMk@Vs@Ee@[');
    expect(pts.length).toBeGreaterThan(1);
    for (const [lat, lng] of pts) {
      expect(lat).toBeGreaterThan(-90);
      expect(lat).toBeLessThan(90);
      expect(lng).toBeGreaterThan(-180);
      expect(lng).toBeLessThan(180);
    }
  });

  it('empty or missing input yields no points instead of throwing', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline(null)).toEqual([]);
    expect(decodePolyline(undefined)).toEqual([]);
  });

  it('truncated input keeps what decoded rather than throwing away the route', () => {
    const full = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const cut = decodePolyline(full.slice(0, 12));
    expect(cut.length).toBeGreaterThanOrEqual(1);
    expect(cut[0]).toEqual([38.5, -120.2]);
  });
});
