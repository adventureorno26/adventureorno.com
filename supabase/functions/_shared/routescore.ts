// Name a route by WHERE IT ACTUALLY WENT.
//
// The bug this replaces: MapTiler returns the nearest POINT, so a hike in Seneca
// Regional Park came back "Camp Fraser" (an adjacent Scout camp), and a hike that
// starts in a trailhead car park came back "SR630". Looking at one point can only
// ever describe one point.
//
// This looks at the whole route: sample it, ask OpenStreetMap what is underfoot and
// what contains it, and count. A trail that carries most of the route is what you
// would call it; otherwise the park that contains most of it.
//
// Ported from scripts/naming/route_namer.py, whose measured output on 13 real routes
// is recorded in scripts/naming/route-scoring-results-2026-08-09.txt and asserted in
// routescore.test.ts. Two deliberate departures from the prototype are marked BELOW.
//
// Pure TypeScript, no Deno APIs — see the note in polyline.ts.

import type { LatLng } from './polyline.ts';

export interface OverpassElement {
  type: string;
  tags?: Record<string, string>;
}

export interface Tally {
  name: string;
  count: number;
}

export type CandidateKind = 'trail' | 'park';

export interface Candidate {
  name: string;
  kind: CandidateKind;
  count: number;
  rank: number;
  confidence: number;
}

/** How strongly the winner is held — 'weak' means nothing cleared its threshold. */
export type Strength = 'trail' | 'park' | 'trail-weak' | 'park-weak' | null;

export interface RouteScore {
  samples: number;
  trails: Tally[];
  parks: Tally[];
  candidates: Candidate[];
  strength: Strength;
}

