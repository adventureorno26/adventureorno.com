import { describe, it, expect } from 'vitest';
import { ageLabel, isStale, STALE_AFTER_SECONDS } from './lastSeen';

// The point of these tests is the HONESTY of the label. A stale position shown
// as if it were current is the one way this feature can lie, and Josh's phone
// only produces a ping while the app is open — so stale is the normal case,
// not the edge case.

describe('how old a position reads', () => {
  it('says "just now" only for the first minute or so', () => {
    expect(ageLabel(5)).toBe('just now');
    expect(ageLabel(89)).toBe('just now');
    expect(ageLabel(120)).toBe('2 min ago');
  });

  it('counts minutes, then hours, then days', () => {
    expect(ageLabel(15 * 60)).toBe('15 min ago');
    expect(ageLabel(60 * 60)).toBe('1 hour ago');
    expect(ageLabel(5 * 3600)).toBe('5 hours ago');
    expect(ageLabel(30 * 3600)).toBe('yesterday');
    expect(ageLabel(3 * 86400)).toBe('3 days ago');
    expect(ageLabel(60 * 86400)).toBe('2 months ago');
  });

  it('never implies minute precision on an hours-old reading', () => {
    // "677 minutes ago" would be true and useless; the point is that the number
    // shown must not suggest more confidence than the data has.
    expect(ageLabel(11 * 3600 + 17 * 60)).toBe('11 hours ago');
  });

  it('goes stale after a day, which is when it stops being a location', () => {
    expect(isStale({ age_seconds: STALE_AFTER_SECONDS - 1 })).toBe(false);
    expect(isStale({ age_seconds: STALE_AFTER_SECONDS })).toBe(true);
    // Josh's real reading on the day this shipped: 30.7 hours old.
    expect(isStale({ age_seconds: Math.round(30.7 * 3600) })).toBe(true);
  });
});
