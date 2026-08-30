import { describe, it, expect } from 'vitest';
import { localDateOf, prefill, suggestedPlaceName, todayLocalDate } from './draftPrefill';

// The point of these tests is that the blank card is HELPFUL WITHOUT BEING WRONG:
// the date is already right the overwhelming majority of the time, the name is only
// filled in when there is a real named place there, and neither can ever land on top
// of something she has already typed.

describe('the date the card opens with', () => {
  it('is the day you are adding the card, in local time', () => {
    // 22:30 on 2 May local. The UTC date is already 3 May west of Greenwich, which is
    // exactly the bug `toISOString().slice(0, 10)` produces.
    expect(todayLocalDate(new Date(2026, 4, 2, 22, 30))).toBe('2026-05-02');
    expect(todayLocalDate(new Date(2026, 0, 9, 0, 5))).toBe('2026-01-09');
  });

  it('pads month and day, because the date input only accepts YYYY-MM-DD', () => {
    expect(todayLocalDate(new Date(2026, 8, 7, 12))).toBe('2026-09-07');
  });
});

describe('the date a photo brings with it', () => {
  it('is the photo’s own day, not today', () => {
    const takenAt = new Date(2024, 6, 14, 9, 30).toISOString();
    expect(localDateOf(takenAt)).toBe('2024-07-14');
  });

  it('reads the local day of a UTC timestamp', () => {
    // Same instant, expressed in UTC: still the local day it happened on.
    const takenAt = new Date(2024, 6, 14, 23, 30).toISOString();
    expect(localDateOf(takenAt)).toBe('2024-07-14');
  });

  it('gives back nothing for a photo with no usable date', () => {
    expect(localDateOf(undefined)).toBeNull();
    expect(localDateOf(null)).toBeNull();
    expect(localDateOf('')).toBeNull();
    expect(localDateOf('not a date')).toBeNull();
  });
});

describe('what may be suggested as a place name', () => {
  it('suggests a real named venue — the restaurant you are standing in', () => {
    expect(
      suggestedPlaceName({ name: "Katz's Delicatessen", category: 'amenity/restaurant' }),
    ).toBe("Katz's Delicatessen");
    expect(suggestedPlaceName({ name: 'Kings Peak', category: 'natural/peak' })).toBe('Kings Peak');
  });

  it('never suggests the county, the road or the suburb you happen to be inside', () => {
    // The live audit's case: a pin on a Kansas highway offered "Coffey County".
    expect(
      suggestedPlaceName({ name: 'Coffey County', category: 'boundary/administrative' }),
    ).toBeNull();
    expect(
      suggestedPlaceName({ name: '12th Road Southeast', category: 'highway/residential' }),
    ).toBeNull();
    expect(suggestedPlaceName({ name: 'Shoreditch', category: 'place/suburb' })).toBeNull();
  });

  it('suggests nothing when there is nothing named there', () => {
    expect(suggestedPlaceName(null)).toBeNull();
    expect(suggestedPlaceName({ name: '', category: 'building/apartments' })).toBeNull();
    expect(suggestedPlaceName({ name: '   ', category: 'amenity/restaurant' })).toBeNull();
    expect(suggestedPlaceName({ name: 'Somewhere', category: null })).toBe('Somewhere');
  });
});

describe('a suggestion never overwrites what you typed', () => {
  it('fills a field you have not touched', () => {
    expect(prefill('', 'The Blue Door', false)).toBe('The Blue Door');
  });

  it('replaces an earlier auto-fill, because that was a suggestion too', () => {
    expect(prefill('Main Street', 'The Blue Door', false)).toBe('The Blue Door');
  });

  it('leaves what she typed exactly as she typed it', () => {
    expect(prefill('Our spot', 'The Blue Door', true)).toBe('Our spot');
    // Including deliberately clearing the field.
    expect(prefill('', 'The Blue Door', true)).toBe('');
  });

  it('does nothing at all when there is no suggestion', () => {
    expect(prefill('Our spot', null, false)).toBe('Our spot');
    expect(prefill('Our spot', undefined, false)).toBe('Our spot');
    expect(prefill('Our spot', '  ', false)).toBe('Our spot');
  });

  it('trims the suggestion it does apply', () => {
    expect(prefill('', '  The Blue Door ', false)).toBe('The Blue Door');
  });
});
