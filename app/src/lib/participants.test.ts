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
import {
  ANYONE_KEY,
  everyoneLabel,
  whoChoices,
  whoFilterChoices,
  whoKey,
  whoProfileId,
} from './participants';
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

describe('a filter asks the same question, plus one', () => {
  it('offers ANYONE and then exactly the attribution choices, in that order', () => {
    // The point of the whole consolidation: a filter and a picker say the same words in
    // the same order, so there is nothing to learn twice. /places/edit used to read
    // "All / Just me / Just Josh / Together" - its own word for everyone, its own order,
    // and the everyone pill typed in by hand.
    expect(whoFilterChoices([ME, JOSH], ME.id).map((c) => c.label)).toEqual([
      'Anyone',
      'Together',
      'Just me',
      'Just Josh',
    ]);
  });

  it('says "Everyone", not "Together", once a third member exists', () => {
    // The hand-written pill could not do this: it said "Together" for three people.
    expect(whoFilterChoices([ME, JOSH, THIRD], ME.id).map((c) => c.label)).toEqual([
      'Anyone',
      'Everyone',
      'Just me',
      'Just Josh',
      'Just Sam',
    ]);
  });

  it('keeps ANYONE and `both` as different answers', () => {
    // They are not the same question, and merging them would HIDE ROWS: /places/edit
    // lists a place nobody has recorded a visit to under `all` and never under `both`.
    const keys = whoFilterChoices([ME, JOSH], ME.id).map((c) => c.key);
    expect(keys).toContain(ANYONE_KEY);
    expect(keys).toContain('both');
    expect(ANYONE_KEY).not.toBe('both');
  });

  it('adds nothing but that one extra answer', () => {
    const attribution = whoChoices([ME, JOSH, THIRD], ME.id);
    expect(whoFilterChoices([ME, JOSH, THIRD], ME.id).slice(1)).toEqual(attribution);
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

/** Source with its comments removed - a rule about what the app SAYS must not be tripped
 *  by a comment quoting the very word it retired. */
const strip = (src: string) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

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

  // ONE VOCABULARY, ENFORCED. Seven surfaces asked "who was there" and three of them
  // still built the option list by hand - `<option value="">{everyoneLabel(people)}</option>`
  // followed by `people.map((p) => (p.id === profile?.id ? 'Just me' : ...))`. That is
  // whoChoices() re-implemented, and re-implementations drift: each carried its own copy
  // of the everyone-word, and none of them put "Just me" where the pickers put it.
  it('has no hand-written "Just me" option outside the helper', () => {
    const offenders = Object.entries(RAW)
      .filter(([path]) => !/participants\.(ts|test\.ts)$/.test(path))
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, src]) => /Just me/.test(strip(src)))
      .map(([path]) => path);
    expect(offenders, 'build the choices with whoChoices() instead').toEqual([]);
  });

  // Erica, 2026-08-15: "the view is Together so investigate why you are saying Both".
  // The word outlived that instruction on /bucket - "Both want to go", in the filter and
  // again on every row - because the Settings guard below only ever read one file.
  //
  // Scoped to the word USED OF PEOPLE. "Both recordings are kept" on the Inbox is two
  // recordings, not two members, and a guard that cannot tell the difference is a guard
  // somebody switches off the first time it is wrong.
  it('does not use the retired word "Both" of people', () => {
    const offenders = Object.entries(RAW)
      .filter(([path]) => !/participants\.(ts|test\.ts)$/.test(path))
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, src]) => />\s*Both\b|\bBoth (want|of us|of them|of you)\b/.test(strip(src)))
      .map(([path]) => path);
    expect(offenders, 'the everyone-word comes from everyoneLabel()').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// EVERY SURFACE THAT ASKS "WHO WAS THERE", BY NAME.
//
// The audit behind this consolidation found seven of them and three vocabularies:
// Together on the cards, All on the places editor, Both on the bucket list. A guard that
// only knows about the file that was wrong LAST time is how the bucket list went on
// saying "Both" long after the word was retired - so the list is the whole set, and a
// new surface joins it rather than starting a fourth vocabulary.
// ---------------------------------------------------------------------------
describe('every who-was-there control is generated', () => {
  const file = (name: string) => Object.entries(RAW).find(([p]) => p.endsWith(name))?.[1] ?? '';

  // An ATTRIBUTION - who was on this visit. Its choices are whoChoices(), always.
  const ATTRIBUTION = [
    'components/NewPlaceDraft.tsx', // the new-place card, /?add=1
    'components/PlacePanel.tsx', // a saved card: the visit rows AND add-a-visit
    'components/PlaceQuickEdit.tsx',
    'routes/VisitPage.tsx',
    'routes/PlacesEditor.tsx', // the per-row "Who was there"
    'routes/PhotoSorter.tsx',
    'routes/Settings.tsx', // the Stats scope
  ];

  for (const name of ATTRIBUTION) {
    it(`${name} builds its choices from the real members`, () => {
      const src = file(name);
      expect(src.length, `app/src/${name} should be readable`).toBeGreaterThan(500);
      expect(strip(src), 'call whoChoices() rather than mapping people by hand').toMatch(
        /whoChoices\(/,
      );
    });
  }

  it('the /places/edit filter takes its pills from whoFilterChoices()', () => {
    // It used to take whoChoices(), REMOVE the everyone choice and re-add it at the end
    // with the word typed in - so it read "All / Just me / Just Josh / Together" while
    // every card read "Together / Just me / Just Josh", and with three members its
    // hand-typed pill went on saying "Together" after the cards had moved to "Everyone".
    const src = strip(file('routes/PlacesEditor.tsx'));
    expect(src).toMatch(/whoFilterChoices\(/);
    expect(src, 'the no-restriction key comes from ANYONE_KEY').not.toMatch(/key: 'all'/);
  });

  it('the /bucket list takes its everyone-word from everyoneLabel()', () => {
    const src = strip(file('routes/BucketList.tsx'));
    expect(src).toMatch(/everyoneLabel\(/);
  });

  it('PersonFilter.tsx is gone, not sitting there as a fifth implementation', () => {
    // 32 lines, zero importers, superseded by PeopleFilter - and still carrying its own
    // "Together / Just me / Just Josh" list for whoever wired it back up.
    expect(Object.keys(RAW).filter((p) => p.endsWith('components/PersonFilter.tsx'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Settings › Stats had the LAST hand-written one. Its person toggle rendered a
// literal "Both" button and then one button per member labelled from display_name —
// a fifth private implementation of this control, and the one place the retired word
// survived. It is `whoChoices()` now, like everywhere else.
// ---------------------------------------------------------------------------
describe('the stats toggle in Settings is generated', () => {
  const src = Object.entries(RAW).find(([p]) => p.endsWith('/routes/Settings.tsx'))?.[1] ?? '';

  it('can read Settings.tsx', () => {
    expect(src.length, 'app/src/routes/Settings.tsx should be readable').toBeGreaterThan(1000);
  });

  it('builds its choices from the real members', () => {
    // whoChoices names them; whoProfileId turns the chosen key back into the profile
    // the stats are filtered by. Reading `people` and labelling by hand is the bug.
    expect(src).toMatch(/whoChoices\(/);
    expect(src).toMatch(/whoProfileId\(/);
  });

  it('does not write the retired word "Both" as a button', () => {
    // Erica, 2026-08-15: "the view is Together so investigate why you are saying Both".
    // everyoneLabel() decides that word — Together for two, Everyone for three.
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/>\s*Both\s*</);
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
