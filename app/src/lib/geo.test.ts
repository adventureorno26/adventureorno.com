import { describe, expect, it } from 'vitest';
import { haversineMeters, metersToMiles } from './geo';

describe('haversineMeters', () => {
  it('is ~0 for identical points', () => {
    expect(haversineMeters({ lng: 0, lat: 0 }, { lng: 0, lat: 0 })).toBeCloseTo(0, 5);
  });

  it('matches a known distance (0.5° of latitude ≈ 55.6 km)', () => {
    // Fictional points, no real locations: one degree of latitude ≈ 111.2 km.
    const d = haversineMeters({ lng: 0, lat: 0 }, { lng: 0, lat: 0.5 });
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
