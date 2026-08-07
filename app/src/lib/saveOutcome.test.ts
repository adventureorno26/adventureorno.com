import { describe, it, expect } from 'vitest';
import { saveOutcomeMessage, isPartialSave } from './saveOutcome';

// Guards the Phase 2 rule: never report a partial save as an unqualified success.
describe('saveOutcomeMessage', () => {
  it('reports plain success when nothing failed', () => {
    expect(saveOutcomeMessage({ uploaded: 3, failed: 0 })).toBe('Saved!');
  });

  it('reports plain success when there were no photos at all', () => {
    expect(saveOutcomeMessage({ uploaded: 0, failed: 0 })).toBe('Saved!');
  });

  it('never says only "Saved!" when a photo failed', () => {
    // The exact regression: every photo failing used to be indistinguishable
    // from complete success.
    expect(saveOutcomeMessage({ uploaded: 0, failed: 1 })).not.toBe('Saved!');
    expect(saveOutcomeMessage({ uploaded: 0, failed: 4 })).not.toBe('Saved!');
    expect(saveOutcomeMessage({ uploaded: 2, failed: 1 })).not.toBe('Saved!');
  });

  it('names the total failure case and how to recover', () => {
    expect(saveOutcomeMessage({ uploaded: 0, failed: 1 })).toBe(
      'Saved, but the photo failed to upload. Add it again from the place.',
    );
    expect(saveOutcomeMessage({ uploaded: 0, failed: 3 })).toBe(
      'Saved, but all 3 photos failed to upload. Add them again from the place.',
    );
  });

  it('gives exact counts for a partial failure', () => {
    expect(saveOutcomeMessage({ uploaded: 2, failed: 1 })).toBe(
      'Saved — 2 of 3 photos uploaded. 1 failed; add it again from the place.',
    );
    expect(saveOutcomeMessage({ uploaded: 5, failed: 2 })).toBe(
      'Saved — 5 of 7 photos uploaded. 2 failed; add them again from the place.',
    );
  });

  it('still confirms the core save succeeded in every partial case', () => {
    // The visit is genuinely saved; the message must not imply otherwise or the
    // user will log the visit a second time.
    for (const outcome of [
      { uploaded: 0, failed: 1 },
      { uploaded: 0, failed: 9 },
      { uploaded: 1, failed: 1 },
    ]) {
      expect(saveOutcomeMessage(outcome).toLowerCase()).toContain('saved');
    }
  });

  it('flags partial saves', () => {
    expect(isPartialSave({ uploaded: 3, failed: 0 })).toBe(false);
    expect(isPartialSave({ uploaded: 0, failed: 0 })).toBe(false);
    expect(isPartialSave({ uploaded: 3, failed: 1 })).toBe(true);
  });
});
