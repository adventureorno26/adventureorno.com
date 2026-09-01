// THE GUARD. This test exists because Erica has had to ask for the same removals
// over and over — "Ive told you to remove spots 500 fucking times", "I DO NOT WANT
// THE PLACES HERE SECTION. I HAVE ASKED SO MANY FUCKING TIMES" — and every time,
// something put them back. Reviews and good intentions have not held.
//
// So the rules are executable now. Every word she has banned is listed here, and the
// build FAILS if one reappears anywhere in the app's own source. A future change that
// reintroduces "spot" or "PLACES HERE" cannot reach the site: CI runs this before
// Cloudflare will deploy.
//
// If a rule here is ever wrong, it is changed HERE, on purpose, with her say-so —
// which is the point. It cannot drift back by accident.
//
// Adding to this list is cheap. Do it every time she says "never again".
import { describe, expect, it } from 'vitest';

// The sources are read through Vite rather than node:fs — the app is type-checked
// without @types/node, and this also survives the space in the repo's path.
const RAW = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const SOURCES = Object.entries(RAW).filter(([path]) => !/\.test\.tsx?$/.test(path));

/** The text a person can actually READ: string and JSX literals, not identifiers,
 *  class names, comments or imports. A CSS class called `spot-row` is invisible to
 *  her; a button that says "Add spot" is not. */
