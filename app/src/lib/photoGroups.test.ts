// Rome is one trip.
//
// Erica, 2026-08-14: "I just added some photos from Rome and because photos were in
// different months they were separated into 2 visits, even though the dates were
// consecutive (March 27-April 2)."
import { describe, expect, it } from 'vitest';
import { assignStayGroups, MAX_BLANK_DAYS } from './photoGroups';

const photo = (placeId: string | null, takenAt: string | null) => ({ placeId, takenAt });
const keys = (rows: { groupId: string }[]) => new Set(rows.map((r) => r.groupId));

describe('photos group into the stay they belong to', () => {
  it('keeps Rome together across the month boundary', () => {
    const rome = [
      photo('rome', '2026-03-27T10:00:00Z'),
      photo('rome', '2026-03-28T10:00:00Z'),
      photo('rome', '2026-03-31T10:00:00Z'),
      photo('rome', '2026-04-01T10:00:00Z'),
      photo('rome', '2026-04-02T10:00:00Z'),
    ];
    expect(keys(assignStayGroups(rome)).size, '27 March to 2 April is ONE trip').toBe(1);
  });

  it('still separates two genuinely different trips to the same place', () => {
    const twice = [
      photo('rome', '2026-03-27T10:00:00Z'),
      photo('rome', '2026-03-28T10:00:00Z'),
      photo('rome', '2026-09-14T10:00:00Z'),
      photo('rome', '2026-09-15T10:00:00Z'),
    ];
    expect(keys(assignStayGroups(twice)).size).toBe(2);
  });

  it('does not split a stay because you took no photographs one day', () => {
    // A blank Tuesday is not the end of the holiday.
    const withGap = [
      photo('rome', '2026-03-27T10:00:00Z'),
      photo('rome', '2026-03-30T10:00:00Z'), // two blank days between
    ];
    expect(keys(assignStayGroups(withGap)).size).toBe(1);
  });

  it('does split when the gap is wider than the tolerance', () => {
    const wide = [
      photo('rome', '2026-03-01T10:00:00Z'),
      photo('rome', `2026-03-0${1 + MAX_BLANK_DAYS + 2}T10:00:00Z`),
    ];
    expect(keys(assignStayGroups(wide)).size).toBe(2);
  });

  it('never merges two places, however close the dates', () => {
    const both = [photo('rome', '2026-03-27T10:00:00Z'), photo('florence', '2026-03-28T10:00:00Z')];
    expect(keys(assignStayGroups(both)).size).toBe(2);
  });

  it('keeps undated photos together per place, for a person to sort', () => {
    const rows = assignStayGroups([
      photo('rome', null),
      photo('rome', null),
      photo('rome', '2026-03-27T10:00:00Z'),
    ]);
    expect(rows.filter((r) => r.groupId.endsWith('::nodate'))).toHaveLength(2);
    expect(keys(rows).size).toBe(2);
  });

  it('leaves the items in the order they arrived, however they are sorted internally', () => {
    // Out of order on purpose, and adjacent so they are genuinely one stay — 27 March
    // and 2 April with NOTHING between them is six blank days, which is two stays.
    const rows = assignStayGroups([
      photo('rome', '2026-03-28T10:00:00Z'),
      photo('rome', '2026-03-27T10:00:00Z'),
    ]);
    expect(rows[0].takenAt).toBe('2026-03-28T10:00:00Z');
    expect(rows[0].groupId).toBe(rows[1].groupId);
  });

  it('groups unplaced photos by their own stays, not into one heap', () => {
    const rows = assignStayGroups([
      photo(null, '2026-03-27T10:00:00Z'),
      photo(null, '2026-03-28T10:00:00Z'),
      photo(null, '2026-11-01T10:00:00Z'),
    ]);
    expect(keys(rows).size).toBe(2);
  });
});
