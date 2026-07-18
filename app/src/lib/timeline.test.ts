import { describe, expect, it } from 'vitest';
import { parseTimeline } from './timeline';

describe('parseTimeline', () => {
  it('parses classic Records.json (latitudeE7/longitudeE7)', () => {
    const pts = parseTimeline({
      locations: [
        { latitudeE7: 355951000, longitudeE7: -825515000, timestamp: '2025-06-01T12:00:00Z' },
        { latitudeE7: 455152000, longitudeE7: -1226784000, timestampMs: '1717243200000' },
      ],
    });
    expect(pts).toHaveLength(2);
    expect(pts[0].lat).toBeCloseTo(35.5951, 3);
    expect(pts[0].lng).toBeCloseTo(-82.5515, 3);
    expect(pts[0].time).toBe('2025-06-01T12:00:00Z');
  });

  it('parses on-device semanticSegments timelinePath', () => {
    const pts = parseTimeline({
      semanticSegments: [
        {
          startTime: '2025-07-01T09:00:00Z',
          timelinePath: [
            { point: '30.267200°, -97.743100°', time: '2025-07-01T09:05:00Z' },
            { point: 'geo:30.27,-97.74' },
          ],
        },
      ],
    });
    expect(pts).toHaveLength(2);
    expect(pts[0].lat).toBeCloseTo(30.2672, 3);
    expect(pts[0].lng).toBeCloseTo(-97.7431, 3);
    expect(pts[1].time).toBe('2025-07-01T09:00:00Z'); // falls back to segment start
  });

  it('parses a semanticSegments visit anchor', () => {
    const pts = parseTimeline({
      semanticSegments: [
        {
          startTime: '2025-08-01T00:00:00Z',
          visit: { topCandidate: { placeLocation: { latLng: '48.8566°, 2.3522°' } } },
        },
      ],
    });
    expect(pts).toHaveLength(1);
    expect(pts[0].lat).toBeCloseTo(48.8566, 3);
    expect(pts[0].lng).toBeCloseTo(2.3522, 3);
  });

  it('drops out-of-range / malformed coordinates', () => {
    const pts = parseTimeline({
      locations: [
        { latitudeE7: 999000000000, longitudeE7: 1 }, // lat way out of range
        { latitudeE7: 'nope', longitudeE7: 2 },
      ],
    });
    expect(pts).toHaveLength(0);
  });

  it('returns [] for unrelated JSON', () => {
    expect(parseTimeline({ hello: 'world' })).toEqual([]);
  });
});