/** Evenly-spaced samples along the route, endpoints included. */
export function samplePoints(pts: LatLng[], n = 9): LatLng[] {
  if (n <= 0) return [];
  if (pts.length <= n) return pts.slice();
  const step = (pts.length - 1) / (n - 1);
  const out: LatLng[] = [];
  for (let i = 0; i < n; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

const AREA_FILTER =
  '(area.a["leisure"~"^(park|nature_reserve|recreation_ground)$"]["name"];' +
  'area.a["boundary"~"^(protected_area|national_park)$"]["name"];' +
  'area.a["landuse"="forest"]["name"];);';

const TRAIL_FILTER = '["highway"~"^(path|footway|track|cycleway|bridleway|steps)$"]["name"]';

/**
 * ONE Overpass call for the whole route: per sample, the named areas containing it
 * and the named trail-like ways within 45 m of it.
 *
 * Coordinates are fixed to 6 decimals so the same route always produces a
 * byte-identical query — which is what makes this testable at all.
 */
export function buildOverpassQuery(samples: LatLng[]): string {
  const parts = ['[out:json][timeout:60];'];
  for (const [la, ln] of samples) {
    const lat = la.toFixed(6);
    const lng = ln.toFixed(6);
    parts.push(`is_in(${lat},${lng})->.a;`);
    parts.push(AREA_FILTER);
    parts.push('out tags;');
    parts.push(`way(around:45,${lat},${lng})${TRAIL_FILTER};`);
    parts.push('out tags 6;');
  }
  return parts.join('\n');
}

/**
 * DEPARTURE 1 FROM THE PROTOTYPE — explicit, total tie-breaking.
 *
 * Python's Counter.most_common breaks ties by insertion order, i.e. by whatever
 * order Overpass happened to return elements in. That is not a decision, it is an
 * accident, and it decided a real case: the Loudoun route tallies "W&OD Bridle
 * Trail" 9 and "Washington & Old Dominion Trail" 9, and the prototype picked the
 * bridle path purely because OSM listed it first.
 *
 * Here ties break by count, then by longer (more specific) name, then
 * alphabetically — total and reproducible. The prototype already used the
 * longer-name rule for parks; this applies the same rule to trails.
 */
function byStrength(a: Tally, b: Tally): number {
  if (b.count !== a.count) return b.count - a.count;
  if (b.name.length !== a.name.length) return b.name.length - a.name.length;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Count named trails underfoot and named areas containing the samples. */
export function tally(elements: OverpassElement[]): { trails: Tally[]; parks: Tally[] } {
  const trails = new Map<string, number>();
  const parks = new Map<string, number>();

  for (const el of elements ?? []) {
    const tags = el.tags ?? {};
    const name = (tags.name ?? '').trim();
    if (!name) continue;
    // A way carrying a highway tag is something you walked ON; anything else that
    // came back from is_in() is an area you were INSIDE.
    const target = el.type === 'way' && tags.highway ? trails : parks;
    target.set(name, (target.get(name) ?? 0) + 1);
  }

  const toSorted = (m: Map<string, number>): Tally[] =>
    [...m.entries()].map(([name, count]) => ({ name, count })).sort(byStrength);

  return { trails: toSorted(trails), parks: toSorted(parks) };
}

const MAX_CANDIDATES = 5;

/**
 * Score one route into RANKED candidates.
 *
 * DEPARTURE 2 FROM THE PROTOTYPE — this returns a ranked list, not a single winner.
 * "Appalachian Trail 9/9, inside Sky Meadows State Park 8/9" is one hike with two
 * correct names (design §5.3). The prototype had to choose; the Inbox does not, and
 * choosing silently is the thing this whole rebuild exists to stop. Rank 0 is only
 * what gets pre-selected.
 *
 * Thresholds are the prototype's, verbatim: a trail carrying >= 50% of samples wins;
 * else a park containing >= 40% wins; a minimum of 2 either way so a single stray
 * hit can never name a route.
 */
export function scoreRoute(elements: OverpassElement[], sampleCount: number): RouteScore {
  const { trails, parks } = tally(elements);
  const n = Math.max(1, sampleCount);
  const trailMin = Math.max(2, Math.ceil(0.5 * n));
  const parkMin = Math.max(2, Math.ceil(0.4 * n));

  const topTrail = trails[0];
  const topPark = parks[0];

  let strength: Strength = null;
  let winner: Tally | undefined;
  let winnerKind: CandidateKind = 'trail';

  if (topTrail && topTrail.count >= trailMin) {
    strength = 'trail';
    winner = topTrail;
    winnerKind = 'trail';
  } else if (topPark && topPark.count >= parkMin) {
    strength = 'park';
    winner = topPark;
    winnerKind = 'park';
  } else if (topPark && topPark.count >= 2) {
    // Below threshold but real. Offered, with honest confidence, never written.
    // The >= 2 matters: a single stray hit is noise, and offering it as the headline
    // name is how "Camp Fraser" happened in the first place.
    strength = 'park-weak';
    winner = topPark;
    winnerKind = 'park';
  } else if (topTrail && topTrail.count >= 2) {
    strength = 'trail-weak';
    winner = topTrail;
    winnerKind = 'trail';
  }

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const push = (t: Tally, kind: CandidateKind) => {
    const key = `${kind}:${t.name}`;
    if (seen.has(key) || candidates.length >= MAX_CANDIDATES) return;
    seen.add(key);
    candidates.push({
      name: t.name,
      kind,
      count: t.count,
      rank: candidates.length,
      confidence: Math.round(Math.min(1, t.count / n) * 100) / 100,
    });
  };

  if (winner) {
    push(winner, winnerKind);
    // Rank 1 is the OTHER kind's best, so the trail and the park it runs through are
    // always both on the card (§5.3) rather than one hiding behind the other.
    const other = winnerKind === 'trail' ? topPark : topTrail;
    if (other) push(other, winnerKind === 'trail' ? 'park' : 'trail');
    for (const t of trails) push(t, 'trail');
    for (const p of parks) push(p, 'park');
  }

  return { samples: sampleCount, trails, parks, candidates, strength };
}
