import { describe, expect, it } from 'vitest';
import { haversineMeters, metersToMiles } from './geo';

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

describe('metersToMiles', () => {
  it('converts and rounds to 1 decimal', () => {
    expect(metersToMiles(1609.344)).toBe(1);
    expect(metersToMiles(0)).toBe(0);
    expect(metersToMiles(5000)).toBe(3.1);
  });
});
