// The client-side half of the handle rule, pinned against the DATABASE that enforces it.
//
// A client rule that drifts from its CHECK constraint is worse than no client rule: it
// refuses handles the database would have taken, and promises ones it will reject. The
// first draft of `RESERVED_HANDLES` here was written from memory and was wrong in both
// directions — it invented `bucket` and `health`, and missed fifty real entries. These
// tests read `0283` and fail if the copy and the constraint ever disagree again.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BIO_MAX,
  HANDLE_RE,
  RESERVED_HANDLES,
  suggestHandle,
  whatAStrangerSees,
  whyHandleIsInvalid,
} from './publicProfile';

const MIGRATION = readFileSync(
  new URL(
    '../../../supabase/migrations/0283_a_person_needs_a_name_to_be_found_by.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('the copy matches the database', () => {
  it('the handle pattern is the one in profiles_handle_format', () => {
    // The constraint, read out of the migration rather than retyped here.
    const m = /profiles_handle_format\s+check\s*\(handle\s*~\s*'([^']+)'\)/.exec(MIGRATION);
    expect(m, 'could not find profiles_handle_format in 0283').not.toBeNull();
    expect(HANDLE_RE.source).toBe(m![1]);
  });

  it('the bio limit is the one in profiles_bio_length', () => {
    const m = /char_length\(bio\)\s*<=\s*(\d+)/.exec(MIGRATION);
    expect(m).not.toBeNull();
    expect(BIO_MAX).toBe(Number(m![1]));
  });

  it('the reserved list is exactly handle_is_reserved()', () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf('function public.handle_is_reserved'));
    const arr = fn.slice(fn.indexOf('array['), fn.indexOf(']'));
    const fromDb = [...arr.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
    expect(fromDb.length, 'parsed no reserved handles out of 0283').toBeGreaterThan(50);
    expect([...RESERVED_HANDLES].sort()).toEqual(fromDb);
  });
});

describe('whyHandleIsInvalid', () => {
  it('accepts an ordinary handle', () => {
    expect(whyHandleIsInvalid('alex')).toBeNull();
    expect(whyHandleIsInvalid('e_2')).toBeNull();
    expect(whyHandleIsInvalid('a1')).toBeNull();
  });

  it('says the SPECIFIC thing that is wrong, not the whole rule', () => {
    // Somebody who typed `Alex` needs to be told about the capital, not handed the grammar.
    // NEUTRAL FIXTURES ON PURPOSE: `participants.test.ts` fails the build on a real
    // member's name used as a value anywhere in the app, and it caught this file.
    expect(whyHandleIsInvalid('Alex')).toBe('Handles are lowercase — try alex.');
    expect(whyHandleIsInvalid('alex river')).toBe('No spaces. Use an underscore instead.');
    expect(whyHandleIsInvalid('_alex')).toBe('Start with a letter or a number.');
    expect(whyHandleIsInvalid('e')).toBe('Too short — at least 2 characters.');
    expect(whyHandleIsInvalid('e'.repeat(31))).toBe('Too long — 30 characters at most.');
    expect(whyHandleIsInvalid('al-ex')).toBe('Letters, numbers and underscores only.');
  });

  it('refuses a reserved handle by name', () => {
    expect(whyHandleIsInvalid('people')).toMatch(/reserved/);
    expect(whyHandleIsInvalid('profile')).toMatch(/reserved/);
    expect(whyHandleIsInvalid('settings')).toMatch(/reserved/);
  });

  it('every handle it accepts also satisfies the database pattern', () => {
    for (const h of ['alex', 'a1', 'e_2', 'x'.repeat(30), 'sam_2026']) {
      expect(whyHandleIsInvalid(h), `${h} was accepted here`).toBeNull();
      expect(HANDLE_RE.test(h), `${h} would be refused by the constraint`).toBe(true);
    }
  });
});

describe('suggestHandle', () => {
  it('turns a display name into something typable', () => {
    expect(suggestHandle('Alex River')).toBe('alex_river');
    expect(suggestHandle('Sam')).toBe('sam');
  });
  it('is empty rather than wrong when nothing usable survives', () => {
    // A suggestion that the server will refuse is worse than no suggestion.
    expect(suggestHandle('!!')).toBe('');
    expect(suggestHandle('')).toBe('');
    expect(suggestHandle(null)).toBe('');
    expect(suggestHandle('People')).toBe(''); // reserved
  });
});

describe('whatAStrangerSees', () => {
  it('names the handle as the precondition', () => {
    expect(whatAStrangerSees({ handle: null, profile_visibility: 'public' })).toMatch(
      /no handle yet/,
    );
  });
  it('says nothing is visible while private', () => {
    expect(whatAStrangerSees({ handle: 'alex', profile_visibility: 'private' })).toMatch(
      /finds no one/,
    );
  });
  it('lists exactly what is switched on', () => {
    const base = { handle: 'alex', profile_visibility: 'public' };
    expect(whatAStrangerSees(base)).toBe('Your name and handle, and nothing else.');
    expect(whatAStrangerSees({ ...base, public_stats: true })).toBe(
      'Your name and handle, and your totals.',
    );
    expect(
      whatAStrangerSees({
        ...base,
        public_stats: true,
        public_places: true,
        public_activity: true,
      }),
    ).toBe('Your name and handle, your totals, your places and your recent outings.');
  });
});
