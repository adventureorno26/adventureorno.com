import { describe, expect, it } from 'vitest';
import { byYear, visitDates, yearOf } from './visitDates';

describe('visitDates — the locked format', () => {
  it('writes a single date as "May 2"', () => {
    expect(visitDates('2026-05-02')).toBe('May 2');
    expect(visitDates('2026-05-02', null)).toBe('May 2');
    expect(visitDates('2026-05-02', '2026-05-02')).toBe('May 2');
  });

  it('writes a range as "5/4 - 5/7"', () => {
    expect(visitDates('2026-05-04', '2026-05-07')).toBe('5/4 - 5/7');
  });

  it('writes a range that crosses a month, and one that crosses a year', () => {
    expect(visitDates('2026-05-30', '2026-06-02')).toBe('5/30 - 6/2');
    expect(visitDates('2025-12-30', '2026-01-02')).toBe('12/30 - 1/2');
  });

  it('does not shift a day west of Greenwich', () => {
    // A date-only string through `new Date()` lands on UTC midnight and renders as
    // the day before in every US timezone. January 1 must stay January 1.
    expect(visitDates('2026-01-01')).toBe('January 1');
    expect(yearOf('2026-01-01')).toBe(2026);
  });

  it('gives nothing back for a value that is not a date', () => {
    expect(visitDates('')).toBe('');
    expect(visitDates('sometime in May')).toBe('');
    expect(yearOf('nope')).toBeNull();
  });

  it('groups by year, newest first, keeping order inside a year', () => {
    const rows = [
      { start_date: '2026-05-04', name: 'b' },
      { start_date: '2024-01-09', name: 'c' },
      { start_date: '2026-08-01', name: 'a' },
    ];
    expect(byYear(rows)).toEqual([
      {
        year: 2026,
        rows: [
          { start_date: '2026-05-04', name: 'b' },
          { start_date: '2026-08-01', name: 'a' },
        ],
      },
      { year: 2024, rows: [{ start_date: '2024-01-09', name: 'c' }] },
    ]);
  });

  it('drops rows with no usable date rather than inventing a year', () => {
    expect(byYear([{ start_date: '' }, { start_date: '2026-02-02' }])).toEqual([
      { year: 2026, rows: [{ start_date: '2026-02-02' }] },
    ]);
  });
});
