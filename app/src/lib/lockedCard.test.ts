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
];

const CARD = SOURCES.find(([p]) => p.endsWith('components/PlacePanel.tsx'))?.[1] ?? '';
const BLANK = SOURCES.find(([p]) => p.endsWith('components/NewPlaceDraft.tsx'))?.[1] ?? '';

// Words that are fine in general but must never appear in the CARD's visit list.
const BANNED_IN_VISITS = [
  { word: '· Trip', why: 'A multi-day visit counts as a trip; it is never labelled.' },
  { word: '>Together<', why: '"Together" now means tagging someone in a flok.' },
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
    const hero = card.indexOf('className="hero-title"');
    expect(hero).toBeGreaterThan(-1);
    const title = card.indexOf('title-with-rating', hero);
    const rating = card.indexOf('hero-rating', hero);
    expect(title, 'the name must come before the rating').toBeLessThan(rating);
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
    // A trail you have not walked yet is a normal thing to record. The date is
    // therefore optional, and with no date no visit is logged — which is exactly what
    // the plan says: "create a first visit only when the user supplies an outing date".
    expect(BLANK).toMatch(/Date you walked it \(optional\)/);
  });

  it('offers the reference route, and draws it the one existing way', () => {
    expect(BLANK).toMatch(/Draw it after saving/);
    // Handed back to the caller rather than drawn inside the modal, so a trail's route
    // is drawn by the same draw mode the trail card uses. Two drawing surfaces would
    // be two ways to make the same thing.
    expect(BLANK).toMatch(/onSaved\(placeId, isTrail && drawAfter/);
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
