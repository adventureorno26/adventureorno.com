import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME_ZONE, haversineMeters, isInHomeZone, metersToMiles } from './geo';

describe('haversineMeters', () => {
  it('is ~0 for identical points', () => {
    expect(
      haversineMeters({ lng: -77.5636, lat: 39.1157 }, { lng: -77.5636, lat: 39.1157 }),
    ).toBeCloseTo(0, 5);
  });

  it('matches a known distance (Leesburg → Washington DC ~ 55 km)', () => {
    const leesburg = { lng: -77.5636, lat: 39.1157 };
    const dc = { lng: -77.0369, lat: 38.9072 };
    const d = haversineMeters(leesburg, dc);
    expect(d).toBeGreaterThan(48_000);
    expect(d).toBeLessThan(58_000);
  });
});

describe('isInHomeZone', () => {
  it('rejects the home center itself', () => {
    expect(isInHomeZone({ lng: DEFAULT_HOME_ZONE.lng, lat: DEFAULT_HOME_ZONE.lat })).toBe(true);
  });

  it('rejects a point just inside 15 miles', () => {
    // ~14 miles north of center
    expect(isInHomeZone({ lng: -77.5636, lat: 39.1157 + 0.2 })).toBe(true);
  });

  it('allows a point well outside the zone (Lisbon)', () => {
    expect(isInHomeZone({ lng: -9.1393, lat: 38.7223 })).toBe(false);
  });

  it('treats the radius edge as inside (<=)', () => {
    // A point almost exactly at the boundary distance stays excluded.
    const edge = { lng: -77.5636, lat: 39.1157 + 24140 / 111_320 };
    expect(isInHomeZone(edge)).toBe(true);
  });
});

describe('metersToMiles', () => {
  it('converts and rounds to 1 decimal', () => {
    expect(metersToMiles(1609.344)).toBe(1);
    expect(metersToMiles(0)).toBe(0);
    expect(metersToMiles(5000)).toBe(3.1);
  });
});
