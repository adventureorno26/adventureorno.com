import { describe, expect, it } from 'vitest';
import { asOutcome, mergeOutcomes, whoOutcomeMessage } from './whoWasThere';

// Since 0236/0240, naming somebody else on an outing, a visit or a place is a QUESTION.
// The screens could only report it as a fact, because the RPCs returned void. These are the
// properties that make the replacement trustworthy.

// Deliberately not the two people who use this app: `participants.test.ts` guards against a
// member's name being written by hand anywhere in the source, and a fixture is source.
const people = [
  { id: 'me', display_name: 'Ada' },
  { id: 'them', display_name: 'Bo' },
  { id: 'nameless', display_name: null },
];

describe('asOutcome', () => {
  it('reads what the function returned', () => {
    expect(asOutcome({ stated: 12, asked: ['them'], removed: 1 })).toEqual({
      stated: 12,
      asked: ['them'],
      removed: 1,
    });
  });

  it('treats an older deploy answering null as nothing to report, not a crash', () => {
    // The picker still worked before 0243; it just could not say anything.
    expect(asOutcome(null)).toEqual({ stated: 0, asked: [], removed: 0 });
    expect(asOutcome(undefined)).toEqual({ stated: 0, asked: [], removed: 0 });
    expect(asOutcome('nonsense')).toEqual({ stated: 0, asked: [], removed: 0 });
  });

  it('drops anything in `asked` that is not an id', () => {
    expect(asOutcome({ stated: 0, asked: ['them', 7, null], removed: 0 }).asked).toEqual(['them']);
  });
});

describe('mergeOutcomes', () => {
  it('is one sentence for a batch, and never names the same person twice', () => {
    const merged = mergeOutcomes([
      { stated: 1, asked: ['them'], removed: 0 },
      { stated: 1, asked: ['them'], removed: 2 },
      { stated: 1, asked: [], removed: 0 },
    ]);
    expect(merged).toEqual({ stated: 3, asked: ['them'], removed: 2 });
  });

  it('of nothing is nothing', () => {
    expect(mergeOutcomes([])).toEqual({ stated: 0, asked: [], removed: 0 });
  });
});

describe('whoOutcomeMessage', () => {
  it('says nothing when nobody was asked', () => {
    // Stating your own presence and removing somebody are visible on the screen that did
    // them; a snack confirming what you can already see is noise.
    expect(whoOutcomeMessage({ stated: 43, asked: [], removed: 2 }, people)).toBeNull();
  });

  it('names the person, and says the tag is not a fact yet', () => {
    const m = whoOutcomeMessage({ stated: 0, asked: ['them'], removed: 0 }, people);
    expect(m).toContain('Bo');
    expect(m).toMatch(/once they say yes/);
  });

  it('lists several people readably', () => {
    expect(whoOutcomeMessage({ stated: 0, asked: ['them', 'me'], removed: 0 }, people)).toContain(
      'Bo and Ada',
    );
  });

  it('falls back to "them" rather than printing a blank or an id', () => {
    const m = whoOutcomeMessage({ stated: 0, asked: ['nameless'], removed: 0 }, people);
    expect(m).toBe('Asked them. It counts for them once they say yes.');
    const unknown = whoOutcomeMessage({ stated: 0, asked: ['nobody-here'], removed: 0 }, people);
    expect(unknown).toBe('Asked them. It counts for them once they say yes.');
  });
});
