// EXIF extraction + the screenshot/format gate (business rule #5).
// The Worker is the *backstop* — the iOS Shortcut also filters screenshots — but
// it must independently reject: no GPS, PNG, and no camera make/model.

import exifr from 'exifr';

export interface ExifInfo {
  lat: number | null;
  lng: number | null;
  takenAt: string | null; // ISO
  make: string | null;
  model: string | null;
  isPng: boolean;
}

function sniffPng(bytes: Uint8Array): boolean {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

export async function readExif(bytes: Uint8Array): Promise<ExifInfo> {
  const isPng = sniffPng(bytes);
  let parsed: Record<string, unknown> = {};
  try {
    parsed =
      (await exifr.parse(bytes, {
        tiff: true,
        exif: true,
        gps: true,
        pick: ['Make', 'Model', 'DateTimeOriginal', 'CreateDate'],
      })) ?? {};
  } catch {
    parsed = {};
  }

  const lat = typeof parsed.latitude === 'number' ? (parsed.latitude as number) : null;
  const lng = typeof parsed.longitude === 'number' ? (parsed.longitude as number) : null;

  const dt = (parsed.DateTimeOriginal ?? parsed.CreateDate) as Date | string | undefined;
  let takenAt: string | null = null;
  if (dt instanceof Date && !isNaN(dt.getTime())) takenAt = dt.toISOString();
  else if (typeof dt === 'string' && dt) takenAt = dt;

  return {
    lat,
    lng,
    takenAt,
    make: typeof parsed.Make === 'string' ? (parsed.Make as string).trim() || null : null,
    model: typeof parsed.Model === 'string' ? (parsed.Model as string).trim() || null : null,
    isPng,
  };
}

export type SkipReason = 'no_gps' | 'screenshot' | 'deleted' | 'duplicate';

/** The format/GPS/camera gate. Returns a skip reason or null if the image passes.
 *  `noGps` is only a hard failure when coordinates can't be supplied another way
 *  (the manual path may pass explicit coordinates). */
export function screenshotGate(exif: ExifInfo, hasCoords: boolean): SkipReason | null {
  if (!hasCoords) return 'no_gps';
  if (exif.isPng) return 'screenshot';
  if (!exif.make || !exif.model) return 'screenshot';
  return null;
}
