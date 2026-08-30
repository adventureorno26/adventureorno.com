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
import { isOurStats, myStats, ourStats, scopeLabel, scopeNames, scopeSentence } from './statsScope';
import type { PersonContact } from './memoryPeople';
import type { MapPerson } from './data';

const person = (id: string, display_name: string): MapPerson => ({ id, display_name }) as MapPerson;

const ME = person('me-id', 'Erica');
const JOSH = person('josh-id', 'Josh');
const THIRD = person('third-id', 'Sam');

/** The same three, as CONTACTS — what `my_people` returns, which is what a scope is made
 *  of. A scope is about PEOPLE (public.people ids), never about profiles: only two of
 *  these have an account and all three can be in Our Stats. */
const contact = (id: string, display_name: string, is_me = false): PersonContact => ({
  id,
  display_name,
  linked_profile: null,
  favourite: false,
  is_me,
});
const CONTACTS: PersonContact[] = [
  contact('me-id', 'Erica', true),
  contact('josh-id', 'Josh'),
  contact('sam-id', 'Sam'),
];

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
    // routes/Settings.tsx IS NO LONGER ONE OF THESE (0280). Its Stats section does not ask
    // "who was on this visit" — it asks "whose numbers are these", which is a SCOPE, and a
    // scope is not an attribution. Keeping it here is what let the two look interchangeable:
    // whoChoices()'s everyone-answer resolves to a null profile, the old readers take a null
    // as "only what we were BOTH on", and Settings printed 17 Trips beside /insights' 56.
    // The scope guard below is the replacement, and it covers all three stats screens.
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
// ONE SCOPE, THREE SCREENS — §0.2, and the reason migration 0280 exists.
//
// Settings › Stats, /insights and the Map each show numbers about the same account, and
// each used to decide privately what "everyone" meant. Settings' pills resolved to a null
// profile and /insights' to an empty people list, which are OPPOSITE instructions to the
// two generations of reader: 17 Trips and 56 Trips, live, at the same moment.
//
// So no screen may define a scope. It comes from lib/statsScope, whose `myStats()` is the
// one place that says what everything opens on, and it is spent through the people-aware
// readers only. A fourth stats screen joins this list rather than starting a fifth answer.
// ---------------------------------------------------------------------------
describe('every stats screen takes its scope from the same place', () => {
  const file = (name: string) => Object.entries(RAW).find(([p]) => p.endsWith(name))?.[1] ?? '';
  const SCREENS = ['routes/Settings.tsx', 'routes/Insights.tsx', 'routes/MapView.tsx'];

  for (const name of SCREENS) {
    it(`${name} opens on myStats() from lib/statsScope`, () => {
      const src = file(name);
      expect(src.length, `app/src/${name} should be readable`).toBeGreaterThan(500);
      expect(strip(src), 'import myStats from lib/statsScope').toMatch(
        /myStats[\s\S]{0,120}from '\.\.\/lib\/statsScope'/,
      );
      expect(strip(src), 'render the shared PeopleFilter').toMatch(/<PeopleFilter/);
    });

    it(`${name} does not build a scope of its own`, () => {
      // A literal selection is a screen answering the question lib/statsScope answers.
      // `{ people: [], ... }` is the retired everybody-scope; `mode: 'any'` is the retired
      // operator, which asks for things at least ONE of us did — two histories shuffled
      // together rather than a shared one.
      const code = strip(file(name));
      expect(code, 'the empty selection is the retired everybody-scope').not.toMatch(
        /people:\s*\[\s*\]/,
      );
      expect(code, 'the ANY operator is retired - Our Stats is the overlap').not.toMatch(
        /mode:\s*'any'/,
      );
    });
  }

  it('no screen still calls a p_profile reader', () => {
    // The app-side wrappers were deleted in 0280 precisely so this cannot be typed again:
    // they took `string | null` and handed the null to a reader that reads it as "shared".
    const offenders = Object.entries(RAW)
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, src]) =>
        /\brpc\('(trips_list|wander_stats|settings_stats|race_stats|races_list|mileage_by_person|activities_of_type|activity_lines|place_ids_for_view|place_visit_counts|occasion_count|geo_coverage|climbing_stats|peaks_bagged)'/.test(
          strip(src),
        ),
      )
      .map(([path]) => path);
    expect(offenders, 'call the _for_people sibling with a scope instead').toEqual([]);
  });

  it('the scope words are written once, in lib/statsScope', () => {
    // "My Stats" and "Our Stats" name the same thing on every screen or they name nothing.
    const scope = file('/statsScope.ts');
    expect(scope).toMatch(/'My Stats'/);
    expect(scope).toMatch(/'Our Stats'/);
    const offenders = Object.entries(RAW)
      .filter(([path]) => !/statsScope\.ts$/.test(path))
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, src]) => /['"](My|Our) Stats['"]/.test(strip(src)))
      .map(([path]) => path);
    expect(offenders, 'use scopeLabel() rather than typing the word').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE CONTROL OFFERS TWO SCOPES AND NOBODY'S NAME — §0.2, and the defect that produced it.
//
// Measured on production 2026-08-30 the map's bottom control read:
//
//     [My Stats]  [Josh]
//
// which is half of the new model and a pill of the old one. `My Stats` is a SCOPE and
// `Josh` is a PERSON, so one control offered two different kinds of answer and neither of
// them was Our Stats — the very scope §0.2 approved. Erica saw it and objected.
//
// §0.2 on the third scope: a person's own history is *"seen by opening their profile —
// never a pill on my map."* So the control renders exactly two buttons, and choosing WHO
// Our Stats is about is a separate act in its own picker.
// ---------------------------------------------------------------------------
describe('the scope control', () => {
  const file = (name: string) => Object.entries(RAW).find(([p]) => p.endsWith(name))?.[1] ?? '';

  it('renders the two scope words and nothing else you can press to pick a scope', () => {
    const code = strip(file('components/PeopleFilter.tsx'));
    expect(code.length, 'app/src/components/PeopleFilter.tsx should be readable').toBeGreaterThan(
      500,
    );
    // The words come from lib, so the guard above stays true and the three screens cannot
    // drift apart.
    expect(code, 'render MY_STATS from lib/statsScope').toMatch(/\{MY_STATS\}/);
    expect(code, 'render OUR_STATS from lib/statsScope').toMatch(/\{OUR_STATS\}/);
    // THE PILL. It mapped every contact to a button, which is how a person's name got onto
    // a control about me. Nothing in the control may iterate the OTHER people any more —
    // only the picker inside the sheet may, and it is behind `picking`.
    expect(code, 'the scope row must not map people to buttons').not.toMatch(
      /people-filter[\s\S]{0,600}others\.map\(/,
    );
  });

  it('cannot show Our Stats until somebody has been picked', () => {
    // With nobody picked, "Our Stats" would silently be My Stats under the other word —
    // one question with two answers, which is the class of defect 0280 exists to end.
    const code = strip(file('components/PeopleFilter.tsx'));
    expect(code, 'the apply button is disabled while the pick is empty').toMatch(
      /disabled=\{draft\.length === 0\}/,
    );
    // And the library refuses too, so a second caller cannot get there another way.
    expect(ourStats(CONTACTS, [])).toBeNull();
  });

  it('a person is reachable from their profile, not from the map', () => {
    // The third scope has a route and this is it. If it ever goes, this fails rather than
    // the pill quietly coming back as the only way to ask the question.
    expect(strip(file('App.tsx'))).toMatch(/path="\/people\/:personId"/);
    expect(file('routes/PersonPage.tsx').length).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// THE RETIRED WORDS CANNOT COME BACK — §0.2's list, checked on each surface by name.
//
//     Just me   Just Josh   Just Erica   Together   Both   All   Anyone
//     the ALL / ANY operator
//
// NAMED INDIVIDUALLY, like the `whoChoices()` guard above, and for the same reason: a rule
// written as "somewhere in the app" is one a new screen is born outside of. `/bucket` kept
// the retired word "Both" for a year under a guard that only ever read `Settings.tsx`.
//
// COMMENTS ARE STRIPPED FIRST. §0.2 bans these words in comments too, but a file has to be
// able to record WHICH word it retired — `PeopleFilter.tsx` keeps that ledger deliberately
// — and a guard that made the ledger illegal would be deleted rather than obeyed.
// ---------------------------------------------------------------------------
describe('the retired scope words stay retired', () => {
  const file = (name: string) => Object.entries(RAW).find(([p]) => p.endsWith(name))?.[1] ?? '';

  // Every surface that renders a scope, a scope's name, or the people in one. The glob
  // keys this file's own directory as `./`, so the lib entry carries no `lib/` prefix.
  const SURFACES = [
    'statsScope.ts',
    'components/PeopleFilter.tsx',
    'components/FilterChips.tsx',
    'components/StatsBar.tsx',
    'routes/MapView.tsx',
    'routes/Insights.tsx',
    'routes/Settings.tsx',
    'routes/PersonPage.tsx',
  ];

  // Each pattern is the word AS A LABEL OR AN OPERATOR, not as ordinary English: prose may
  // still say "both of us went", and a MapLibre filter may still be `['all', …]`.
  const RETIRED: [string, RegExp][] = [
    ['Just me', /\bJust me\b/],
    ['a member named in a scope label', /\bJust (?:\$\{|[A-Z])/],
    ['Together', /\bTogether\b/],
    ['Both', /\bBoth\b/],
    ['Anyone', /\bAnyone\b/],
    ['the ANY operator', /'any'/],
    ['All of them / Any of them', /\b(?:All|Any) of them\b/],
    ['a bare All / Any label', /['"](?:All|Any)['"]/],
    ['ANYONE_KEY', /\bANYONE_KEY\b/],
  ];

  for (const name of SURFACES) {
    it(`${name} says none of them`, () => {
      const src = file(name);
      expect(src.length, `app/src/${name} should be readable`).toBeGreaterThan(500);
      const code = strip(src);
      const found = RETIRED.filter(([, re]) => re.test(code)).map(([label]) => label);
      expect(found, `§0.2 retired these — use My Stats / Our Stats`).toEqual([]);
    });
  }

  it('and the operator cannot be expressed in a type either', () => {
    // The strongest form of the rule: not "no screen writes ANY" but "no screen CAN".
    expect(strip(file('/statsScope.ts')), 'PeopleSelection.mode is pinned').toMatch(
      /mode:\s*'all';/,
    );
    expect(strip(file('/memoryPeople.ts')), 'the memories reader is pinned too').not.toMatch(
      /mode:\s*'all'\s*\|\s*'any'/,
    );
  });
});

// ---------------------------------------------------------------------------
// The three scopes, as behaviour rather than as source text.
// ---------------------------------------------------------------------------
describe('the three scopes', () => {
  it('My Stats is me, and only me', () => {
    expect(myStats(CONTACTS)).toEqual({ people: ['me-id'], mode: 'all' });
    expect(scopeLabel(myStats(CONTACTS)!, CONTACTS)).toBe('My Stats');
    expect(scopeSentence(myStats(CONTACTS)!, CONTACTS)).toBe('Every card you are tagged on.');
  });

  it('Our Stats always contains me, however it was asked for', () => {
    // Picking Josh asks what HE AND I both did. A set without me is a question about
    // somebody else, and that question belongs on their profile.
    expect(ourStats(CONTACTS, ['josh-id'])!.people).toEqual(['me-id', 'josh-id']);
    expect(ourStats(CONTACTS, ['me-id', 'josh-id'])!.people).toEqual(['me-id', 'josh-id']);
  });

  it('three people means the overlap of three, in the order the contacts came', () => {
    expect(ourStats(CONTACTS, ['sam-id', 'josh-id'])!.people).toEqual([
      'me-id',
      'josh-id',
      'sam-id',
    ]);
    expect(scopeNames(ourStats(CONTACTS, ['sam-id', 'josh-id'])!, CONTACTS)).toBe('Josh and Sam');
    expect(scopeSentence(ourStats(CONTACTS, ['sam-id', 'josh-id'])!, CONTACTS)).toBe(
      'Only the cards you and Josh and Sam are all tagged on.',
    );
  });

  it('an empty pick is not Our Stats under another name', () => {
    expect(ourStats(CONTACTS, [])).toBeNull();
    expect(ourStats(CONTACTS, ['nobody-i-know'])).toBeNull();
    expect(isOurStats(myStats(CONTACTS)!, CONTACTS)).toBe(false);
    expect(isOurStats(ourStats(CONTACTS, ['josh-id'])!, CONTACTS)).toBe(true);
  });

  it('the label follows the scope, not the caller', () => {
    expect(scopeLabel(ourStats(CONTACTS, ['josh-id'])!, CONTACTS)).toBe('Our Stats');
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
