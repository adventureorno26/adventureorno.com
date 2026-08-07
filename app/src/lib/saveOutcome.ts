// Truthful save messaging (COMPLETION-PLAN Phase 2).
//
// The core record (place + visit + attribution + rating + review) is written
// atomically by create_experience. Media deliberately is NOT part of that
// transaction — a photo that fails to upload must not roll back a correctly
// saved visit. But "not atomic" must never become "not reported": the previous
// code mapped every failed upload to `null` and then showed an unconditional
// "Saved!", so a save in which every single photo failed looked identical to a
// completely successful one.
//
// Kept as a pure function so the exact wording is unit-testable.

export type SaveOutcome = {
  /** Photos that stored successfully. */
  uploaded: number;
  /** Photos that failed. */
  failed: number;
};

/**
 * The message for a save whose CORE succeeded. Never call this when the core
 * write failed — that is an error path, not a partial success.
 */
export function saveOutcomeMessage({ uploaded, failed }: SaveOutcome): string {
  if (failed <= 0) return 'Saved!';

  const total = uploaded + failed;
  const them = failed === 1 ? 'it' : 'them';

  if (uploaded === 0) {
    const what = failed === 1 ? 'the photo' : `all ${failed} photos`;
    return `Saved, but ${what} failed to upload. Add ${them} again from the place.`;
  }
  return `Saved — ${uploaded} of ${total} photos uploaded. ${failed} failed; add ${them} again from the place.`;
}

/** True when the outcome is anything other than complete success. */
export function isPartialSave(outcome: SaveOutcome): boolean {
  return outcome.failed > 0;
}
