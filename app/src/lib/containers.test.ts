import { describe, it, expect } from 'vitest';
import { buildPlaceTree, buildSectionRows, datesFor, sectionsOf } from './containers';
import type { Activity, Place, Visit } from './types';

// The fixtures below are the REAL shape of the Appalachian Trail as of
// 2026-08-10: a container holding seven sections, of which Maryland Heights
// carries nine outings on thirteen visits. Every failure this file guards
// against was a live bug on that card.

function place(overrides: Partial<Place>): Place {
  return {
    id: 'id',
    name: 'A Place',
    country: null,
    admin1: null,
    lat: 10,
    lng: 20,
    first_visit: null,
    last_visit: null,
    cover_photo_id: null,
    cover_pos_y: 50,
    address: null,
    city: null,
    auto: false,
    needs_geocode: false,
    name_locked: false,
    counts_as_place: true,
    named_by: null,
    name_scope: null,
    visit_count: 0,
    rating: null,
    review: null,
    is_home: false,
    saved: true,
    is_trail: false,
    part_of: [],
    suggested: false,
    bucket: false,
    website: null,
    categories: [],
    activity_categories: [],
    favorite: null,
    holds_children: false,
    category: null,
    park: null,
    created_by: null,
    created_at: '2026-01-01',
    ...overrides,
  };
}

function activity(overrides: Partial<Activity>): Activity {
  return {
    id: 'a',
    strava_id: null,
    type: 'Hike',
    name: null,
    distance: 8046.72,
    elevation_gain: null,
    elevation_profile: null,
    moving_time: null,
    elapsed_time: null,
    start_date: '2026-03-07T13:00:00Z',
    local_date: '2026-03-07',
    lat: 10,
    lng: 20,
    summary_polyline: null,
    place_id: null,
    trailhead: null,
    ...overrides,
  };
}

function visit(overrides: Partial<Visit>): Visit {
  return {
    id: 'v',
    place_id: 'p',
    start_date: '2026-03-07',
    end_date: '2026-03-07',
    note: null,
    is_trip: false,
    status: 'taken',
    solo_override: false,
    created_at: '2026-03-07',
    ...overrides,
  };
}

const AT = place({ id: 'at', name: 'Appalachian Trail', is_trail: true, holds_children: true });
const MARYLAND = place({ id: 'md', name: 'Maryland Heights', part_of: ['at'], visit_count: 13 });
const BEARS_DEN = place({ id: 'bd', name: 'Bear’s Den', part_of: ['at'], visit_count: 6 });
const REHOBOTH = place({ id: 'rb', name: 'Rehoboth Beach', holds_children: true }); // flag, no children

describe('what a place holds', () => {
  it('reads membership, not the holds_children flag', () => {
    const all = [AT, MARYLAND, BEARS_DEN, REHOBOTH];
    expect(sectionsOf(all, 'at').map((p) => p.name)).toEqual(['Bear’s Den', 'Maryland Heights']);
    // Rehoboth Beach carries holds_children and holds nothing. A container that
    // opens to nothing is a lie about the data.
    expect(sectionsOf(all, 'rb')).toEqual([]);
    // Leesburg is the mirror image: it holds a place with the flag set false.
    const leesburg = place({ id: 'lb', name: 'Leesburg', holds_children: false });
    const north = place({ id: 'ns', name: 'North Street Northeast', part_of: ['lb'] });
    expect(sectionsOf([leesburg, north], 'lb').map((p) => p.name)).toEqual([
      'North Street Northeast',
    ]);
  });
});

