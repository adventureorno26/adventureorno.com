import { describe, expect, it } from 'vitest';
import { ingestDecision, type DecideInput } from './decide';
import { screenshotGate, type ExifInfo } from './exif';

const base: DecideInput = {
  isDeleted: false,
  isDuplicate: false,
  gate: null,
  hasCoords: true,
  inZone: false,
  manual: false,
  override: false,
};

describe('ingestDecision', () => {
  it('stores a clean geotagged photo', () => {
    expect(ingestDecision(base)).toBeNull();
  });

  it('blocks a deleted photo on the automated path but lets a manual override re-add it', () => {
    expect(ingestDecision({ ...base, isDeleted: true })).toBe('deleted');
    expect(
      ingestDecision({ ...base, isDeleted: true, manual: true, override: true }),
    ).toBeNull();
  });

  it('dedupes an already-stored photo', () => {
    expect(ingestDecision({ ...base, isDuplicate: true })).toBe('duplicate');
  });

  it('skips a home-zone photo on the automated path', () => {
    expect(ingestDecision({ ...base, inZone: true })).toBe('home_zone');
  });

  it('lets a manual override store a home-zone photo', () => {
    expect(ingestDecision({ ...base, inZone: true, manual: true, override: true })).toBeNull();
  });

  it('skips a screenshot on ingest but allows a deliberate manual override', () => {
    expect(ingestDecision({ ...base, gate: 'screenshot' })).toBe('screenshot');
    expect(
      ingestDecision({ ...base, gate: 'screenshot', manual: true, override: true }),
    ).toBeNull();
  });

  it('rejects a no-coordinates photo on the automated path', () => {
    expect(ingestDecision({ ...base, hasCoords: false, gate: 'no_gps', manual: false })).toBe(
      'no_gps',
    );
  });

  it('stores a no-coordinates photo on the manual path (unassigned → inbox)', () => {
    expect(
      ingestDecision({ ...base, hasCoords: false, gate: null, manual: true, override: true }),
    ).toBeNull();
  });
});

describe('screenshotGate', () => {
  const cam: ExifInfo = {
    lat: 1,
    lng: 2,
    takenAt: null,
    make: 'Apple',
    model: 'iPhone 15 Pro',
    isPng: false,
  };
  it('passes a real camera photo', () => {
    expect(screenshotGate(cam, true)).toBeNull();
  });
  it('rejects a PNG (screenshot backstop)', () => {
    expect(screenshotGate({ ...cam, isPng: true }, true)).toBe('screenshot');
  });
  it('rejects an image with no camera make/model', () => {
    expect(screenshotGate({ ...cam, make: null, model: null }, true)).toBe('screenshot');
  });
  it('flags missing coordinates', () => {
    expect(screenshotGate(cam, false)).toBe('no_gps');
  });
});
