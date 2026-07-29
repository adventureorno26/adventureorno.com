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

  if (!i.manual) {
    // Automated ingest (the Shortcut) keeps the full gate: it must have real GPS,
    // pass the screenshot/make-model check, and stay out of the home zone.
    if (!i.hasCoords) return 'no_gps';
    if (i.gate === 'screenshot') return 'screenshot';
    if (i.gate === 'no_gps') return 'no_gps';
    if (i.inZone) return 'home_zone';
    return null;
  }

  // Manual upload is deliberate. No coordinates is FINE — the photo is stored
  // unassigned (place_id null) and lands in the Sorter inbox to be placed by time.
  // Screenshots still need an explicit override; home-zone is overridable.
  if (i.gate === 'screenshot' && !i.override) return 'screenshot';
  if (i.inZone && !i.override) return 'home_zone';
  return null;
}
