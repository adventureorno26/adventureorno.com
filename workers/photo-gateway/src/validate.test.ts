import { describe, expect, it } from 'vitest';
import { coordOk, looksLikeJpeg, sanitizeTakenAt } from './validate';

describe('coordOk', () => {
  it('accepts absent coordinates', () => {
    expect(coordOk(null, -90, 90)).toBe(true);
  });
  it('accepts in-range values', () => {
    expect(coordOk(38.9, -90, 90)).toBe(true);
    expect(coordOk(-179.9, -180, 180)).toBe(true);
  });
  it('rejects NaN and out-of-range', () => {
    expect(coordOk(NaN, -90, 90)).toBe(false);
    expect(coordOk(Infinity, -90, 90)).toBe(false);
    expect(coordOk(91, -90, 90)).toBe(false);
    expect(coordOk(-181, -180, 180)).toBe(false);
  });
});

describe('looksLikeJpeg', () => {
  it('accepts JPEG magic bytes', () => {
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
  });
  it('rejects PNG and arbitrary bytes', () => {
    expect(looksLikeJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false); // PNG
    expect(looksLikeJpeg(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false); // too short
  });
});

describe('sanitizeTakenAt', () => {
  it('keeps a valid ISO date', () => {
    expect(sanitizeTakenAt('2026-05-01T12:00:00Z')).toBe('2026-05-01T12:00:00Z');
  });
  it('drops null and garbage', () => {
    expect(sanitizeTakenAt(null)).toBeNull();
    expect(sanitizeTakenAt('not-a-date')).toBeNull();
    expect(sanitizeTakenAt('0001-01-01')).toBeNull(); // absurd year
  });
});
