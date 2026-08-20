// What counts as "these might be the same place", in ONE place.
//
// WHY THIS FILE EXISTS. §3e, the last of the small ones. Duplicate-place repair lived only
// at /duplicates, reachable from Settings — so the repair queue never mentioned it, and the
// only way to find out whether anything needed merging was to go and look. Needs attention
// now counts it like everything else.
//
// The moment two screens both answer "how many duplicates are there?", the rule has to stop
// being written twice. This is the recurring defect in this codebase — one fact with two
// mechanisms — and a count on a dashboard that disagrees with the list it links to is the
// most annoying version of it: you press "Merge or keep", the screen says there is nothing
// to do, and you have no way to tell which screen lied.
import { haversineMeters } from './geo';
import type { Place } from './types';

/** Order-independent key matching how dismissals are stored (least|greatest), so a pair
 *  dismissed either way round still hides. Lived in data.ts; it belongs beside the rule
 *  that uses it, and data.ts re-exports it so every existing caller is unchanged. */
export const dupeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export interface DuplicatePair {
  a: Place; // winner (keeps the history) — the more-visited of the two
  b: Place; // loser (merged in)
  meters: number;
  sameName: boolean;
}

/** The places the rule applies to at all: saved, not a bucket-list wish, not a container,
 *  not a trail. A trail and its trailhead sit on top of each other by definition. */
export function comparablePlaces(places: Place[]): Place[] {
  return places.filter((p) => p.saved && !p.bucket && !p.holds_children && !p.is_trail);
}

/** Pairs that might be the same place: within ~150 m of each other, or sharing a name and
 *  within 3 km. Sorted closest-first, which is roughly most-likely-first.
 *
 *  `visitsOf` decides which one WINS a merge, and the winner keeps the history — so it must
 *  be counted fresh rather than read from `places.visit_count`, which is a mirror nobody
 *  refreshes when a visit changes (0190). Callers that only need the COUNT can pass
 *  anything; nothing about how many pairs exist depends on which way round they are. */
export function duplicatePairs(
  places: Place[],
  dismissed: Set<string>,
  visitsOf: (p: Place) => number = () => 0,
): DuplicatePair[] {
  const ps = comparablePlaces(places);
  const out: DuplicatePair[] = [];
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const p = ps[i];
      const q = ps[j];
      if (dismissed.has(dupeKey(p.id, q.id))) continue; // kept separate — hide it
      const m = haversineMeters({ lat: p.lat, lng: p.lng }, { lat: q.lat, lng: q.lng });
      const sameName = !!p.name && norm(p.name) === norm(q.name);
      if (m <= 150 || (sameName && m <= 3000)) {
        const [a, b] = visitsOf(p) >= visitsOf(q) ? [p, q] : [q, p];
        out.push({ a, b, meters: Math.round(m), sameName });
      }
    }
  }
  return out.sort((x, y) => x.meters - y.meters);
}