describe('the Places list', () => {
  const all = [AT, MARYLAND, BEARS_DEN, REHOBOTH];
  const tree = buildPlaceTree(all);

  it('lists the container, and lists it ONCE', () => {
    // The bug: a stats rule ("containers don't count twice") filtered every
    // container out of Places, so the trail vanished and its sections remained.
    expect(tree.map((n) => n.place.name)).toEqual(['Appalachian Trail', 'Rehoboth Beach']);
    expect(tree.filter((n) => n.place.id === 'at')).toHaveLength(1);
  });

  it('nests each section under its container, once, and not at the top level', () => {
    const at = tree.find((n) => n.place.id === 'at')!;
    expect(at.sections.map((p) => p.name)).toEqual(['Bear’s Den', 'Maryland Heights']);
    expect(tree.some((n) => n.place.id === 'md')).toBe(false);
  });

  it('loses nothing: every place is somewhere in the tree', () => {
    const shown = new Set(tree.flatMap((n) => [n.place.id, ...n.sections.map((s) => s.id)]));
    expect(shown).toEqual(new Set(all.map((p) => p.id)));
  });

  it('keeps a place whose parent we cannot see at the top level', () => {
    // Invisible is the failure mode this file exists to prevent — an orphaned
    // part_of id must not swallow the place.
    const orphan = place({ id: 'o', name: 'Orphan', part_of: ['gone'] });
    expect(buildPlaceTree([orphan]).map((n) => n.place.id)).toEqual(['o']);
  });
});

describe('a section opens to its dates', () => {
  const acts = [
    activity({ id: 'a1', place_id: 'md', local_date: '2026-03-07', name: 'Maryland Heights' }),
    activity({ id: 'a2', place_id: 'md', local_date: '2025-11-02', name: 'Maryland Heights' }),
    activity({ id: 'a3', place_id: 'md', local_date: '2025-11-02', name: 'Maryland Heights' }),
    activity({ id: 'a4', place_id: 'bd', local_date: '2026-01-04', name: 'Bear’s Den' }),
    activity({ id: 'a5', place_id: 'at', local_date: '2026-02-01', name: 'On the trail itself' }),
  ];
  const visits = [
    visit({ id: 'v1', place_id: 'md', start_date: '2026-03-07', end_date: '2026-03-07' }),
    visit({ id: 'v2', place_id: 'md', start_date: '2024-06-01', end_date: '2024-06-03' }),
    visit({ id: 'v3', place_id: 'bd', start_date: '2026-01-04', end_date: '2026-01-04' }),
  ];

  it('lists the section ONCE, with its dates — not one row per outing', () => {
    const rows = buildSectionRows([BEARS_DEN, MARYLAND], acts, visits);
    expect(rows.map((r) => r.place.name)).toEqual(['Bear’s Den', 'Maryland Heights']);
    const md = rows.find((r) => r.place.id === 'md')!;
    // Three outings and two visits, on three distinct dates.
    expect(md.dates.map((d) => d.date)).toEqual(['2026-03-07', '2025-11-02', '2024-06-01']);
  });

  it('counts a day with a visit AND an outing as one date, with the outing on it', () => {
    const md = datesFor('md', acts, visits);
    const day = md.find((d) => d.date === '2026-03-07')!;
    expect(day.key).toBe('v1'); // the visit is the occasion
    expect(day.activities.map((a) => a.id)).toEqual(['a1']); // the hike hangs off it
  });

  it('still shows an outing on a day no visit covers', () => {
    const day = datesFor('md', acts, visits).find((d) => d.date === '2025-11-02')!;
    expect(day.activities.map((a) => a.id)).toEqual(['a2', 'a3']); // two runs, one date
  });

  it('keeps a multi-day visit as one date, and holds its span', () => {
    const stay = datesFor('md', acts, visits).find((d) => d.date === '2024-06-01')!;
    expect(stay.end).toBe('2024-06-03');
  });

  it("never puts the container's own outings on a section", () => {
    // fetchActivitiesForPlaceTree returns the whole tree; a5 belongs to the
    // trail itself and must not appear under Maryland Heights.
    const ids = datesFor('md', acts, visits).flatMap((d) => d.activities.map((a) => a.id));
    expect(ids).not.toContain('a5');
  });

  it('gives a not-yet-walked section no dates rather than hiding it', () => {
    const todo = place({ id: 'wm', name: 'Washington Monument', part_of: ['at'] });
    const rows = buildSectionRows([todo], acts, visits);
    expect(rows).toHaveLength(1);
    expect(rows[0].dates).toEqual([]);
  });
});
