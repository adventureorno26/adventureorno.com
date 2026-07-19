// Pure ingest decision — the ordered gate that decides whether a photo is
// stored or skipped (and why). Kept free of I/O so it's unit-testable without
// R2 or the DB (see decide.test.ts). index.ts feeds it the results of the async
// checks it runs.

import type { SkipReason } from './exif';

export interface DecideInput {
  isDeleted: boolean; // sha256 in deleted_hashes (rule #6 — sticky)
  isDuplicate: boolean; // sha256 already in photos
  gate: SkipReason | null; // screenshotGate() result: no_gps | screenshot | null
  hasCoords: boolean;
  inZone: boolean; // inside the home-exclusion zone (rule #1)
  manual: boolean; // /upload (true) vs /ingest (false)
  override: boolean; // user asked to override warnings (manual only)
}

/** Returns the skip reason, or null to proceed with storage. A deliberate
 *  manual re-upload can bring back a previously-deleted photo (override); the
 *  automated ingest still won't resurrect deletions on its own. */
export function ingestDecision(i: DecideInput): SkipReason | null {
  if (i.isDeleted && !(i.manual && i.override)) return 'deleted';
  if (i.isDuplicate) return 'duplicate';

  // No coordinates at all is always fatal — we can't place the photo.
  if (!i.hasCoords) return 'no_gps';

  // Screenshot/format gate. On the manual path a deliberate override clears it.
  if (i.gate === 'screenshot' && !(i.manual && i.override)) return 'screenshot';
  if (i.gate === 'no_gps') return 'no_gps';

  // Home zone (rule #1). Overridable only on the deliberate manual path.
  if (i.inZone && !(i.manual && i.override)) return 'home_zone';

  return null;
}
