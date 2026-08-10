import { activityDay, type Activity, type Place, type Visit } from './types';

/**
 * Containers, sections and their dates — the one model, as data.
 *
 *   Place → Visits → The day
 *
 * A CONTAINER is a place that holds other places: a trail, a trip, a city, a
 * region. It appears ONCE and lists each SECTION once. A section opens to its
 * dates; a date opens the card. (docs/STATE.md §2.)
 *
 * This lives apart from the components because the rule kept leaking: a stats
 * rule ("containers don't count twice") once made every container invisible in
 * Places, and the trail card listed one row per outing so one section appeared
 * nine times. Both are now decided here, once, under test.
 */

/**
 * What a place actually holds — NOT the `holds_children` flag.
 *
 * The flag and the fact disagree in both directions: 14 of the 23 places
 * carrying `holds_children` hold nothing at all (an empty container renders as
 * a row that opens to nothing), and Leesburg holds North Street Northeast with
 * the flag set false. Membership is the fact; the flag is a copy of it, and
 * reading the copy is how this broke the last three times.
 */
export function sectionsOf(all: Place[], containerId: string): Place[] {
  return all
    .filter((p) => p.id !== containerId && (p.part_of ?? []).includes(containerId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface PlaceNode {
  place: Place;
  /** Listed once each, alphabetically. Empty for a leaf. */
  sections: Place[];
}

/**
 * The Places list as the model shapes it: containers at the top holding their
 * sections, leaves alongside them, nothing listed twice and nothing dropped.
 *
 * A section is nested under every container it belongs to (a place may be part
 * of more than one), and is not repeated at the top level. A `part_of` id that
 * names a place we cannot see leaves its child at the top level rather than
 * hiding it — invisible is the failure mode this file exists to prevent.
 */
export function buildPlaceTree(all: Place[]): PlaceNode[] {
  const byId = new Map(all.map((p) => [p.id, p]));
  const nested = new Set<string>();
  for (const p of all) {
    for (const parent of p.part_of ?? []) {
      if (parent !== p.id && byId.has(parent)) nested.add(p.id);
    }
  }
  return all
    .filter((p) => !nested.has(p.id))
    .map((p) => ({ place: p, sections: sectionsOf(all, p.id) }))
    .sort((a, b) => a.place.name.localeCompare(b.place.name));
}

/** One date at a place: a visit (which may span days) with whatever happened on it. */
export interface SectionDate {
  /** Stable React key — the visit id, or the activity id for an activity-only day. */
  key: string;
  /** YYYY-MM-DD. Opens `/place/:id/day/:date`. */
  date: string;
  /** YYYY-MM-DD; equal to `date` for a single-day visit. */
  end: string;
  note: string | null;
  isTrip: boolean;
  /** What we did that day. Evidence on the date, not dates of its own. */
  activities: Activity[];
}

export interface SectionRow {
  place: Place;
  /** Newest first. One entry per date, however many activities it holds. */
  dates: SectionDate[];
}

/**
 * A section's dates, counted the way the model counts them: a visit is the
 * occasion and the activities hang off it, so a day with a hike AND a run is
 * ONE date. An activity on a day no visit covers still shows — a run that was
 * never logged as a visit is not nothing.
 */
export function datesFor(placeId: string, acts: Activity[], visits: Visit[]): SectionDate[] {
  const mine = acts.filter((a) => a.place_id === placeId);
  const rows: SectionDate[] = [];
  const covered = new Set<string>();

  for (const v of visits.filter((v) => v.place_id === placeId)) {
    const end = v.end_date || v.start_date;
    for (const a of mine) {
      const d = activityDay(a);
      if (d !== '' && d >= v.start_date && d <= end) covered.add(a.id);
    }
    rows.push({
      key: v.id,
      date: v.start_date,
      end,
      note: v.note,
      isTrip: v.is_trip,
      activities: mine.filter((a) => {
        const d = activityDay(a);
        return d !== '' && d >= v.start_date && d <= end;
      }),
    });
  }

  // Days with an activity and no visit to hang it on. Grouped by day so two
  // runs on one morning are one date, not two.
  const loose = new Map<string, Activity[]>();
  for (const a of mine) {
    if (covered.has(a.id)) continue;
    const d = activityDay(a);
    if (d === '') continue;
    if (!loose.has(d)) loose.set(d, []);
    loose.get(d)!.push(a);
  }
  for (const [d, list] of loose) {
    rows.push({ key: list[0].id, date: d, end: d, note: null, isTrip: false, activities: list });
  }

  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Each section ONCE, with its dates — the shape the trail card got wrong by
 * rendering one row per outing, so "Maryland Heights" appeared nine times
 * instead of once with nine dates.
 */
export function buildSectionRows(
  sections: Place[],
  acts: Activity[],
  visits: Visit[],
): SectionRow[] {
  return sections.map((place) => ({ place, dates: datesFor(place.id, acts, visits) }));
}

/**
 * Done means done IN THE CURRENT VIEW. `places.visit_count` is global, so a
 * section only Josh has walked read as done in Erica's "Just me". Falls back to
 * the global count when the per-view counts have not loaded, rather than
 * showing an empty trail.
 */
export function sectionDone(p: Place, visitCounts?: Map<string, number> | null): boolean {
  if (visitCounts) return (visitCounts.get(p.id) ?? 0) > 0;
  return p.visit_count > 0 || Boolean(p.first_visit);
}
