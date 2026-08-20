import { describe, it, expect } from 'vitest';
import { comparablePlaces, dupeKey, duplicatePairs } from './duplicatePlaces';
import type { Place } from './types';

// The count on Needs attention and the rows on /duplicates come from THIS function, so the
// two screens cannot disagree about how much work there is. These are the properties that
// have to hold for that to be worth anything.

// Minimal valid Place; override per test.
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

const at = (id: string, name: string, lat: number, lng: number, extra: Partial<Place> = {}) =>
  place({ id, name, lat, lng, ...extra });

describe('duplicatePairs', () => {
  const none = new Set<string>();

  it('pairs two places almost on top of each other', () => {
    // ~78 m apart.
    const pairs = duplicatePairs(
      [at('a', 'Trailhead', 39.0, -77.0), at('b', 'Parking', 39.0007, -77.0)],
      none,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].meters).toBeLessThan(150);
    expect(pairs[0].sameName).toBe(false);
  });

  it('leaves two different places alone', () => {
    const pairs = duplicatePairs([at('a', 'One', 39.0, -77.0), at('b', 'Two', 39.5, -77.5)], none);
    expect(pairs).toEqual([]);
  });

  it('pairs a shared name up to 3 km apart, and not beyond', () => {
    const near = duplicatePairs(
      [at('a', 'Great Falls', 39.0, -77.0), at('b', 'great  falls', 39.02, -77.0)],
      none,
    );
    expect(near).toHaveLength(1);
    expect(near[0].sameName).toBe(true);
    const far = duplicatePairs(
      [at('a', 'Great Falls', 39.0, -77.0), at('b', 'Great Falls', 39.3, -77.0)],
      none,
    );
    expect(far).toEqual([]);
  });

  it('hides a pair that was kept separate, whichever way round it was saved', () => {
    const ps = [at('a', 'Trailhead', 39.0, -77.0), at('b', 'Parking', 39.0007, -77.0)];
    expect(duplicatePairs(ps, new Set([dupeKey('a', 'b')]))).toEqual([]);
    expect(duplicatePairs(ps, new Set([dupeKey('b', 'a')]))).toEqual([]);
  });

  it('gives the history to the more-visited place', () => {
    const ps = [at('a', 'Trailhead', 39.0, -77.0), at('b', 'Parking', 39.0007, -77.0)];
    const visits = (p: Place) => (p.id === 'b' ? 9 : 1);
    expect(duplicatePairs(ps, none, visits)[0].a.id).toBe('b');
    // …and which way round it is must not change HOW MANY there are, because the count is
    // taken without knowing the visit totals.
    expect(duplicatePairs(ps, none, visits)).toHaveLength(duplicatePairs(ps, none).length);
  });

  it('is ordered closest first', () => {
    const pairs = duplicatePairs(
      [
        at('a', 'One', 39.0, -77.0),
        at('b', 'Two', 39.0009, -77.0), // ~100 m
        at('c', 'Three', 39.0002, -77.0), // ~22 m
      ],
      none,
    );
    expect(pairs.map((p) => p.meters)).toEqual(
      [...pairs.map((p) => p.meters)].sort((x, y) => x - y),
    );
  });

  it('never pairs a place with itself', () => {
    const only = [at('a', 'One', 39.0, -77.0)];
    expect(duplicatePairs(only, none)).toEqual([]);
  });
});

describe('comparablePlaces', () => {
  it('leaves out trails, containers, bucket-list wishes and unsaved drafts', () => {
    const ps = [
      at('keep', 'A real place', 39.0, -77.0),
      at('trail', 'A trail', 39.0, -77.0, { is_trail: true }),
      at('box', 'A container', 39.0, -77.0, { holds_children: true }),
      at('wish', 'Someday', 39.0, -77.0, { bucket: true }),
      at('draft', 'Not saved', 39.0, -77.0, { saved: false }),
    ];
    expect(comparablePlaces(ps).map((p) => p.id)).toEqual(['keep']);
    // A trail and its trailhead sit on top of each other by definition — pairing them would
    // ask her to merge a route into a car park.
    expect(duplicatePairs(ps, new Set())).toEqual([]);
  });
});
