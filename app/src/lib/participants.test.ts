// The guard against a person being hardcoded back into the app.
//
// Four components each declared `type Who = 'both' | 'mine' | 'josh'` and rendered a
// literal `<option value="josh">Just Josh</option>`, while resolving the id behind it
// as "whichever member isn't me". With two people that works. With three it labels an
// arbitrary member "Josh" and saves the wrong attribution — and the whole point of the
// flok work is that a third person can join.
//
// So: the choices come from the real members, and this test fails the build if a
// name-shaped choice is written by hand again.
import { describe, expect, it } from 'vitest';
import { everyoneLabel, whoChoices, whoKey, whoProfileId } from './participants';
import type { MapPerson } from './data';

const person = (id: string, display_name: string): MapPerson => ({ id, display_name }) as MapPerson;

const ME = person('me-id', 'Erica');
const JOSH = person('josh-id', 'Josh');
const THIRD = person('third-id', 'Sam');

describe('who was there', () => {
  it('reads exactly as it did before, with two members', () => {
    // The control must not visibly change for Erica. Same words, same order.
    // TOGETHER, not "Both" (Erica, 2026-08-15: "the view is Together so investigate why
    // you are saying Both"). The label used to depend on a style option the caller had to
    // remember to pass, so the same idea appeared under two words on different screens.
    expect(whoChoices([ME, JOSH], ME.id).map((c) => c.label)).toEqual([
      'Together',
      'Just me',
      'Just Josh',
    ]);
  });

  it('names a third member instead of dropping them', () => {
    const labels = whoChoices([ME, JOSH, THIRD], ME.id).map((c) => c.label);
    expect(labels).toEqual(['Everyone', 'Just me', 'Just Josh', 'Just Sam']);
    // "Both" is a lie once there are three.
    expect(everyoneLabel([ME, JOSH, THIRD])).toBe('Everyone');
  });

  it('carries the profile id, so a choice cannot mean the wrong person', () => {
    const choices = whoChoices([ME, JOSH, THIRD], ME.id);
    expect(choices.map((c) => c.profileId)).toEqual([null, ME.id, JOSH.id, THIRD.id]);
  });

  it('round-trips an attribution back to the choice that produced it', () => {
    for (const stored of [null, ME.id, JOSH.id, THIRD.id]) {
      const key = whoKey(stored, ME.id);
      expect(whoProfileId(key, ME.id)).toBe(stored);
    }
  });

  it('survives a member with no display name without guessing one', () => {
    const nameless = person('x-id', null as unknown as string);
    expect(whoChoices([ME, nameless], ME.id).map((c) => c.label)).toEqual([
      'Together',
      'Just me',
      'Just them',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The source guard: no component may write a member's name by hand again.
// ---------------------------------------------------------------------------
const RAW = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const HOOKS = import.meta.glob('../../../.githooks/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('no member is hardcoded', () => {
  it('has no hand-written person choice anywhere in the app', () => {
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(RAW)) {
      if (/participants\.(ts|test\.ts)$/.test(path)) continue; // this file and its subject
      const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      // A choice keyed by a nickname — `value="josh"`, `'josh'` in a union, and so on.
      if (/['"]josh['"]/i.test(code)) offenders.push(`${path} (a nickname as a value)`);
      // A label naming a specific member rather than reading display_name.
      if (/Just\s+(Josh|Erica)\b/.test(code)) offenders.push(`${path} (a member named in a label)`);
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The client stays typed, and the gate stays real.
// ---------------------------------------------------------------------------
describe('the generated types actually reach the code', () => {
  it('creates the Supabase client with the Database generic', () => {
    // Without `createClient<Database>`, `.from()` and `.rpc()` accept ANY string:
    // a table that does not exist and an RPC that does not exist both typecheck.
    // That is how a call to `trip_timeline` — never a function in this database —
    // shipped and silently returned an empty list.
    const [, src] = Object.entries(RAW).find(([p]) => p.endsWith('/supabase.ts')) ?? [];
    expect(src, 'app/src/lib/supabase.ts should be readable').toBeTruthy();
    expect(src).toMatch(/createClient<Database>\(/);
  });

  it('does not typecheck the app with the solution stub, which checks nothing', () => {
    // `app/tsconfig.json` is `{"files": [], "references": [...]}`. `tsc -p` does not
    // follow project references, so that command compiles NOTHING and always exits 0.
    // The hook and CI must use `tsc -b`.
    const [, hook] = Object.entries(HOOKS).find(([p]) => p.endsWith('pre-commit')) ?? [];
    if (hook) expect(hook).not.toMatch(/tsc -p .*tsconfig\.json/);
  });
});
