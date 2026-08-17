// Can we actually read a Garmin .fit file?
//
// WHY THIS EXISTS. On 2026-08-17 Erica uploaded her Garmin records and the app said
// "Done — 0 activities imported." The ingest ledger agreed: two runs, ZERO items, finished
// in 120ms — `ingest_activity` was never reached, so nothing in the database was at fault.
// The FIT parser had shipped to production without ever having been run against a FIT file,
// because there was no fixture and no test. Every other part of the import path had one.
//
// So this builds a REAL FIT file with Garmin's own encoder — file_id, session and record
// messages, positions in semicircles exactly as a watch writes them — and pushes it through
// the real `parseFitActivity`. No mocking of the SDK: mocking the decoder would test the
// mock, and the decoder is the part that broke.
import { describe, expect, it } from 'vitest';
// The encoder's message type is a union the SDK does not export usefully; a message
// is a plain object of field names, so it is built as one and handed over as-is.
import { Encoder, Profile } from '@garmin/fitsdk';
type FitMesg = Record<string, unknown>;
import { parseFitActivity } from './importFile';

/** Degrees → the signed 32-bit "semicircles" a FIT file actually stores. */
function toSemicircles(deg: number): number {
  return Math.round(deg / (180 / 2 ** 31));
}

/** A real .fit file for a short walk, written the way a watch writes one. */
function buildFitFile(opts: { withFileId?: boolean } = {}): ArrayBuffer {
  const { withFileId = true } = opts;
  const start = new Date('2026-08-16T13:04:00.000Z');
  const encoder = new Encoder();
  const write = (m: FitMesg) =>
    (encoder as unknown as { writeMesg(m: FitMesg): void }).writeMesg(m);

  if (withFileId) {
    write({
      mesgNum: Profile.MesgNum.FILE_ID,
      type: 'activity',
      manufacturer: 'garmin',
      product: 3121,
      serialNumber: 3987654321,
      timeCreated: start,
    });
  }

  // ~500 m of track: 12 points walking north-east from a real trailhead.
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 12; i++) {
    points.push([39.050524 + i * 0.0004, -77.303298 + i * 0.0003]);
  }
  points.forEach(([lat, lng], i) => {
    write({
      mesgNum: Profile.MesgNum.RECORD,
      timestamp: new Date(start.getTime() + i * 30_000),
      positionLat: toSemicircles(lat),
      positionLong: toSemicircles(lng),
    });
  });

  write({
    mesgNum: Profile.MesgNum.SESSION,
    timestamp: new Date(start.getTime() + 11 * 30_000),
    startTime: start,
    sport: 'hiking',
    totalDistance: 5123.4,
    totalTimerTime: 330,
    totalElapsedTime: 330,
  });

  const bytes = encoder.close();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('parseFitActivity', () => {
  it('reads a real Garmin FIT file', async () => {
    const parsed = await parseFitActivity(buildFitFile(), 'activity_881.fit');

    // The failure being guarded: a null here is what produced "0 activities imported".
    expect(parsed, 'a valid FIT file must not parse to null').not.toBeNull();
    expect(parsed!.type).toBe('Hike');
    // FIT stores total_distance scaled, so the encoder's round-trip loses the tenth —
    // within a metre is the honest expectation, not exact equality.
    expect(parsed!.distance).toBeCloseTo(5123.4, -0.5);
    // Position survives the semicircle conversion — a wrong constant lands in the ocean.
    expect(parsed!.lat).toBeCloseTo(39.050524, 4);
    expect(parsed!.lng).toBeCloseTo(-77.303298, 4);
    expect(parsed!.date.slice(0, 16)).toBe('2026-08-16T13:04');
    expect(parsed!.polyline, 'a route with no line cannot be drawn').toBeTruthy();
  });

  it('carries the file_id through as the de-dup key, so a re-upload attaches', async () => {
    const parsed = await parseFitActivity(buildFitFile(), 'activity_881.fit');
    expect(parsed!.origin).toBe('garmin');
    // Tier 1 in 0203 keys off exactly this. Without it the same watch file re-imported
    // from a different folder becomes a second activity.
    expect(parsed!.externalKey).toMatch(/^fit:garmin:3121:3987654321:2026-08-16T13:04/);
  });

  it('still imports a FIT file that has no file_id, just without the key', async () => {
    // A partial key would collide across files, so it must be absent rather than guessed —
    // the activity is still worth keeping.
    const parsed = await parseFitActivity(buildFitFile({ withFileId: false }), 'x.fit');
    expect(parsed).not.toBeNull();
    expect(parsed!.externalKey).toBeUndefined();
  });

  it('returns null for something that is not a FIT file', async () => {
    const notFit = new TextEncoder().encode('<gpx version="1.1"></gpx>');
    const buf = notFit.buffer.slice(0, notFit.byteLength) as ArrayBuffer;
    expect(await parseFitActivity(buf, 'route.gpx')).toBeNull();
  });
});
