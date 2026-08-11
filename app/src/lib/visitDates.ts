// How a visit's dates are written. ONE implementation, because this is a locked
// decision and it is about to be needed in three places (the stats bar's trip list,
// the destination card's visit section, the visit card's own header).
//
// Erica, 2026-08-11:
//   "A single date should be formatted May 2. a Date range should be formatted
//    5/4 - 5/7. Dates should be grouped by year."
//
// A date-only string parses as UTC midnight and renders as the PREVIOUS day west of
// Greenwich (§8), so every date here is built from local components. Never pass these
// strings to `new Date(s)`.

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Split 'YYYY-MM-DD' into local parts. Anything else gives back nulls. */
function parts(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** The year a visit belongs to, for grouping. */
export function yearOf(iso: string): number | null {
  return parts(iso)?.y ?? null;
}

/**
 * One date → "May 2". A range → "5/4 - 5/7". No year: the group carries it.
 * `end` may be null, equal to `start`, or a later day.
 */
export function visitDates(start: string, end?: string | null): string {
  const s = parts(start);
  if (!s) return '';
  const e = end ? parts(end) : null;
  const sameDay = !e || (e.y === s.y && e.m === s.m && e.d === s.d);
  if (sameDay) return `${MONTHS[s.m - 1]} ${s.d}`;
  return `${s.m}/${s.d} - ${e.m}/${e.d}`;
}

/** Group anything carrying a start date by year, newest year first. */
export function byYear<T extends { start_date: string }>(rows: T[]): { year: number; rows: T[] }[] {
  const groups = new Map<number, T[]>();
  for (const r of rows) {
    const y = yearOf(r.start_date);
    if (y === null) continue;
    const list = groups.get(y);
    if (list) list.push(r);
    else groups.set(y, [r]);
  }
  return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([year, rows]) => ({ year, rows }));
}
