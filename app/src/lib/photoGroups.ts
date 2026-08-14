// Grouping photos into the visit they belong to.
//
// THE BUG THIS FIXES, in Erica's words (2026-08-14):
//
//   "I just added some photos from Rome and because photos were in different months
//    they were separated into 2 visits, even though the dates were consecutive
//    (March 27-April 2)."
//
// The photo sorter keyed each group on `place + YYYY-MM` — `iso.slice(0, 7)` — and said
// so out loud in the UI: "same place on a different month = a separate trip". A calendar
// month is not a fact about a trip. Rome, 27 March to 2 April, is one stay that happens
// to cross a boundary in the calendar, and it came out as two visits.
//
// The database never had this problem. `rebuild_place_visits` groups days with the
// classic gaps-and-islands trick — `d - row_number() over (order by d)` is constant for
// a run of consecutive days — which does not care what a month is. So the client and the
// database disagreed about what a visit was, and the client was wrong.
//
// This is the same rule, in TypeScript, with one deliberate difference: a small gap does
// NOT split a stay. A day you took no photographs is still a day of the trip.

/** A run of days at one place is one stay until this many blank days pass.
 *
 *  Strictly-consecutive (0) would split Rome the moment you spent a day without taking
 *  a photograph, which is the same complaint in a different costume. Two blank days is
 *  the point where "still on the trip" stops being the obvious reading. */
export const MAX_BLANK_DAYS = 2;

const dayOf = (iso?: string | null): string | null => (iso ? iso.slice(0, 10) : null);

const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Give every photo the key of the STAY it belongs to: the same place, on days that run
 * together. Items keep their original order; only the key changes.
 *
 * Undated photos share one key per place — there is nothing to group them by, and
 * scattering them would be worse than keeping them together for a person to sort.
 */
export function assignStayGroups<T extends { placeId: string | null; takenAt?: string | null }>(
  items: T[],
): (T & { groupId: string })[] {
  const keyByIndex = new Map<number, string>();
  const byPlace = new Map<string, { index: number; day: string | null }[]>();

  items.forEach((it, index) => {
    const place = it.placeId ?? 'none';
    if (!byPlace.has(place)) byPlace.set(place, []);
    byPlace.get(place)!.push({ index, day: dayOf(it.takenAt) });
  });

  for (const [place, rows] of byPlace) {
    const dated = rows.filter((r) => r.day !== null).sort((a, b) => a.day!.localeCompare(b.day!));
    let islandStart: string | null = null;
    let previous: string | null = null;

    for (const row of dated) {
      const day = row.day!;
      // A new stay begins when the gap since the last photographed day is wider than
      // a couple of blank days. Crossing a month boundary is not a gap.
      if (
        islandStart === null ||
        previous === null ||
        daysBetween(previous, day) > MAX_BLANK_DAYS + 1
      ) {
        islandStart = day;
      }
      previous = day;
      keyByIndex.set(row.index, `${place}::${islandStart}`);
    }

    for (const row of rows) {
      if (row.day === null) keyByIndex.set(row.index, `${place}::nodate`);
    }
  }

  return items.map((it, index) => ({
    ...it,
    groupId: keyByIndex.get(index) ?? `${it.placeId ?? 'none'}::nodate`,
  }));
}