function visibleText(source: string): string {
  return (
    source
      // comments — they explain the rules, so they must not trip them
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      // className="..." / className={`...`}
      .replace(/className=\{?[`"'][^`"']*[`"']\}?/g, '')
      .replace(/import[^;]+;/g, '')
      // remaining quoted strings and JSX text are what she reads
      .replace(/\bdata-[a-z-]+="[^"]*"/g, '')
  );
}

const BANNED: { word: RegExp; why: string }[] = [
  { word: /\bspots?\b/i, why: 'Erica, many times: the word "spot" is not in this app.' },
  { word: /places here/i, why: 'The PLACES HERE section. Asked for its removal repeatedly.' },
  { word: /places inside/i, why: '"N places inside" — gone from every card.' },
  { word: /put a place inside/i, why: '"+ Put a place inside this one" — gone.' },
  { word: /tap a date/i, why: 'Out of the Visits section entirely.' },
  { word: /this is a trail\b/i, why: 'Not on a destination or visit card.' },
  {
    word: /\bboth of us\b/i,
    why: 'Erica, 2026-08-15: the view is TOGETHER. "Both of us" was still on the visit form.',
  },
  // ---- THE HOUSEHOLD IS GONE, and these are the words that would bring it back ----
  //
  // Erica, 2026-09-01: "I really want to make sure the foundation of this platform has
  // changed from a private household/couple history app to fundamentally a social network,
  // activity platform, group planner, event system, and location-sharing application."
  //
  // This catches WORDS. It did not catch `SharedHub` — an "Our apps" launcher with Wegmans,
  // Netflix and Spotify behind the line "sign in there with your shared household login" —
  // because the giveaway there was what the feature WAS, not what it said. A scanner finds
  // vocabulary; only reading finds a model. Both are needed.
  {
    word: /\bhouseholds?\b/i,
    why: 'There is no household (§0.2). It is a social platform, not a shared home account.',
  },
  {
    word: /\bcouples?\b/i,
    why: 'Two people are two connections, not a unit the product knows about.',
  },
  {
    word: /\bflok\b/i,
    why: 'CLAUDE.md: a working title, NOT decided — never in the product, the docs or the repo.',
  },
  // `partner` is deliberately NOT here. The people contract allows a partner to be a
  // FAVOURITE — a shortcut — so the word can honestly appear as a label. What is banned is
  // partner as a SCOPE, a counting rule or a storage type, and that lives in
  // participants.test.ts where the scopes are guarded.
];

const CARD = SOURCES.find(([p]) => p.endsWith('components/PlacePanel.tsx'))?.[1] ?? '';
const BLANK = SOURCES.find(([p]) => p.endsWith('components/NewPlaceDraft.tsx'))?.[1] ?? '';
// THE COVER IS ITS OWN COMPONENT SINCE 2026-08-28, shared by the destination card, the
// visit card and the blank card — which is the only way "ONE card" can be true rather
// than asserted. The name/rating guard below follows the markup here rather than staying
// pointed at the file it used to live in.
const COVER = SOURCES.find(([p]) => p.endsWith('components/CardCover.tsx'))?.[1] ?? '';
const ADD_ACTIVITY = SOURCES.find(([p]) => p.endsWith('components/AddActivity.tsx'))?.[1] ?? '';

// Words that are fine in general but must never appear in the CARD's visit list.
const BANNED_IN_VISITS = [
  { word: '· Trip', why: 'A multi-day visit counts as a trip; it is never labelled.' },
  { word: '>Together<', why: '"Together" now means tagging somebody on a card (§0.2).' },
];

describe('the locked card — words that must never come back', () => {
  it('scans the whole app, not a corner of it', () => {
    expect(SOURCES.length).toBeGreaterThan(40);
  });

  for (const { word, why } of BANNED) {
    it(`never says ${word} — ${why}`, () => {
      const offenders: string[] = [];
      for (const [path, source] of SOURCES) {
        for (const line of visibleText(source).split('\n')) {
          // Spotify is a different word that happens to contain one of ours, and
          // `kind: 'spot'` is a value a DATABASE function returns (migration 0081) —
          // never rendered, and not ours to rename from here.
          if (/spotify/i.test(line) || /kind[?]?: '/.test(line)) continue;
          if (word.test(line)) offenders.push(`${path}: ${line.trim()}`);
        }
      }
      expect(offenders, `\n${why}\n${offenders.join('\n')}\n`).toEqual([]);
    });
  }

  for (const { word, why } of BANNED_IN_VISITS) {
    it(`the card never renders "${word}" — ${why}`, () => {
      expect(visibleText(CARD).includes(word)).toBe(false);
    });
  }
});

describe('the locked card — the sections, in the locked order', () => {
  const card = CARD;

  it('is Visits, Photos, Routes, the categories, then Notes and reviews', () => {
    const order = ['Visits{', 'Photos and Videos', '>\n            Routes ', 'NOTES AND REVIEWS'];
    let at = -1;
    for (const marker of order) {
      const next = card.indexOf(marker, at + 1);
      expect(next, `"${marker}" is missing or out of order in the card`).toBeGreaterThan(at);
      at = next;
    }
  });

  it('has no Sections list on a trail — the segment rides on the visit', () => {
    expect(card).not.toMatch(/SECTIONS\{/);
  });

  it('puts the rating UNDER the name, not above it', () => {
    // Asserted in CardCover, where the markup now lives. When this moved out of
    // PlacePanel the guard went red rather than silently passing against a file that no
    // longer contained the thing it was checking — which is the point of it.
    const hero = COVER.indexOf('className="hero-title"');
    expect(hero, 'CardCover has no hero-title').toBeGreaterThan(-1);
    const title = COVER.indexOf('title-with-rating', hero);
    const rating = COVER.indexOf('hero-rating', hero);
    expect(title, 'the name must come before the rating').toBeGreaterThan(-1);
    expect(title, 'the name must come before the rating').toBeLessThan(rating);
  });

  // EVERY CARD HAS A COVER — a photograph, the LETTER of its activity, or a slot that adds
  // one. Until 2026-08-28 the card drew a hero only when there WAS a photo and fell back to
  // a small plain header otherwise, which is what 121 of 166 places got.
  it('has three cover states, and no header that bypasses them', () => {
    expect(COVER, 'the photo state').toMatch(/kind === 'photo'/);
    expect(COVER, 'the letter state').toMatch(/kind === 'letter'/);
    expect(COVER, 'the empty-slot state').toMatch(/kind === 'empty'/);
    // The ternary that produced a coverless card. If it comes back, so does the bug.
    expect(card, 'the card must not render a bare .panel-head instead of a cover').not.toMatch(
      /className="panel-head"/,
    );
    expect(card, 'the card must render the shared cover').toMatch(/<CardCover/);
  });

  it('spells the activity letters the way she named them', () => {
    // "H hike, R run, B biking, W walking". Strava calls biking "Ride", which would
    // collide with Run on first letter alone — hers is the naming that matters here.
    expect(COVER).toMatch(/hike: 'H'/);
    expect(COVER).toMatch(/run: 'R'/);
    expect(COVER).toMatch(/walk: 'W'/);
    expect(COVER).toMatch(/ride: 'B'/);
  });

  it('the letter is text, never an icon', () => {
    // Her standing rule, and the reason a letter is allowed where a pictogram is not.
    expect(COVER).not.toMatch(/<svg|<img[^>]*icon|📷|🏔|🥾/);
  });
});

describe('the household app is gone', () => {
  // `SharedHub` was mounted on Settings until 2026-09-01: "Our apps", a launcher for
  // Wegmans, Total Wine, CellarTracker, Netflix, Spotify, Audible and AnyList, under the
  // line "Tap to open — sign in there with your shared household login."
  //
  // It is the clearest thing in the repo that was NOT a word: a couple's shopping and
  // streaming shortcuts, shipped, on a platform meant to be a social network. No vocabulary
  // scan would ever have found it. Erica, 2026-09-01: delete it.
  it('has no shared-apps launcher', () => {
    for (const [path, src] of SOURCES) {
      expect(src, `${path} must not bring back the household app launcher`).not.toMatch(
        /SharedHub|app-launcher/,
      );
    }
  });
});

describe("nobody joins somebody else's space", () => {
  // Erica, 2026-08-31: "Retire it — tagging is the link. Nobody ever joins someone else's
  // space." 0298 removed the mechanism; this removes the control that still offered it.
  //
  // Settings ▸ Data & Privacy rendered "Approve · Contributor", which called
  // `approve_join_request` and — after 0298 — gave that person their OWN space rather than
  // membership of this one. The control did not do what it said. Nothing could make a
  // request either: there was no request-to-join screen anywhere, so the page offered to
  // approve something nobody could ask for, into a space nobody could join.
  //
  // Guarded because a dead door is exactly the kind of thing that gets restored by someone
  // tidying up an unused import.
  it('offers no way to approve somebody into your space', () => {
    // `database.types.ts` is skipped: it is a GENERATED mirror of the schema, and
    // `approve_join_request` still exists in the database on purpose — 0298 kept it,
    // because it still decides who may hold an account. What is retired is the SURFACE
    // that offered to approve somebody into a space, and a surface is what this scans.
    //
    // COMMENTS STRIPPED, and that is not fussiness either: the first draft failed on the
    // comment in Settings.tsx that EXPLAINS the removal. A guard that reads prose is
    // asserting the wrong thing — the same mistake 0300's own migration made about itself.
    const code = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const [path, src] of SOURCES.filter(([p]) => !p.endsWith('database.types.ts'))) {
      expect(code(src), `${path} must not offer to approve a join request`).not.toMatch(
        /approveJoinRequest|approve_join_request/,
      );
      expect(code(src), `${path} must not read pending join requests`).not.toMatch(
        /fetchPendingJoinRequests/,
      );
    }
  });

  it('has no lib/join.ts left to import', () => {
    const join = SOURCES.find(([p]) => p.endsWith('lib/join.ts'));
    expect(join, 'app/src/lib/join.ts is retired and should be gone').toBeUndefined();
  });
});

describe('adding an activity asks for no title', () => {
  // Erica, 2026-08-31: "I like the view of the card when I click on Virginia Beach, except
  // that to add an activity I have to give it a title."
  //
  // She did not have to. `save()` sends `name: trimmed || null` for a route and
  // `add_activity_to_visit` does `coalesce(p_name, v_opt.label)`, so an unnamed run has
  // always been called "Run". But the field was labelled "Name", its placeholder was the
  // activity's own label — which reads as a value you must replace — and the Miles field
  // directly beneath it said "optional". Every signal on the screen said required.
  //
  // A FIELD THAT IS OPTIONAL AND DOES NOT SAY SO IS A FIELD THAT IS REQUIRED. Guarded
  // here rather than with a live check because the control sits inside an expanded visit
  // row behind a `.kind-select` class five other selects share — a browser check on it
  // would be testing the locator, not the promise.
  it('says the name is optional, and what it will be called instead', () => {
    expect(ADD_ACTIVITY.length, 'AddActivity.tsx should be readable').toBeGreaterThan(500);
    // The route branch of the placeholder must offer the word, and must say what happens.
    expect(ADD_ACTIVITY, 'the activity name placeholder must say it is optional').toMatch(
      // Deliberately loose between the two: the sentence between them is copy and will be
      // edited. What must hold is that the word "optional" and the fallback name travel
      // together — the first draft of this regex excluded quotes and broke on "we'll".
      /optional[\s\S]{0,60}\$\{picked\.label\}/,
    );
  });

  it('still requires a name for a PLACE, which becomes a card of its own', () => {
    // The other half of the same rule, and the reason this is not simply "make it
    // optional everywhere": a restaurant added to a visit gets a card, and "Restaurant"
    // is not a name for it.
    expect(ADD_ACTIVITY, 'a place must still be named').toMatch(
      /picked\.kind === 'place' && !trimmed/,
    );
  });
});

describe('a multi-day visit IS a trip', () => {
  // §0.4: a visit counts as a trip when it is MULTI-DAY or someone marked it. The
  // rows used to read the raw `is_trip` column, which only ever means "someone
  // marked it" — so a week away nobody thought to mark did not read as a trip.
  // Approved 2026-08-14; on the live data this moved 46 visits into the trip
  // reading (9 marked, 55 qualifying).
  it('decides from counts_as_trip, not from the marked flag alone', () => {
    expect(CARD, 'the row must ask isTrip(), which reads is_trip_qualified').toMatch(
      /trip:\s*isTrip\(v\)/,
    );
    expect(CARD, 'the raw marked column must not decide the row on its own').not.toMatch(
      /trip:\s*v\.is_trip\b/,
    );
  });
});

describe('merging is offered, never a mode', () => {
  // Approved 2026-08-14: "Offered when they look like one stay" — a quiet line between
  // two visits whose dates touch, NOT checkboxes and a Select mode. The visit list
  // stays one-tap-to-edit, which is the thing Erica asked for in the first place.
  it('offers the merge in her words', () => {
    expect(CARD).toMatch(/These look like one stay/);
  });

  it('asks once, with what moves, before merging anything', () => {
    expect(CARD, 'it must confirm rather than merge on the first tap').toMatch(
      /Make these one visit/,
    );
    expect(CARD).toMatch(/move across/);
  });

  it('has no select mode on the visit list', () => {
    // Not a blanket "no checkboxes" rule — the members picker legitimately uses one.
    // What must not exist is a Select mode over the VISIT rows, which would stop them
    // being one-tap-to-edit.
    expect(CARD).not.toMatch(/Merge \d+ visits/);
    expect(CARD).not.toMatch(/selectedVisits|visitSelectMode/);
  });

  it('only offers it for two visits at the SAME place', () => {
    // merge_visits refuses across places; the card must not offer what the database
    // will reject — a trail and one of its sections sit in the same list.
    expect(CARD).toMatch(/later\.placeId !== earlier\.placeId/);
  });
});

describe('the card holds your edits until you save', () => {
  // Approved 2026-08-14. Erica asked for the same thing twice — for the photo sorter
  // ("if I save it they are added but if I don't they are discarded") and for the card.
  // The second half is the point: an edit is ALSO an approval, so saving is the moment
  // automation loses the right to change that field. That was true for months and the
  // card never said it.
  it('has a Save and a Discard', () => {
    expect(CARD).toMatch(/>\s*\{saving \? 'Saving…' : 'Save'\}\s*</);
    expect(CARD).toMatch(/Discard/);
  });

  it('says what the save froze, in her words', () => {
    expect(CARD).toMatch(/the app will not change/);
    expect(CARD, 'it must name the fields rather than say "changes saved"').toMatch(
      /justFroze\.join/,
    );
  });

  it('shows that something is waiting', () => {
    expect(CARD).toMatch(/edited/);
  });

  it('does not write the name, rating or dates as you type', () => {
    // Each must be STAGED into the draft. If one of these goes back to awaiting an RPC
    // directly, the card has quietly returned to save-as-you-type.
    const staged = CARD.match(/setDraft\(/g) ?? [];
    expect(staged.length, 'name, rating and dates all stage into the draft').toBeGreaterThan(3);
    // Staging ON BLUR is fine — saveName no longer writes, it only stages. What must
    // not happen is a field calling its RPC outside saveCard().
    const writesOutsideSave = /function saveName\(\)[\s\S]*?\n {2}\}/.exec(CARD)?.[0] ?? '';
    expect(writesOutsideSave).not.toMatch(/await setPlaceName/);
  });

  it('keeps what you typed when a save fails', () => {
    // Throwing away the draft because the network blinked is the worst answer.
    expect(CARD).toMatch(/The draft is KEPT on failure/);
  });
});

describe('the blank card asks the trail question once', () => {
  // §0.6: the blank card is the same card with the fields empty, plus ONE extra
  // question asked "once, here only" — "Is this a trail with sections?". It was the
  // last unbuilt line on the card list. A trail is the one kind of place you cannot
  // tell from where someone tapped: it is a container whose SECTIONS are the places
  // that count, so nothing else on the card means the same once the answer is yes.
  it('asks it, in the words of the plan', () => {
    expect(BLANK).toMatch(/Is this a trail with sections\?/);
  });

  // Erica, 2026-08-28: "I DO want the trail toggle to label a trail, and the is this part
  // of a trail question deleted." Two trail questions three rows apart asked one person two
  // different things about trails. The toggle is the one that labels; the parent picker is
  // gone, and a new place joins a trail from the trail's own card instead.
  it('does not also ask "Part of a trail?"', () => {
    // visibleText, not the raw source: the comment recording WHY it went names the
    // question, and a guard that its own explanation trips is a guard nobody keeps.
    expect(visibleText(BLANK), 'the parent picker was deleted on 2026-08-28').not.toMatch(
      /Part of a trail/i,
    );
    // REWRITTEN 2026-08-30. It used to forbid `part_of:` outright, which said the same
    // thing while the card could only write one: its own parent. The card now stages
    // RESTAURANTS, and a restaurant review is a place grouped under the place being
    // created — `part_of: [placeId]`, the saved card's own `addNote` — so the blunt
    // version would fail on the feature rather than on the picker. What must not come
    // back is a part_of on the place THIS CARD IS CREATING, which is the parent picker.
    const parents = [...visibleText(BLANK).matchAll(/part_of:\s*([^,\n]+)/g)].map((m) =>
      m[1].trim(),
    );
    expect(parents, 'the only part_of on this card groups a staged review').toEqual(['[placeId]']);
  });

  it('asks it ONCE — the tag list must not ask the same thing again', () => {
    // Being a trail IS carrying the `trail` tag. If Trail is also offered in "+ tag"
    // there are two controls for one fact sitting on the same screen, which is the
    // shape of bug this codebase keeps having.
    expect(BLANK).toMatch(/NOT_A_TAG = new Set\(\[[^\]]*'trail'/);
  });

  it('does not keep a second copy of the answer', () => {
    // The question reads and writes the tag. A `useState` boolean beside the tag would
    // be the copy, and the copy is what goes stale.
    expect(BLANK).toMatch(/const isTrail = tags\.includes\('trail'\)/);
    expect(BLANK).not.toMatch(/useState(<boolean>)?\((true|false)\); *\/\/ *is ?trail/i);
  });

  it('lets a trail exist before it has been walked', () => {
    // A trail you have not walked yet is a normal thing to record. The date can still
    // be cleared, and with no date no visit is logged — which is exactly what the plan
    // says: "create a first visit only when the user supplies an outing date".
    //
    // The label lost "(optional)" on 2026-08-30, when the field started arriving
    // filled in with today's date (Erica: "The date should always be pre-filled to the
    // date I am adding the card"). Calling a pre-filled field optional described the
    // old empty one.
    expect(BLANK).toMatch(/<span>\{isTrail \? 'Date you walked it' : 'Date'\}<\/span>/);
    // REWRITTEN 2026-08-30. The literal it used to match — `visitDate && !files.length ?
    // { date: visitDate` — spelled the WHOLE rule out inline, and the rule gained a
    // clause when Routes and Restaurants became fillable: a staged route hangs off a
    // visit id, so a card holding one asks for the visit outright. The decision moved
    // into `needsVisitRow`, which is a pure function and is tested for real in
    // draftStaging.test.ts, including the case this check is named after.
    expect(BLANK, 'the card must ask, not decide inline').toMatch(
      /const logsAVisit = needsVisitRow\(\{/,
    );
    expect(BLANK).toMatch(/logsAVisit \? \{ date: visitDate/);
  });

  it('offers the reference route, and draws it the one existing way', () => {
    expect(BLANK).toMatch(/Draw it after saving/);
    // Handed back to the caller rather than drawn inside the modal, so a trail's route
    // is drawn by the same draw mode the trail card uses. Two drawing surfaces would
    // be two ways to make the same thing.
    expect(BLANK).toMatch(/onSaved\(placeId, isTrail && drawAfter/);
  });
});

// THE BLANK CARD IS THE CARD WITH ITS FIELDS EMPTY. §"THE CARD — LOCKED":
// "The blank (new) card is the same card with the fields empty... Its Visits section says
// 'this is visit one', because saving a new place IS its first visit. Routes and
// Restaurants say 'Added once this first visit is saved'."
//
// It was a dialog of label-and-input rows until 2026-08-28, with no sections at all — and
// STATE.md ticked it as done for thirteen days, naming a component (AddSheet) that no
// longer existed. These are the checks that tick now has to survive.
// THE VISIT CARD IS THE CARD, OPENED AT A VISIT.
//
// Erica, 2026-08-11, in capitals: "EACH VISIT SHOULD OPEN TO A CARD. THE CARD SHOULD LOOK
// EXACTLY LIKE SAN DIEGO DOES NOW" — and "EVERY SECTION SHOULD LOOK EXACTLY THE SAME when
// a user clicks on a visit, only the activities and routes should be specific to the dates
// of that single visit."
//
// It was a separate page until 2026-08-28, and STATE.md ticked it as built for thirteen days.
describe('the visit card is the card, opened at a visit', () => {
  const VISIT = SOURCES.find(([p]) => p.endsWith('routes/VisitPage.tsx'))?.[1] ?? '';

  it('is a .panel, not a page', () => {
    expect(VISIT).toMatch(/className="panel visit-card"/);
    // The chrome that made it a different screen. A back-bar inside the card offers a way
    // out of the thing you are looking at, and the h1 repeated what the sub-line says.
    expect(VISIT, 'the back-bar belonged to the page it stopped being').not.toMatch(
      /className="page visit-page"/,
    );
    expect(VISIT, 'no h1 — the name over the cover is the title').not.toMatch(/<h1>/);
  });

  it('opens with the same cover component as the other two', () => {
    expect(VISIT).toMatch(/<CardCover/);
    expect(VISIT).toMatch(/from '\.\.\/components\/CardCover'/);
  });

  it('has the locked sections, scoped to this visit', () => {
    const order = ['visits-summary', 'Photos and Videos', 'Routes ', 'NOTES AND REVIEWS'];
    let at = -1;
    for (const marker of order) {
      const next = VISIT.indexOf(marker, at + 1);
      expect(next, `"${marker}" is missing or out of order on the visit card`).toBeGreaterThan(at);
      at = next;
    }
    // "What we did" was its own heading. A hike, a ride, a walk and a run ARE routes.
    expect(visibleText(VISIT), '"What we did" is not a section on the locked card').not.toMatch(
      /What we did/,
    );
  });

  it("draws its Visits list with the destination card's own markup", () => {
    // Identical classes, or the two sections look different while claiming to be the same.
    expect(VISIT).toMatch(/details className="visits-details"/);
    expect(VISIT).toMatch(/summary className="visits-summary"/);
    expect(VISIT).toMatch(/details key=\{y\} className="visit-year"/);
    expect(VISIT).toMatch(/summary className="visit-year-head"/);
    expect(VISIT).toMatch(/span className="visit-year-n"/);
  });

  it('uses the two locked date formats, and no third one', () => {
    expect(VISIT).toMatch(/visitDates\(/);
    // It rendered "August 2 – 7, 2026" of its own.
    expect(VISIT, 'fmtSpan was a third date format').not.toMatch(/function fmtSpan/);
  });

  it('says each section is scoped to this visit', () => {
    expect(VISIT).toMatch(/this visit/);
  });
});

describe('the blank card is the card with its fields empty', () => {
  it("is a .panel, so it wears the card's own stylesheet", () => {
    // The single most load-bearing line: the uppercase blue-rule headings, the pills and
    // the cover are all `.panel` rules. A blank card that is not a panel is a form.
    expect(BLANK).toMatch(/className="panel npd-card"/);
  });

  it('opens with the cover, the name over it, and the rating under the name', () => {
    expect(BLANK).toMatch(/<CardCover/);
    expect(BLANK).toMatch(/Name this place/);
    expect(BLANK).toMatch(/Add a cover photo/);
    // The same component as the saved card, not a second one that looks like it.
    expect(BLANK).toMatch(/from '\.\/CardCover'/);
  });

  it('has the five sections, in the locked order, saying what will fill them', () => {
    const order = ['Visits ', 'Photos and Videos', 'Routes', 'Restaurants', 'NOTES AND REVIEWS'];
    let at = -1;
    for (const marker of order) {
      const next = BLANK.indexOf(marker, at + 1);
      expect(next, `"${marker}" is missing or out of order on the blank card`).toBeGreaterThan(at);
      at = next;
    }
  });

  it('says "this is visit one", because saving a place IS its first visit', () => {
    expect(BLANK).toMatch(/this is visit one/);
  });

  // REWRITTEN 2026-08-30 under rule 4 of app/e2e/erica-asked-for.spec.ts, and it is a
  // RULING rather than a drift.
  //
  //   WAS (2026-08-11 preview): Routes and Restaurants read "Added once this first
  //                             visit is saved", because an activity attaches to a
  //                             VISIT and a blank card has no visit until Save.
  //   IS  (2026-08-30): Erica — "I also think Add should lead to a card where I can add
  //                     an activity, restaurant, notes, etc — it should be fully
  //                     editable." STATE.md had carried this as an OPEN question needing
  //                     her since 2026-08-12. She answered it.
  //
  // The waiting words survive where they are still TRUE — somewhere to go later has no
  // visit, and neither does a card whose date has been cleared — so this checks the
  // fillable controls AND the honest fallback.
  it('lets you add a route, a restaurant and a note before the place exists', () => {
    expect(BLANK, 'the Routes section takes a route').toMatch(/only="route"/);
    expect(BLANK, 'the Restaurants section takes a restaurant').toMatch(/only="place"/);
    expect(BLANK, "and the note form is the saved card's own").toMatch(/<EntryEditor/);
    expect(BLANK).toMatch(/from '\.\/AddActivity'/);
    expect(BLANK).toMatch(/from '\.\/EntryEditor'/);
  });

  it('says what Routes and Restaurants are waiting for when there is no visit', () => {
    expect(BLANK).toMatch(/a route or a restaurant belongs to a visit/);
    expect(BLANK).toMatch(/Somewhere to go later has no visit yet/);
  });

  it('stages them — none of the three is written before Save', () => {
    // The whole promise, checked mechanically: every call that writes must sit inside
    // `save()` or `addToExisting()`. If a staging handler ever calls one directly, a
    // cancelled draft starts leaving rows behind and this goes red.
    const WRITES = [
      'addExperience(',
      'updatePlace(',
      'setPlaceSolo(',
      'uploadPhoto(',
      'createEntry(',
      'createPlaceAtomic(',
      'addActivityToVisit(',
      'addPlaceToVisit(',
      'writeStaged(',
    ];
    /** The [start, end) of a function body, by brace matching from its header. */
    function body(header: string): [number, number] {
      const at = BLANK.indexOf(header);
      expect(at, `${header} is missing from the blank card`).toBeGreaterThan(-1);
      const i = BLANK.indexOf('{', at);
      let depth = 0;
      for (let j = i; j < BLANK.length; j++) {
        if (BLANK[j] === '{') depth++;
        else if (BLANK[j] === '}' && --depth === 0) return [at, j + 1];
      }
      throw new Error(`unbalanced braces after ${header}`);
    }
    // `stagingWriters` NAMES the writes; it does not perform them — it is the object
    // `writeStaged` is handed, and `writeStaged` is only called from the two below.
    const allowed = [
      body('async function save()'),
      body('async function addToExisting('),
      body('function stagingWriters('),
    ];
    const strays: string[] = [];
    for (const call of WRITES) {
      for (let at = BLANK.indexOf(call); at !== -1; at = BLANK.indexOf(call, at + 1)) {
        const line = BLANK.slice(BLANK.lastIndexOf('\n', at) + 1, BLANK.indexOf('\n', at));
        // The import list and the comments that explain the rule are not calls.
        if (/^\s*(\/\/|\*|import\b)/.test(line) || /^\s{2}[a-zA-Z]+,$/.test(line)) continue;
        if (!allowed.some(([s0, e0]) => at >= s0 && at < e0)) strays.push(line.trim());
      }
    }
    expect(strays, `a write outside Save:\n${strays.join('\n')}`).toEqual([]);
  });

  it('offers the categories as PILLS, not a dropdown', () => {
    expect(BLANK).toMatch(/cat-pill/);
    expect(visibleText(BLANK), 'the "+ tag" select is gone').not.toMatch(/\+ tag/);
  });

  it('its footer is Save and Cancel', () => {
    expect(BLANK).toMatch(/npd-footer/);
    expect(visibleText(BLANK)).toMatch(/Cancel/);
  });

  it('nothing is written until Save', () => {
    // Every field stages into local state. If one starts calling its RPC on change, the
    // blank card has quietly become save-as-you-type and a discarded draft leaves rows.
    expect(BLANK).toMatch(/const \[rating, setRating\] = useState/);
    expect(BLANK, 'the rating is applied WITH the save, not as you tap').toMatch(
      /if \(rating != null\) extra\.rating = rating;/,
    );
  });
});

describe('adding a visit asks for both dates', () => {
  // Erica, 2026-08-15, having opened a real card: "I opened a card to add a visit and
  // it doesn't look like the one I finalized and asked not to be changed again. There
  // should be the option to pick a start date and an end date."
  //
  // She was right on both counts. The button said "Log another visit" where §0.6 locks
  // "Add another visit", and the END DATE WAS HIDDEN behind a "Multiple days" checkbox —
  // so the form opened with one field, and a Friday-to-Sunday stay could not be entered
  // without first finding a tickbox that did not look like part of the question.
  it('uses the locked words', () => {
    expect(CARD).toMatch(/Add another visit/);
    expect(CARD, 'the plan says "Add another visit", not "Log"').not.toMatch(
      /Log a(nother)? visit/,
    );
  });

  it('shows both dates without a checkbox to find first', () => {
    expect(CARD).toMatch(/>From</);
    expect(CARD).toMatch(/>To</);
    // The checkbox that used to gate the second field.
    expect(CARD).not.toMatch(/Multiple days/);
    expect(CARD).not.toMatch(/vMulti/);
  });

  it('still treats one date as one day', () => {
    // Both fields visible must not mean every visit becomes a range: leaving them equal
    // is a single day, and an end before the start is a slip rather than an intent.
    expect(CARD).toMatch(/vEnd && vEnd >= vStart \? vEnd : vStart/);
  });

  it('does not lecture about trips under the dates', () => {
    // Removed at Erica's word, 2026-08-15. The rule is real — a visit over more than
    // one day counts as a trip — but the card is not the place to say it, and she has
    // asked repeatedly for the word "Trip" to stay out of the Visits section.
    expect(CARD).not.toMatch(/counts as a trip/);
  });
});

describe('the card asks the model, not the leftover column', () => {
  // §0.4 decides what a trip is: MULTI-DAY or someone marked it. card_view answers
  // that as is_trip_qualified. The card used to write `qualifiedTrips.has(v.id) ||
  // !!v.is_trip`, which looked like a safety net and was not one — a trigger keeps
  // visits.is_trip identical to trip_marked, so the second half could only ever repeat
  // what the first had already said, while making the raw column look load-bearing.
  //
  // The column is on its way out (§8). This keeps the card from reaching for it again
  // in the meantime.
  it('decides a trip from the card view alone', () => {
    expect(CARD).toMatch(/const isTrip = \(v: Visit\) => qualifiedTrips\.has\(v\.id\);/);
    expect(CARD, 'no falling back to the raw column').not.toMatch(/\|\|\s*!!v\.is_trip/);
  });
});

describe('the screens Erica asked for on 2026-08-15', () => {
  const PLACES = SOURCES.find(([p]) => p.endsWith('routes/PlacesList.tsx'))?.[1] ?? '';
  const TIMELINE = SOURCES.find(([p]) => p.endsWith('routes/Timeline.tsx'))?.[1] ?? '';
  const MAP = SOURCES.find(([p]) => p.endsWith('routes/MapView.tsx'))?.[1] ?? '';
  const NAV = SOURCES.find(([p]) => p.endsWith('components/PrimaryNav.tsx'))?.[1] ?? '';

  it('Places has no stats bar — which is also what removes the gear', () => {
    // ONE change, TWO complaints: the settings gear (.gear-btn) is rendered INSIDE
    // StatsBar, so anything showing the bar shows the gear. Do not look for a separate
    // gear on this page.
    // Match the IMPORT and the ELEMENT, not the word: the comment left in that file
    // explains why the bar is gone and mentions it by name. A blunt word match fails on
    // its own explanation — which is the second time today that shape of guard bit.
    expect(PLACES).not.toMatch(/from '\.\.\/components\/StatsBar'/);
    expect(PLACES).not.toMatch(/<StatsBar/);
  });

  it('the timeline folds year, then month, then days', () => {
    // "the user should see the year, and when clicked that should show the months, then
    // when clicked the days". It used to open every month of every year at once.
    expect(TIMELINE).toMatch(/openYears/);
    expect(TIMELINE).toMatch(/openMonths/);
    expect(TIMELINE).toMatch(/d\.date\.slice\(0, 4\)/);
  });

  it('Add opens the blank card, not a chooser', () => {
    // §0.6 has said this since 2026-08-11 — "ADD opens a FILLABLE CARD, not a chooser" —
    // while the code opened AddSheet. The decision and the code disagreed for four days.
    expect(MAP).not.toMatch(/<AddSheet/);
    expect(MAP).toMatch(/wantsCard/);
    expect(NAV).toMatch(/to: '\/\?add=1'/);
  });
});
