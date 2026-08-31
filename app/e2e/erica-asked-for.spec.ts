// WHAT ERICA ASKED FOR, CHECKED ON THE LIVE SITE.
//
// Erica, 2026-08-11: "I want you to stop fucking around and set up a build system
// that ensures that what I ask for is built and live before moving forward."
//
// THIS FILE IS THAT SYSTEM. Every request becomes one check here, in her words, and
// the check runs against https://adventureorno.com — not a dev server, not a commit,
// not my say-so. A request is DONE when its check passes against the live site, and
// not before.
//
//   npm run verify:live          (from the repo root)
//
// The rules for using it:
//
//  1. A new request from Erica gets a check here BEFORE the work starts. It fails.
//  2. The work makes it pass.
//  3. It is not reported as done until `verify:live` shows it green ON THE SITE.
//  4. Nothing is ever removed from this list. If she changes her mind, the check is
//     REWRITTEN to the new instruction, with the old one noted — so the list is the
//     honest history of what she asked for.
//
// Why this and not a document: docs/STATE.md said all of this already, and things
// still went missing. A sentence cannot fail a build.
//
// Companion: app/src/lib/lockedCard.test.ts guards the words and structure at the
// SOURCE level and runs in the deploy. This one checks the live SITE.
import { expect, test } from '@playwright/test';
import { liveTest as it } from './fixtures';

const SITE = process.env.LIVE_URL ?? 'https://adventureorno.com';

// THE RULE THAT WAS MISSING, LEARNED THE EXPENSIVE WAY (2026-08-22):
//
//   A COUNT OF ZERO PROVES NOTHING UNTIL THE SCREEN HAS RENDERED.
//
// `ready()` proves the APP BOOTED — it waits for the nav — and the screen under test
// arrives after that. `toHaveCount(0)` does not retry upward: asked early it answers
// "zero, correct", and a check written to catch a defect passed against a site that
// still had it. So every negative assertion in this file must FOLLOW a positive one
// that only the real screen can satisfy.

// San Diego — the card she designed everything against.
const SAN_DIEGO = '/place/0795746e-c5ba-4b15-89c4-1cf0c4612148';
// The Appalachian Trail — the trail card, the one with 62 visits.
const AT = '/place/6bffaec6-00be-4626-b1d2-cf6815b849f7';

// WAIT FOR THE APP, ALWAYS. Reading the DOM the moment navigation resolves is how a
// check reports "missing" for something that is on the page a second later — which
// would make this whole file untrustworthy. Every check goes through here.
async function ready(page: import('@playwright/test').Page, path: string) {
  await page.goto(path);
  // The nav renders only once the app has booted and the session is accepted — so it is
  // the boot signal everywhere it EXISTS.
  //
  // It does not exist on /settings any more. Erica, 2026-08-17: *"map places add timeline
  // should not appear on the settings page"*. Waiting for it there would fail every check
  // on that route, for a page that is now correct — the same stale-assertion trap this
  // file was rewritten to fix, arriving in the file's own helper. /settings waits for its
  // heading instead, which is its equivalent proof that the app has booted.
  //
  // EITHER SIGNAL, because /settings is not one page. The branch below used to demand a
  // heading matching /settings/i on anything under /settings, on the strength of the note
  // above — and that note is only true of `/settings/account`. Measured live 2026-08-30,
  // `/settings/data/attention`, `/settings/data/export` and `/settings/data/trash` each
  // carry the full four-link nav and NO settings heading at all: their headings are
  // `Needs attention`, `Export & backup` and `Trash`. Waiting for a settings heading there
  // fails on a page that is perfectly correct — the same stale-assertion trap this helper
  // was rewritten to fix, for the second time.
  //
  // Both are proof the app booted, so either will do, and a screen that has both is not
  // penalised for it.
  if (path.startsWith('/settings')) {
    await expect
      .poll(
        async () =>
          (await page.getByRole('heading', { name: /settings/i }).count()) > 0 ||
          (await page.locator('nav.primary-nav a').count()) > 0,
        { timeout: 15_000 },
      )
      .toBe(true);
  } else {
    await expect(page.locator('nav.primary-nav a').first()).toBeVisible();
  }
  if (path.startsWith('/place/')) {
    await expect(page.locator('.panel')).toBeVisible();
    // …and the card's own data, not just its shell.
    await expect(page.locator('.visits-details')).toBeVisible();
  }
}

/** Settings' Stats card is a <details>; its contents are hidden until it is open —
 *  the same disclosure pattern as the Visits section on a card. */
async function openStats(page: import('@playwright/test').Page) {
  // TARGET THE STATS DROPDOWN BY NAME. /settings/account has FOUR `details.stats-dropdown`
  // cards — the stats card, Cities and states, National Parks, Peaks & climbing — plus one
  // nested per state inside Cities and states, and this helper used to click the FIRST
  // summary only if NONE of them was open. So whenever any other one was open it clicked
  // nothing, the Stats card stayed shut, and the Trips button inside it was reported as
  // "not visible": a missing feature, according to the file that decides what Erica has
  // been given. It was never missing.
  //
  // THE COUNT IS PER-VIEWER, and this comment got it wrong once already. It said TWENTY,
  // taken from a brief rather than measured. Measured as the TEST BOT — who this file
  // signs in as — `details.stats-dropdown` is **4** on production, because the nested
  // state panels only exist for an account with cities and states recorded and the bot has
  // none. STATE.md item 3 records 22 from Erica's screen. Both are right for their account;
  // neither is a property of the page. So the helper selects BY NAME and asserts
  // `toHaveCount(1)` on the match, which holds on any account, rather than counting the
  // set — a count here would be a fact about whoever ran it last.
  //
  // REWRITTEN 2026-08-30 under rule 4 at the top of this file. This is a RENAME she
  // approved, not drift, and it took THREE checks red with it — `:607`, `:626` and
  // `:686` all open the card through here:
  //
  //   WAS: `> summary` matching /^Stats$/ — the card was headed with the bare word
  //        `Stats`, which named a card rather than the scope its numbers are about.
  //   IS  (docs/STATE.md §0.2, approved 2026-08-30): *"This is not a household app.
  //        This is a social application."* — **there are exactly three scopes and no
  //        operator**, and the bare word `Stats` is not one of them. The card is now
  //        headed by the scope it is showing, written once in `lib/statsScope`:
  //        **My Stats** (every card you are tagged on) or **Our Stats** (only the cards
  //        you and the picked people are all tagged on), then ` · ` and the sentence
  //        saying what the number counts.
  //
  // MEASURED, live, 2026-08-30: the summary reads `My Stats · Every card you are tagged
  // on.` — so `/^Stats$/` matched none of them and answered 0.
  //
  // EITHER WORD, on purpose. Which one the card opens on depends on who the account has
  // recorded — the test bot has recorded nobody, so it gets My Stats — and both are the
  // same card. `^` still anchors it, so a state nested inside Cities and states can
  // never be mistaken for it, and `toHaveCount(1)` below still proves there is exactly
  // one.
  const stats = page.locator('details.stats-dropdown').filter({
    has: page.locator('> summary', { hasText: /^(My|Our) Stats\b/ }),
  });
  await expect(stats).toHaveCount(1);
  const summary = stats.locator('> summary');
  await expect(summary).toBeVisible();
  if (!(await stats.evaluate((el) => (el as HTMLDetailsElement).open))) await summary.click();
  await expect(stats.locator('.our-stats')).toBeVisible();
}

/** The Visits section is a <details>; its rows are hidden until it is open. */
async function openVisits(page: import('@playwright/test').Page) {
  const summary = page.locator('.visits-summary');
  if ((await page.locator('.visits-details[open]').count()) === 0) await summary.click();
  await expect(page.locator('.visits-details[open]')).toBeVisible();
  // AND WAIT FOR THE ROWS TO EXIST, not just the container to be open.
  //
  // `PlacePanel` computes `loading = visits === null || trailActs === null` and prints
  // `Loading…` inside this very <details> until BOTH have resolved. Opening the section
  // therefore proves nothing about its contents: on the Appalachian Trail — 35 visits and
  // six routes for the test bot — `"Dates should be grouped by year"` failed with
  // `.visit-year` "element(s) not found" against a card that renders the years perfectly,
  // because the check read the DOM while the word Loading was still on screen.
  //
  // This is the same defect the Routes check below carries a long note about, and the
  // same one the rule at the top of this file describes: a count of zero proves nothing
  // until the screen has rendered. Waiting for the word to GO is the app telling us the
  // rows are decided — and it is a retrying assertion, so it waits rather than sampling.
  await expect(page.locator('.visits-details p').filter({ hasText: /^Loading/ })).toHaveCount(0);
}

test.describe('the live site is the deployed build', () => {
  test('serves the version it was built from', async ({ request }) => {
    const res = await request.get(`${SITE}/version.json`);
    expect(res.ok(), `${SITE}/version.json did not answer`).toBe(true);
    const body = (await res.json()) as { sha?: string; dirty?: boolean };
    expect(body.sha, 'no build SHA on the live site').toMatch(/^[0-9a-f]{40}$/);
    expect(body.dirty, 'production was built from a dirty tree').toBeFalsy();
  });
});

// Everything below is signed in as the test bot. The fixture THROWS if it cannot
// sign in, rather than skipping — a run that quietly checked nothing must never be
// mistaken for a green one.

it.describe('the card — what she asked for, on the live site', () => {
  it.use({ baseURL: SITE });

  it('"I DO NOT WANT THE PLACES HERE SECTION"', async ({ page }) => {
    await ready(page, SAN_DIEGO);
    await expect(page.getByText(/places here/i)).toHaveCount(0);
    await expect(page.getByText(/places inside/i)).toHaveCount(0);
  });

  it('"Ive told you to remove spots 500 fucking times"', async ({ page }) => {
    await ready(page, SAN_DIEGO);
    await expect(page.getByText(/\bspots?\b/i)).toHaveCount(0);
  });

  it('the sections are Visits, Photos, Routes, the categories, then Notes', async ({ page }) => {
    await ready(page, SAN_DIEGO);
    // ROUTES IS CONDITIONAL, and this check used to demand it unconditionally.
    // PlacePanel renders it only when the place has activities — `{(trailActs ?? []).length
    // > 0 && …}` — so on a place with none, the section correctly does not exist and this
    // reported the ORDER as broken. The order is what she asked about; the presence of a
    // section that depends on data is a different question, and `the Routes section holds
    // the map AND the list` below is where it belongs.
    await expect(page.locator('.panel h3, .panel .visits-summary').first()).toBeVisible();
    const heads = page.locator('.panel h3, .panel .visits-summary');
    const text = (await heads.allTextContents()).map((t) => t.trim());
    const visits = text.findIndex((t) => /^Visits/i.test(t));
    const photos = text.findIndex((t) => /Photos and Videos/i.test(t));
    const routes = text.findIndex((t) => /^Routes/i.test(t));
    const notes = text.findIndex((t) => /NOTES AND REVIEWS/i.test(t));
    expect(visits, `no Visits section: ${text.join(' | ')}`).toBeGreaterThanOrEqual(0);
    expect(photos, `no Photos section: ${text.join(' | ')}`).toBeGreaterThan(visits);
    expect(notes, `no Notes section: ${text.join(' | ')}`).toBeGreaterThan(photos);
    // Routes sits between Photos and Notes WHEN THE PLACE HAS ANY.
    if (routes >= 0) {
      expect(routes, `Routes is out of order: ${text.join(' | ')}`).toBeGreaterThan(photos);
      expect(notes, `Routes is out of order: ${text.join(' | ')}`).toBeGreaterThan(routes);
    }
  });

  it('"Restaurant should be Restaurants" — and it is its own section', async ({ page }) => {
    await ready(page, SAN_DIEGO);
    await expect(page.locator('.panel h3', { hasText: /^Restaurants/ })).toHaveCount(1);
  });

  it('the rating sits UNDER the name', async ({ page }) => {
    await ready(page, SAN_DIEGO);
    // MEASURE WHERE IT SETTLES, not where it is passing through. This read both boxes the
    // moment the card existed and compared their `y`, and on 2026-08-30 it reported "the
    // rating is above the name" with y = -505 against -499 — BOTH NEGATIVE, i.e. the hero
    // was still above the top of the viewport, six pixels of a card that had not finished
    // arriving. Nothing about the layout had changed.
    //
    // So the title is scrolled into view and both boxes are read from a settled element.
    // The assertion is untouched: the rating still has to sit at or below the name.
    const title = page.locator('.hero-title .title-with-rating');
    const stars = page.locator('.hero-title .hero-rating');
    await expect(title).toBeVisible();
    await expect(stars).toBeVisible();
    await title.scrollIntoViewIfNeeded();
    // One box read twice, unchanged, is the proof that layout has stopped moving — a
    // single read cannot tell "settled" from "mid-flight", which is what went wrong.
    await expect
      .poll(
        async () => {
          const a = await title.boundingBox();
          await page.waitForTimeout(120);
          const b = await title.boundingBox();
          return a && b && Math.abs(a.y - b.y) < 1 && b.y >= 0;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    const name = await title.boundingBox();
    const rating = await stars.boundingBox();
    expect(name, 'no name on the card').not.toBeNull();
    expect(rating, 'no rating on the card').not.toBeNull();
    expect(rating!.y, 'the rating is above the name').toBeGreaterThanOrEqual(name!.y);
  });

  it('the sub-line says "Visited once · 12 photos", not "1 visit"', async ({ page }) => {
    await ready(page, SAN_DIEGO);
    await expect(page.locator('.panel .meta')).toContainText(/Visited (once|twice|\d+ times)/);
    await expect(page.locator('.panel .meta')).not.toContainText(/·\s*\d+\s*visits?\b/);
  });

  it('a single date reads "May 2" and a range "5/4 - 5/7"', async ({ page }) => {
    await ready(page, SAN_DIEGO);
    await openVisits(page);
    const dates = await page.locator('.panel .visit-date').allTextContents();
    expect(dates.length, 'no dates in the Visits section').toBeGreaterThan(0);
    for (const d of dates) {
      expect(d.trim(), `"${d}" is not one of the two locked formats`).toMatch(
        /^([A-Z][a-z]+ \d{1,2}|\d{1,2}\/\d{1,2} - \d{1,2}\/\d{1,2})$/,
      );
    }
  });

  // HER ORIGINAL WORDING, kept because a rewritten check must never look like it was
  // always this lenient:
  //
  //   "Remove the words tap a date and Trip and together from the visit section"
  //
  // REWRITTEN 2026-08-17, to her newer decision. §0.1 had already relaxed the blanket ban
  // on "Trip" for the case where the word sits on a control you press — *"the visit editor
  // may say Count this as a trip"* — while keeping passive badges banned. The visit section
  // now carries a participant PICKER reading `Together / Just me / Just Josh`, which is an
  // edit control of exactly that kind, so this check was red against her real data while
  // the app was obeying the newer rule.
  //
  // Asked rather than assumed, because the ban was hers: *"Does 'no together in the visit
  // section' still stand, now that the words sit on a control you press rather than a badge
  // that just asserts something?"* — **"Fine on a control."**
  //
  // So the rule is now about ASSERTION, not vocabulary: the words may live on something you
  // press, and must not appear as text that simply announces a fact about the visit.
  //
  // Worth stating why this went unnoticed: the full browser matrix runs against a seeded
  // disposable database where that card has no visits, so the assertion had nothing to read
  // and passed. It was only ever red against her own data.
  it('the visit section states nothing passively — the words live on controls', async ({
    page,
  }) => {
    await ready(page, SAN_DIEGO);
    await openVisits(page);
    const visits = page.locator('.visits-details');
    await expect(visits).toBeVisible();

    // The section's text with every editable control's own text removed. What is left is
    // what the page ASSERTS at her.
    const passive = await page.evaluate(() => {
      const root = document.querySelector('.visits-details');
      if (!root) return null;
      const copy = root.cloneNode(true) as HTMLElement;
      for (const el of Array.from(copy.querySelectorAll('select, option, button, input, label'))) {
        el.remove();
      }
      return (copy.textContent || '').replace(/\s+/g, ' ');
    });
    expect(passive, 'the visits section did not render').not.toBeNull();

    expect(passive!, 'the visit section still ASSERTS "Together" as text').not.toMatch(/Together/i);
    expect(passive!, 'the visit section still asserts a "· Trip" badge').not.toMatch(/·\s*Trip\b/);
    expect(passive!, '"tap a date" is instructional text she removed').not.toMatch(/tap a date/i);
  });

  it('"Dates should be grouped by year" — and they drop down', async ({ page }) => {
    await ready(page, AT);
    await openVisits(page);
    const years = page.locator('.visit-year');
    await expect(years.first()).toBeVisible();
    expect(await years.count(), 'the years are not dropdowns').toBeGreaterThan(1);
    // Newest first, and only years that have visits.
    const heads = await page.locator('.visit-year-n').allTextContents();
    const nums = heads.map((h) => Number(h.trim()));
    expect(nums, 'years are not newest-first').toEqual([...nums].sort((a, b) => b - a));
  });

  it('the trail card has NO Sections list — the segment rides on the visit', async ({ page }) => {
    await ready(page, AT);
    await openVisits(page);
    // The positive FIRST: a visit segment on screen is what proves the visits actually
    // rendered, and only then does "no SECTIONS heading" mean anything.
    await expect(page.locator('.visit-seg').first()).toBeVisible();
    await expect(page.locator('.panel h3', { hasText: /^SECTIONS/i })).toHaveCount(0);
  });

  it('the Routes section holds the map AND the list', async ({ page }) => {
    // FIND A PLACE THAT HAS ROUTES rather than assuming San Diego does. This check used to
    // open one hard-coded card and demand a Routes heading; the section is conditional on
    // the place having activities, so the day that card had none, "the Routes section holds
    // the map AND the list" went red while Routes was working perfectly everywhere else.
    // Hard-coding a different place would just move the same trap.
    await ready(page, '/places');
    // WAIT FOR THE LIST. `ready` waits for the app to boot, not for Places' rows to arrive,
    // so counting straight away found zero links and reported "no places to check" on an
    // account with 151 of them. Reading the DOM the moment navigation resolves is the exact
    // mistake `ready` exists to prevent, and this walked into it one line later.
    // `:visible` MATTERS HERE. /places lists 132 place links, and the first in DOM order
    // sits inside a COLLAPSED container — present, not visible — so waiting on `.first()`
    // timed out on a page full of places. Containers hold their sections closed until
    // opened, which is the behaviour Places was fixed to have.
    const links = page.locator('a[href^="/place/"]:visible');
    await expect(links.first()).toBeVisible();
    // AND WAIT FOR THE LIST TO BE A LIST. One visible row is not the list: the sample of
    // twelve below was drawn from whatever had rendered at that instant, so which twelve
    // places got checked changed from run to run — and on the run where none of them had
    // activities, this check reported "the section stopped rendering" about an app that
    // was rendering it. A check whose answer depends on render timing is not a check.
    await expect.poll(() => links.count(), { timeout: 15_000 }).toBeGreaterThan(20);
    // READ THE ADDRESSES BEFORE LEAVING THE PAGE. A Playwright locator is live: it
    // re-resolves against whatever document is loaded when you use it. This loop navigates
    // to a place and then asked the SAME locator for its next href — by which time the
    // document is a place page with no `a[href^="/place/"]:visible` in it, so it waited
    // thirty seconds and failed on a page full of places. The list is a snapshot now.
    const hrefs = (
      await links.evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute('href')),
      )
    )
      .filter((h): h is string => !!h)
      .slice(0, 12);
    expect(hrefs.length, 'no places to check').toBeGreaterThan(0);

    // ───────── WHY THE SAMPLE WAS NOT THE PROBLEM (measured 2026-08-30) ─────────
    //
    // This loop used to stop at the FIRST place that rendered a Routes heading and then
    // demand a map of it. That made the check a coin toss, and it is worth writing down
    // which side of the toss is the app and which is this file, because the check passed
    // on one run and was red on the next with nothing deployed in between.
    //
    // THE TWO HALVES OF THE SECTION HAVE DIFFERENT SOURCES:
    //
    //   the LIST  — `PlacePanel` renders `Routes (n)` from `fetchActivitiesForPlaceTree`,
    //               which is the place AND its segment children. That is deliberate: the
    //               W&OD is one place holding its trailheads, and its runs sit on them.
    //   the MAP   — `RouteMiniMap` reads `fetchActivitiesForPlace`, the place's OWN row
    //               only, plus its pings, and returns `null` unless something has a
    //               decodable track. Its own doc says so: *"Renders nothing when there's
    //               no route data."* `PlacePanel` agrees in a comment beside the heading:
    //               *"the list must show even when no route has a track to draw."*
    //
    // So a place can honestly show a list and no map.
    //
    // WHOSE SCREEN THESE NUMBERS ARE. Every figure below was measured AS THE TEST BOT
    // (`testbot@adventureorno.dev`), because that is who `verify:live` signs in as — and
    // the card is NOT the same for two accounts, which is the single most important thing
    // on this page to know before hard-coding anything. Measured 2026-08-30, 15s settle,
    // San Diego read four times including once with cookies cleared, identical every time:
    //
    //   place                                      as the TEST BOT
    //   /place/0795746e-… (San Diego)              NO Routes section  rows=0  map=NO
    //   /place/6bffaec6-… (the Appalachian Trail)  Routes (6)         rows=6  map=NO
    //   /place/eac4216c-…                          Routes (1)         rows=1  map=YES
    //   /place/c85cbe8d-…                          Routes (1)         rows=1  map=YES
    //
    // AND THE SAME SAN DIEGO CARD, READ SIGNED IN AS ERICA the same day, renders
    // `Routes (6)` WITH a map. That is not a contradiction and neither reading is stale:
    // the rest of the card is identical on both screens — `Photos and Videos`,
    // `Beaches (1)`, `Restaurants (2)`, `NOTES AND REVIEWS` — and ONLY Routes differs,
    // which is what rules out a mis-read id or a half-loaded page. What the bot sees is
    // `Visits (1)` and no Routes at all.
    //
    // The MECHANISM is inferred, not measured, and is written as such: the bot cannot read
    // those six activities, and the obvious reason is that it is not tagged on them (§0.2
    // — My Stats is *"every card I am tagged on"*), but that was not isolated here. What IS
    // measured is the effect, and it repeats: this file's own header calls the Appalachian
    // Trail *"the one with 62 visits"* and the bot counts 35 on the same card.
    //
    // SO THE COUNTS ON A CARD ARE PER-VIEWER, and a check that hard-codes a place is
    // asserting what THE BOT can see, not what Erica can. San Diego is the sharpest case:
    // it is the card she designed everything against, it has six routes on her screen, and
    // pinning this check to it would assert a Routes section that does not exist for the
    // account the check actually runs as.
    //
    // Whenever the sample's first route-having place happened to be one with no drawable
    // track, the old check demanded a map the app never promised there and reported the
    // section as broken. It was never broken. That is a defect in this check, not in
    // Routes — and hard-coding either named place would go red on a working app, San Diego
    // because the bot sees no Routes section at all and the AT because it draws no map.
    //
    // WHAT IT ASSERTS NOW, over the places that HAVE routes rather than over one of them:
    //
    //   * every sampled place with a Routes section has a LIST — the half that is
    //     unconditional, now checked on all of them instead of on one;
    //   * and the section is a map AND a list on a place that has a track to draw, found
    //     by looking for one instead of hoping the first one is it.
    //
    // THE SETTLE IS EXPLICIT, because "no Routes heading" and "the heading has not
    // arrived yet" look identical, and reading them apart by timing is what the rule at
    // the top of this file forbids. `trailActs` starts null and the Visits section prints
    // `Loading…` while it is, so waiting for that word to go is the app telling us the
    // routes state is DECIDED. Without it this loop mis-sampled: `c85cbe8d` read as
    // having no Routes section at 2.5s and one at 12s.
    it.setTimeout(180_000);

    let withRoutes = 0;
    let both = '';
    for (const href of hrefs) {
      if (both) break;
      await ready(page, href);
      // The positive first (openVisits opens it), then the wait for the word to go.
      await openVisits(page);
      await expect(page.locator('.visits-details p').filter({ hasText: /^Loading/ })).toHaveCount(
        0,
      );
      const heading = page.locator('.panel h3').filter({ hasText: /^Routes/ });
      if ((await heading.count()) === 0) continue;
      withRoutes += 1;
      // THE LIST, on every place that has the section — never conditional.
      expect(
        await page.locator('.route-row').count(),
        `${href} has a Routes section and no list`,
      ).toBeGreaterThan(0);
      // A DRAWN map, not merely a mounted one. `RouteMiniMap` renders its wrapper while
      // it is still deciding and removes it when there is nothing to draw, so the
      // wrapper alone would pick places whose map is about to vanish. The canvas exists
      // only once MapLibre has actually been constructed, which happens on the `hasData`
      // branch — so it is the honest "this place has a track" signal.
      if ((await page.locator('.route-mini-canvas canvas').count()) > 0) both = href;
    }

    expect(
      withRoutes,
      // `total` DID NOT EXIST. This message only builds when the check has already
      // failed, so the ReferenceError replaced the report with a crash — the one check
      // that was telling the truth could not say what it had found.
      `none of the first ${hrefs.length} places rendered a Routes section — either no ` +
        `place has activities, or the section stopped rendering`,
    ).toBeGreaterThan(0);
    expect(
      both,
      `${withRoutes} of the first ${hrefs.length} places have a Routes section, but none ` +
        `of them drew a map. Either every one of them is a container whose routes sit on ` +
        `its segments, or the mini map stopped rendering`,
    ).not.toBe('');

    // The request itself, on the place that has both: the section is a map AND a list,
    // not one or the other. The page is already on it.
    await expect(page.locator('.panel h3').filter({ hasText: /^Routes/ })).toHaveCount(1);
    await expect(page.locator('.route-mini')).toBeVisible();
    expect(await page.locator('.route-row').count(), 'Routes has no list').toBeGreaterThan(0);
  });

  it('the photos are ONE carousel with the heart and the flame on it', async ({ page }) => {
    await ready(page, SAN_DIEGO);
    await expect(page.locator('.gallery.carousel')).toHaveCount(1);
    expect(await page.locator('.thumb-mark').count(), 'no reactions on the strip').toBeGreaterThan(
      0,
    );
  });

  // ───────── BUILT 2026-08-28. Three things the locked card has always specified and
  // never had, and which STATE.md had ticked as done since 08-15. ─────────

  // "Every card should have a cover photo or if it is an activity without a photo just
  // the letter of the activity" — Erica, 2026-08-11. 121 of 166 places have no cover
  // photo, and those cards drew no hero at all.
  it('EVERY card has a cover — a photo, a letter, or a slot', async ({ page }) => {
    await ready(page, SAN_DIEGO);
    await expect(page.locator('.panel-hero')).toHaveCount(1);
    // And the header that used to replace it on a photoless place is gone for good.
    await expect(page.locator('.panel .panel-head')).toHaveCount(0);

    // A place with NO cover photo must still get one. Find one from the list rather than
    // hard-coding an id that may gain a photo tomorrow.
    await ready(page, '/places');
    const links = page.locator('a[href^="/place/"]:visible');
    await expect(links.first()).toBeVisible();
    await expect.poll(() => links.count(), { timeout: 15_000 }).toBeGreaterThan(20);
    const hrefs = (
      await links.evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute('href')),
      )
    )
      .filter((h): h is string => !!h)
      .slice(0, 15);

    let coverless = '';
    for (const href of hrefs) {
      if (coverless) break;
      await ready(page, href);
      if ((await page.locator('.panel-hero-img').count()) === 0) coverless = href;
    }
    expect(coverless, 'no photoless place among the first 15 — cannot test the fallback').not.toBe(
      '',
    );
    // Whatever it is, it is a cover: the letter, or the slot. Never nothing.
    const glyphs = await page.locator('.panel-hero-glyph').count();
    const slots = await page.locator('.panel-hero-slot').count();
    expect(glyphs + slots, 'a place with no photo drew no cover at all').toBeGreaterThan(0);
  });

  // "EACH VISIT SHOULD OPEN TO A CARD. THE CARD SHOULD LOOK EXACTLY LIKE SAN DIEGO DOES
  // NOW" — Erica, 2026-08-11, in capitals.
  it('a visit opens THE CARD, not a page', async ({ page }) => {
    await ready(page, SAN_DIEGO);
    await openVisits(page);
    const first = page.locator('.visit-row').first();
    await expect(first).toBeVisible();
    // CLICK THE ROW'S "Open" LINK, NOT THE ROW. `.visit-row` is a plain `<div>` and is
    // inert — it has no handler of its own. What it CONTAINS is two controls: a
    // `<button class="visit-main visit-open">` that expands that visit's editor in
    // place (dates, who, trip, delete), and an `<a href="/visit/…">Open</a>` that opens
    // the visit's card. Clicking the div landed on the button, which expanded the editor
    // and correctly did not navigate, so this waited 15s for a `/visit/` URL against a
    // card that was working. Measured live 2026-08-30: the Open link goes to
    // `/visit/7fb3e76f-…` and renders `.panel.visit-card`.
    //
    // Only the TARGET was wrong; every assertion below is untouched. The link is located
    // through the row rather than page-wide, so this is still "a visit row opens the
    // card" and not "some link somewhere does".
    const open = first.getByRole('link', { name: /^Open$/ });
    await expect(open).toBeVisible();
    await open.click();
    await expect(page).toHaveURL(/\/visit\//);

    // The positive first: it is a panel with a cover and the locked sections.
    await expect(page.locator('.panel.visit-card')).toBeVisible();
    await expect(page.locator('.panel-hero')).toHaveCount(1);
    const heads = (await page.locator('.panel h3, .panel .visits-summary').allTextContents()).map(
      (t) => t.trim(),
    );
    expect(
      heads.some((t) => /^Visits/i.test(t)),
      `no Visits section: ${heads.join(' | ')}`,
    ).toBe(true);
    expect(heads.some((t) => /Photos and Videos/i.test(t))).toBe(true);
    expect(heads.some((t) => /NOTES AND REVIEWS/i.test(t))).toBe(true);
    // Only now does absence mean anything: the page chrome it used to wear.
    await expect(page.locator('.visit-card .back-bar')).toHaveCount(0);
    await expect(page.locator('.visit-card h1')).toHaveCount(0);
    await expect(page.getByText(/What we did/i)).toHaveCount(0);
  });

  // "clicking add should pull up a blank card to edit" — and it is the CARD, with the
  // sections, not a form. Moved out of the "not built" block on 2026-08-28.
  it('"clicking add should pull up a blank card to edit"', async ({ page }) => {
    await ready(page, '/add');
    await page.getByRole('button', { name: /Add a place, visit or activity/i }).click();
    const card = page.getByRole('dialog', { name: 'New place' });
    await expect(card).toBeVisible();
    // It is the card: a panel, with a cover and the locked sections.
    await expect(page.locator('.panel.npd-card')).toBeVisible();
    await expect(page.locator('.npd-card .panel-hero')).toHaveCount(1);
    await expect(page.getByPlaceholder(/Name this place/i)).toBeVisible();
    await expect(page.getByText(/Add a cover photo/i)).toBeVisible();
    // BOTH PLACES THE CARD SAYS IT, each named. `getByText(/this is visit one/i)` was a
    // strict-mode violation resolving to 2 elements, because the blank card says it
    // TWICE — on the coords line (`38.05567, -95.75000 · this is visit one`) and as the
    // Visits section's own label. Nothing about the card changed and neither element is
    // wrong; the locator simply never said which of the two it meant, so the check
    // crashed on a card that was doing exactly what was asked.
    //
    // Both are asserted rather than one picked with `.first()`: both are the card's
    // promise — §"THE CARD — LOCKED", *"Its Visits section says 'this is visit one',
    // because saving a new place IS its first visit"* — and `lockedCard.test.ts` guards
    // the same words at source. Naming them is strictly more than the old line proved.
    await expect(page.locator('.npd-card .npd-coords')).toContainText(/this is visit one/i);
    await expect(
      page
        .locator('.npd-card h3')
        .filter({ hasText: /^Visits/ })
        .locator('.label'),
    ).toHaveText(/this is visit one/i);
    // Not a chooser, and not the parent picker she deleted.
    await expect(page.getByText(/what are you adding/i)).toHaveCount(0);
    await expect(page.getByText(/Part of a trail/i)).toHaveCount(0);
  });

  // REWRITTEN 2026-08-30 under rule 4 at the top of this file, and it is a RULING
  // rather than a drift.
  //
  //   WAS (the approved preview, 2026-08-11): the blank card's Routes and Restaurants
  //       read "Added once this first visit is saved", because an activity attaches to
  //       a VISIT and a blank card has no visit until Save. docs/STATE.md carried it as
  //       an OPEN question that needed her, from 2026-08-12.
  //   IS  (2026-08-30): "I also think Add should lead to a card where I can add an
  //       activity, restaurant, notes, etc — it should be FULLY EDITABLE."
  //
  // Everything is STAGED and written in one go on Save, which is the promise the card
  // already made about the name, the rating, the tags, the date and the photos. The old
  // words are still on the card where they are still true — somewhere to go later has
  // no visit, and neither does a card whose date has been cleared.
  it('"it should be fully editable" — a route, a restaurant and a note before Save', async ({
    page,
  }) => {
    await ready(page, '/add');
    await page.getByRole('button', { name: /Add a place, visit or activity/i }).click();
    await expect(page.locator('.panel.npd-card')).toBeVisible();
    // The positive first: the real card, with its fillable sections.
    await expect(page.getByRole('combobox', { name: /Add a route/i })).toBeVisible();
    await expect(page.getByRole('combobox', { name: /Add a restaurant/i })).toBeVisible();
    // The note form is the saved card's own — Title, Rating, Notes, Date, Link.
    const notes = page.locator('.npd-card form.entry');
    await expect(notes).toHaveCount(1);
    await expect(notes.getByRole('combobox').first()).toBeVisible();

    // STAGE A NOTE, and see it held on the card rather than saved.
    await notes.locator('input').first().fill('A thought before saving');
    await notes.getByRole('button', { name: /^Save$/ }).click();
    await expect(page.locator('.npd-staged-row')).toHaveCount(1);
    await expect(page.getByText('A thought before saving')).toBeVisible();

    // …and CANCEL leaves nothing behind. The confirm is the card asking, which is
    // itself the proof that it knows it is holding work.
    //
    // THE CARD'S OWN CANCEL, named by the footer it sits in. `getByRole('button',
    // { name: /^Cancel$/ })` was a strict-mode violation resolving to 3 elements: the
    // blank card carries THREE controls labelled Cancel — the cover's close ✕
    // (`aria-label="Cancel"`), the note form's own Cancel, and the card's footer Cancel.
    // The click therefore never happened, on a card where cancelling works. The one this
    // check means is the card's: the only one that discards the card, and so the only
    // one the confirm dialog belongs to.
    page.once('dialog', (d) => void d.accept());
    await page
      .locator('.npd-footer')
      .getByRole('button', { name: /^Cancel$/ })
      .click();
    await expect(page.locator('.panel.npd-card')).toHaveCount(0);
  });
});

it.describe('the rest of the app — what she asked for', () => {
  it.use({ baseURL: SITE });

  it('the map has no redundant "+ Add" button', async ({ page }) => {
    await ready(page, '/');
    // The map's own chrome first: without it, "no + Add button" is true of a blank page.
    await expect(page.locator('.stats-bar')).toBeVisible();
    await expect(page.locator('.add-btn')).toHaveCount(0);
  });

  it('the nav is Map / Add / Insights / Settings', async ({ page }) => {
    // CHANGED 2026-08-22 to the approved navigation. It read `Map / Places / Add / Timeline`
    // and that was correct until the day Places and Timeline stopped being destinations and
    // became TABS inside Insights, sharing one people scope with an Overview. The old
    // expectation is written down rather than deleted, because a check that quietly changes
    // its mind is how you stop being able to tell a decision from a regression.
    await ready(page, '/');
    const tabs = await page.locator('nav.primary-nav a').allTextContents();
    expect(tabs.map((t) => t.trim())).toEqual(['Map', 'Add', 'Insights', 'Settings']);
  });

  it('the two old destinations still work and land where they went', async ({ page }) => {
    // "Old routes redirect until links and saved URLs have migrated."
    await ready(page, '/places');
    expect(new URL(page.url()).searchParams.get('tab')).toBe('places');
    await ready(page, '/timeline');
    expect(new URL(page.url()).searchParams.get('tab')).toBe('timeline');
  });

  it('a tab body is a tab, not a page inside a page', async ({ page }) => {
    // FOUND LIVE, not in a test: the Places tab rendered "Map ▸ Places" and the Timeline
    // tab rendered "Settings ▸ Timeline" — each screen still wearing the back-bar and the
    // heading it had when it was a route. A back-bar inside a tab offers a way out of the
    // page you are already on, and the heading repeats the tab you just pressed.
    //
    // AND THE FIRST VERSION OF THIS CHECK PASSED AGAINST A SITE THAT STILL HAD THE BUG.
    // `ready()` proves the APP BOOTED — it waits for the nav — and the tab body arrives
    // later, so `toHaveCount(0)` was asked before there was anything to count and answered
    // "zero, correct". A count of zero proves nothing until the screen has rendered. So
    // every negative here now follows a POSITIVE one that only the real screen satisfies:
    // Places has rows, Timeline has years.
    const RENDERED: Record<string, string> = { places: '.place-rows', timeline: '.tl-year' };
    for (const [tab, proof] of Object.entries(RENDERED)) {
      await ready(page, `/insights?tab=${tab}`);
      await expect(page.locator(`.insights-body ${proof}`).first()).toBeVisible();
      await expect(page.locator('.insights-body .back-bar')).toHaveCount(0);
      await expect(page.locator('.insights-body h1')).toHaveCount(0);
      await expect(page.locator(`[role="tab"][aria-selected="true"]`)).toHaveCount(1);
    }
  });

  // REWRITTEN 2026-08-30 under rule 4 at the top of this file, and it is a RULING
  // rather than a drift — which is the one case rule 4 exists for.
  //
  //   WAS (2026-08-11): "Settings is ONE page, no tabs." Erica: "everything from
  //                     account, connections, privacy, data, and advanced should [be]
  //                     extracted and added to one page… I don't need the labels like
  //                     Account etc make it look like a seamless page."
  //   NOW (2026-08-20, RULED DEFINITIVE 2026-08-30): Settings has EXACTLY THREE
  //                     destinations — Account | Integrations | Data & Privacy.
  //
  // Both instructions sat in docs/STATE.md contradicting each other and neither had
  // been retired. On 2026-08-30 Erica ruled for the 08-20 plan and retired the 08-11
  // "no section labels" line by name: *"use the 08-20 three-destination plan. The
  // 08-11 'no section labels' instruction is hereby retired and must not be cited
  // again."* The older instruction is recorded here rather than deleted.
  //
  // `.settings-tabs` STILL HAS TO BE ZERO. That class was the FIVE-tab bar 08-11
  // removed and its CSS is deleted with this change; it may not come back under cover
  // of the new contract. The three destinations are `.settings-dests`, and they are
  // asserted BY NAME — so this cannot pass against a Settings page that quietly lost
  // its navigation, and it cannot pass against one that grew a fourth destination.
  it('Settings has exactly three destinations: Account | Integrations | Data & Privacy', async ({
    page,
  }) => {
    await ready(page, '/settings');
    // A positive assertion first: a count of zero proves nothing until the screen has
    // rendered, which is this file's own hardest-learned rule.
    const dests = page.locator('.settings-dests a');
    await expect(dests.first()).toBeVisible();
    expect((await dests.allTextContents()).map((t) => t.trim())).toEqual([
      'Account',
      'Integrations',
      'Data & Privacy',
    ]);
    await expect(page.locator('.settings-tabs')).toHaveCount(0);
  });

  it('Data & Privacy is ONE destination and ONE continuous page', async ({ page }) => {
    // "…not Location/Data pills or separate Data/Privacy destinations" — so every
    // section is on the page at once, in the order the contract sets them out.
    await ready(page, '/settings/data');
    await expect(page.getByRole('heading', { name: /^Location$/ })).toBeVisible();
    for (const heading of [
      /^Sharing/,
      /^Messaging and event privacy$/,
      /^Needs attention$/,
      /^Your data$/,
    ]) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
  });

  it('"Move Import and Sort Photos into Settings"', async ({ page }) => {
    // THE PATHS MOVED, THE INSTRUCTION DID NOT. Both controls were on `/settings` when
    // Settings was one long page. Under the three-destination contract ruled definitive
    // on 2026-08-30 they sit in the destination whose written definition covers them:
    // sorting photos is Data Management (Data & Privacy ▸ Your data), and a Garmin file
    // is a connected source (Integrations). Her instruction was that they BE in
    // Settings, and they are — so this follows them rather than going red against a
    // page that is now correct, which is the stale-assertion trap this file's own
    // helper already records.
    await ready(page, '/settings/data/manage');
    // A LINK, not a button. It has always been an `<a>` styled `as-button`, so asking for
    // role=button asked for something that was never there and failed against a Settings
    // page that has had the control all along. What she asked for is that the control BE
    // on Settings, and it is; the role is how it gets there.
    await expect(page.getByRole('link', { name: /Import & sort photos/i })).toBeVisible();
    await ready(page, '/settings/integrations');
    // THE BUTTON WENT, AND THE THING IT PROMISED STAYED. This asserted an "Import an
    // activity file" button on Settings. That button pointed at `/import/timeline`, a route
    // that does not exist, AND duplicated the working GPX/TCX/FIT importer sitting a few
    // inches below it — so it was removed rather than repointed (2026-08-20). Her
    // instruction was "move import activities to settings"; the importer IS on settings.
    // The check follows the instruction rather than the button that used to serve it.
    await expect(
      page.getByRole('button', { name: /Choose GPX \/ TCX \/ FIT files/i }),
    ).toBeVisible();
    await ready(page, '/add');
    await expect(
      page.getByRole('button', { name: /Add a place, visit or activity/i }),
    ).toBeVisible();
    await expect(page.getByText(/sort photos/i)).toHaveCount(0);
    await expect(page.getByText(/import an activity file/i)).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // NOT BUILT YET. These fail on purpose: they are the outstanding requests, and
  // they are what "not done" looks like in this system rather than a promise.
  // ---------------------------------------------------------------------------

  // REWRITTEN 2026-08-17, per rule 4 at the top of this file: she changed her mind, so the
  // check follows the NEW instruction and the old one is recorded rather than deleted.
  //
  //   WAS (2026-08-11): "the stats section was supposed to be moved to the top of places"
  //                     — asserted a stats bar ON /places, above the first place.
  //   NOW (2026-08-15): "No stats bar on Places" and "No settings icon on Places". #94
  //                     removed `<StatsBar>` from PlacesList, which takes the gear with it
  //                     because `.gear-btn` lives inside StatsBar.
  //
  // The two instructions are direct opposites, and the older check kept failing against an
  // app that was correctly obeying the newer one — which is how four of this file's five
  // red checks came to be noise. Stats live on /settings now; that is asserted below it.
  it('"No stats bar on Places" and no settings icon (supersedes "stats at the top")', async ({
    page,
  }) => {
    // `/places` REDIRECTS into Insights now, so this waits for the tab body to have rows
    // before asking what is absent — otherwise it passes against an empty page.
    await ready(page, '/places');
    await expect(page.locator('.insights-body .place-rows')).toBeVisible();
    await expect(page.locator('.stats-bar')).toHaveCount(0);
    await expect(page.locator('.gear-btn')).toHaveCount(0);
    // And they did not simply vanish: Stats is on Settings, where she moved it.
    //
    // Assert the TRIPS STAT, not `.our-stats` — /settings has six of those (people, stats,
    // states, parks, peaks, categories) and a bare class selector is a strict-mode
    // violation waiting to happen. `openStats` has already opened the Stats card by name.
    await ready(page, '/settings');
    await openStats(page);
    await expect(page.locator('.stat-open')).toBeVisible();
  });

  it('"clicking on the Trips should pull up a list of trips that I can edit and also has an add a trip button"', async ({
    page,
  }) => {
    await ready(page, '/settings');
    await openStats(page);
    const pill = page.locator('.stat-open');
    await pill.click();

    // A list of trips, each row opening its visit, and a way to add one.
    //
    // THE LIST OPENED — the positive first, because only the opened control renders it.
    const list = page.locator('.trip-list');
    await expect(list).toBeVisible();
    // …and the way to add one, which is the half of her request that does not depend on
    // having been anywhere yet.
    await expect(page.getByRole('link', { name: /add a trip/i })).toBeVisible();

    // WHY THIS NO LONGER DEMANDS A ROW. It used to open the pill and assert
    // `.trip-row` existed, which asserts the SIGNED-IN ACCOUNT'S DATA rather than the
    // feature: `verify:live` runs as the test bot, and measured live on 2026-08-30 the
    // pill reads **"0 Trips"** and the list correctly says *"No trips yet. A visit of
    // more than one day counts as one."* with the add button under it. The control does
    // everything she asked for; the bot has simply never been anywhere for two days.
    //
    // This file has been caught by the same shape from the other side, and the note is
    // a few checks above: the browser matrix ran against a seeded database "where that
    // card has no visits, so the assertion had nothing to read and passed". Here it had
    // nothing to read and FAILED, and reported a working control as missing.
    //
    // So the row assertion is kept exactly where it means something — over the trips
    // that exist — and the pill's count is tied to the list underneath it, which is a
    // real claim on any account, empty or not, and one the old check never made. On
    // Erica's own account (trips > 0) this asserts everything it asserted before.
    const rows = list.locator('.trip-row');
    const n = Number((await pill.innerText()).replace(/\D+/g, '') || '0');
    await expect(rows).toHaveCount(n);
    if (n === 0) {
      await expect(list).toContainText(/No trips yet/i);
    } else {
      await expect(rows.first()).toBeVisible();
      await expect(rows.first()).toHaveAttribute('href', /^\/visit\//); // the ROW is the control
    }
  });

  it('"The number of visits to each place should be the count on that dropdown"', async ({
    page,
  }) => {
    await ready(page, SAN_DIEGO);
    // The Visits dropdown's count is the number of visits to this place.
    await expect(page.locator('.visits-summary')).toContainText(/Visits\s*\(\d+\)/);
  });

  // ADDED 2026-08-30 under rule 1 at the top of this file, for a request she made after
  // seeing the half-migrated control on production.
  //
  //   MEASURED, live, as Erica: the map's bottom control read `[My Stats]  [Josh]`.
  //   §0.2: *"There are exactly three scopes and no operator"* — My Stats, Our Stats, and
  //   a person's own, the last of which is *"seen by opening their profile — never a pill
  //   on my map."*
  //
  // NOTHING IS REWRITTEN HERE, and that is checked rather than assumed: no check in this
  // file ever asserted the map's scope vocabulary — which is how it shipped half-migrated.
  // The one check that names "Together / Just me / Just <name>" (the visit section, above)
  // is about ATTRIBUTION — who was on a visit — which §0.2 does not re-word, so it stands
  // as she last left it. The words §0.2 DID retire are recorded surface by surface in
  // `app/src/lib/participants.test.ts`, with the instruction each one supersedes.
  //
  // WHAT THIS CAN AND CANNOT PROVE. `verify:live` signs in as the TEST BOT, and the bot has
  // recorded nobody, so on its account the control correctly renders nothing at all — a
  // control with one possible answer is noise. So the strong form of this rule (the two
  // words, the picker, no per-person pill) is enforced at source in `participants.test.ts`,
  // and what runs HERE is the part a bot can still falsify: wherever the control does
  // render, every button on it is a scope and none of them is a person.
  it('the map scope control offers scopes, never a person', async ({ page }) => {
    await ready(page, '/');
    // The map's own chrome first — otherwise "no person pill" is also true of a blank page,
    // which is the trap noted at the top of this file.
    await expect(page.locator('.stats-bar')).toBeVisible();

    const scope = page.locator('.person-filter');
    const buttons = (await scope.locator('button').allTextContents()).map((t) => t.trim());
    // Two scopes, in this order, or an account with nobody to share anything with.
    expect(buttons.length === 0 || buttons.join(' | ') === 'My Stats | Our Stats').toBe(true);

    // AND NO NAME, whoever is signed in. A pill here is the third scope asked on the screen
    // about me, which is the thing she objected to.
    for (const label of buttons) {
      expect(['My Stats', 'Our Stats']).toContain(label);
    }
  });

  it('"I did not want Trips in the toggle on the main page, I wanted it under Stats"', async ({
    page,
  }) => {
    await ready(page, '/');
    await expect(page.locator('.stats-bar')).toBeVisible();
    await expect(page.locator('.stats-bar')).not.toContainText(/trips?\b/i);
    await ready(page, '/settings');
    await openStats(page);
    await expect(page.locator('.stat-open')).toContainText(/Trips/);
  });

  // Erica, 2026-08-17: "if we own the map can we remove the openstreet logo" — no, and
  // then "alter the OSM info to be less visible" — done. This check is the line between
  // the two: the credit may be as small and muted as she likes, and it may not vanish.
  //
  // Owning the tiles changed who serves the bytes; the DATA is OpenStreetMap's under ODbL,
  // so the credit is a condition of using it. The OSMF guideline requires it LEGIBLE
  // WITHOUT INTERACTION, with a route to the licence. Checked here rather than in the
  // local suite because the credit is supplied by the basemap style, and only the live
  // site serves the real one.
  it('"alter the OSM info to be less visible" — quieter, still legible, still linked', async ({
    page,
  }) => {
    await ready(page, '/');

    const credit = page.locator('.maplibregl-ctrl-attrib-inner');
    await expect(credit).toBeVisible();
    await expect(credit).toContainText('OpenStreetMap');

    // A route to the origin and licence. Naming the project is not stating the licence.
    await expect(
      page.locator('.maplibregl-ctrl-attrib-inner a[href*="openstreetmap.org/copyright"]'),
    ).toHaveCount(1);

    // NO ⓘ TOGGLE. It was an icon, against her standing preference, and redundant once
    // the text is always shown — but it may only go while the text stays visible above.
    await expect(page.locator('.maplibregl-ctrl-attrib-button')).toBeHidden();

    // Quiet is the request, so quiet is asserted: small type, and no white pill.
    const size = await credit.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(
      size,
      'the credit should be small — it was 12px+ in MapLibre default dress',
    ).toBeLessThanOrEqual(11);
  });

  // ───────── ADDED 2026-08-30, AND LATE — which is the point of recording it ─────────
  //
  // Rule 1 at the top of this file says a request gets a check here BEFORE the work
  // starts. These four did not. §"CONNECTING TO SOMEONE — approved 2026-08-30" shipped to
  // production across PRs #188, #192, #193 and #194 — a people directory, a public profile
  // on a handle, add/remove/block, and invite codes — and NOT ONE of them had a line in
  // this file. Thirty checks, none of which mentioned people, profiles, handles, blocking
  // or invites.
  //
  // That is the exact failure this file exists to prevent, arriving in the file itself:
  // `docs/STATE.md`'s approved-order table still called item 7 *queued* while it was
  // live and working, because nothing red was ever going to say otherwise. Written now,
  // measured against production, rather than backdated.

  // Erica, 2026-08-30: "I don't know that I want to use the term friend, just add."
  it('"just add" — the people screens never say friend', async ({ page }) => {
    await ready(page, '/people');
    // The positive first: the directory itself, not a blank page.
    await expect(page.getByRole('heading', { name: /^People$/ })).toBeVisible();
    await expect(page.getByPlaceholder(/handle or name/i)).toBeVisible();
    // Only now does absence mean anything.
    await expect(page.getByText(/\bfriends?\b/i)).toHaveCount(0);
    // …and none of §0.2's retired scope words, which this screen is a prime place to leak.
    const body = await page.locator('body').innerText();
    for (const word of ['Just me', 'Just Josh', 'Just Erica', 'Together', 'Both', 'Anyone']) {
      expect(body, `"${word}" is retired (§0.2) and is on /people`).not.toMatch(
        new RegExp(`\\b${word}\\b`),
      );
    }
  });

  // "/people is who is out there, and where do I stand with them" — and it is reached from
  // Settings ▸ Account, because "the approved navigation has exactly four destinations and
  // this is not one of them".
  it('the people directory is found through Settings, not the nav', async ({ page }) => {
    await ready(page, '/people');
    await expect(page.getByRole('heading', { name: /^People$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /your people/i })).toBeVisible();
    // The nav stays at four destinations — People is not a fifth.
    const nav = await page.locator('nav.primary-nav a').allTextContents();
    expect(nav.map((t) => t.trim())).toEqual(['Map', 'Add', 'Insights', 'Settings']);
    // And the way in is on Account.
    await ready(page, '/settings/account');
    await expect(page.locator('a[href^="/people"]').first()).toBeVisible();
  });

  // "Unknown handle, private account and a block all give the same 'No page here.'" — the
  // sameness is the requirement: a different answer for each would let a blocked user tell
  // that they had been blocked, which is the thing the one answer exists to hide.
  it('an unknown handle says "No page here" and will not say which', async ({ page }) => {
    await ready(page, '/profile/definitely-not-a-real-handle-9x7q');
    await expect(page.getByText(/no page here/i)).toBeVisible();
    // It must not distinguish "does not exist" from "not public" — measured live, it says
    // so in as many words.
    await expect(page.getByText(/will not tell you which/i)).toBeVisible();
  });

  // "Someone can only join with a code from you. Each code lets in one person and then
  // stops working" — invite codes, migration 0288, PR #194.
  it('an invite code lets in one person and then stops', async ({ page }) => {
    // NOT THROUGH `ready`. Its /settings branch waits for a heading matching /settings/i,
    // and this page's headings are `Invite codes · Make a code · Your codes` — the word
    // Settings is only the back-bar link. Waiting for it here would fail on a page that is
    // correct, which is the trap that helper's own comment describes. Its own heading is
    // the equivalent proof that the screen arrived.
    await page.goto('/settings/account/invites');
    await expect(page.getByRole('heading', { name: /invite codes/i })).toBeVisible();
    await expect(page.getByText(/only join with a code from you/i)).toBeVisible();
    await expect(page.getByText(/lets in one person/i)).toBeVisible();
    // A way to make one, and somewhere they are listed.
    await expect(page.getByRole('button', { name: /^Make a code$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /your codes/i })).toBeVisible();
  });

  // ───────── ADDED 2026-08-30, BEFORE THE WORK IS LIVE — rule 1, used properly ─────────
  //
  // The four checks above were added LATE, after their feature had already shipped, and
  // said so. These two are the other way round: written against production first, red on
  // purpose, and they go green when the deploy carrying `PublicProfileCard` lands. That
  // is what rule 1 describes — *"A new request gets a check here BEFORE the work starts.
  // It fails. The work makes it pass."*
  //
  // THE GAP THEY DESCRIBE, measured live 2026-08-30: `/people` and `/profile/:handle` were
  // built and worked and were empty for everybody, because `0283` defaults
  // `profile_visibility` to `private` with all three switches false and NOTHING in the app
  // could change any of them — no handle field, no bio, no switches, anywhere. Probed live
  // as the test bot: `/settings/account` had no avatar, no bio and no public-profile
  // control. `find_profiles()` only matches a public row, so the directory could not
  // contain a single person. No migration was needed: `set_handle()` and
  // `save_public_profile()` have been applied since 0283 and had no caller.
  it('"just add" — and you can be added, because you can publish yourself', async ({ page }) => {
    await ready(page, '/settings/account');
    // The positive first: the section exists and is named.
    await expect(page.getByRole('heading', { name: /your public profile/i })).toBeVisible();
    // The three things that were missing: a handle to be found by, the one switch that
    // makes you findable, and a sentence saying what a stranger actually sees.
    await expect(page.locator('.pub-profile')).toBeVisible();
    // A HANDLE, IN WHICHEVER OF ITS TWO STATES THIS ACCOUNT IS IN — the per-viewer lesson
    // again. 0283 assigns everybody a handle on sight and freezes it only once CHOSEN, so
    // an account that has not chosen shows the input and one that has shows the fixed
    // `@name`. Asserting only the input was wrong twice over: it went red against the
    // first deploy of this card (which had the predicate backwards and rendered neither),
    // and it would go red again the day the bot claims one. Either state is the feature.
    await expect(
      page.locator('.pub-profile input[aria-label="Handle"], .pub-profile .pub-handle-fixed'),
    ).toBeVisible();
    await expect(page.getByText(/let people find me/i)).toBeVisible();
    // The outcome is STATED, not left to be added up from the switches.
    await expect(page.locator('.pub-profile')).toContainText(
      /no handle yet|profile is private|Your name and handle/i,
    );
  });

  it('the public-profile switches say what each one shares', async ({ page }) => {
    await ready(page, '/settings/account');
    await expect(page.locator('.pub-profile')).toBeVisible();
    const switches = page.locator('.pub-switches');
    await expect(switches).toBeVisible();
    for (const label of ['My totals', 'My places', 'My recent outings']) {
      await expect(switches.getByText(label, { exact: true })).toBeVisible();
    }
    // NOT the retired vocabulary. This is a screen about what OTHER people see, which is
    // exactly where a scope word would leak back in.
    const body = await page.locator('.pub-profile').innerText();
    for (const word of ['Just me', 'Just Josh', 'Just Erica', 'Together', 'Both', 'Anyone']) {
      expect(body, `"${word}" is retired (§0.2) and is on the public profile card`).not.toMatch(
        new RegExp(`\\b${word}\\b`),
      );
    }
    // And never "friend" — the word is add.
    expect(body).not.toMatch(/\bfriends?\b/i);
  });

  // Erica asked for the bucket list and it has been live for months with NO live check —
  // recorded as the next gap to close in `liveCheckCoverage.test.ts`, and closed here.
  // Measured live first: headings `Bucket List` then a heading per state, and every row
  // carries a `Want to go` control.
  it('the bucket list groups by state and every row can be wanted', async ({ page }) => {
    await ready(page, '/bucket');
    await expect(page.getByRole('heading', { name: /^Bucket List$/i })).toBeVisible();
    // Grouped — the state headings are the grouping, so at least one must exist.
    const heads = await page.locator('h2, h3').allTextContents();
    expect(
      heads.filter((t) => t.trim() && !/^bucket list$/i.test(t.trim())).length,
      `the bucket list is not grouped: ${heads.join(' | ')}`,
    ).toBeGreaterThan(0);
    // The control she asked for, on the rows.
    expect(await page.getByRole('button', { name: /want to go/i }).count()).toBeGreaterThan(0);
    // §0.2's retired words must not be here either — this screen said "Both" for a year.
    const body = await page.locator('body').innerText();
    for (const word of ['Just me', 'Just Josh', 'Just Erica', 'Together', 'Both', 'Anyone']) {
      expect(body, `"${word}" is retired (§0.2) and is on /bucket`).not.toMatch(
        new RegExp(`\\b${word}\\b`),
      );
    }
  });

  // ALSO RED ON PURPOSE until this deploys — rule 1.
  //
  // §"AN ACCEPTED TAG IS MINE" and §0.2 both turn on being ASKED before somebody else's
  // claim counts: *"Only accepted tags count in Our Stats. A proposed tag is a claim, not
  // shared history."* The flow was BUILT and APPLIED in 0248 and was UNREACHABLE: its only
  // surface was `routes/Inbox.tsx`, which nothing imports, and `/inbox` redirects to
  // `/settings/data/attention` — measured live 2026-08-30. Worse, the section heading on
  // Data & Privacy read "People and tag approvals" over a card that answered JOIN requests,
  // which is account access and a different question. The heading promised a control the
  // page did not contain.
  it('a tag is a claim until you answer it — and you can answer it', async ({ page }) => {
    await page.goto('/settings/data');
    await expect(page.getByRole('heading', { name: /settings/i }).first()).toBeVisible();
    // The positive first: the section exists, by the name that describes it.
    await expect(page.getByRole('heading', { name: /^Tag approvals$/i })).toBeVisible();
    await expect(page.locator('.tag-approvals')).toBeVisible();
    // It says what a tag IS while there is nothing to answer, rather than drawing a box.
    await expect(page.locator('.tag-approvals')).toContainText(
      /Nothing to answer|their claim and not your history/i,
    );
    // And the old heading that promised this over the wrong card is gone.
    await expect(page.getByRole('heading', { name: /People and tag approvals/i })).toHaveCount(0);
  });

  // ───────── CLOSING THE COVERAGE RATCHET, 2026-08-30 ─────────
  //
  // `app/src/lib/liveCheckCoverage.test.ts` recorded 17 of 37 routes as having no live
  // check, each with the reason it was uncovered, and fails if that list grows. These
  // eight close most of it. Every string below was MEASURED on production first — the
  // point of the list was never to hold reasons, it was to be emptied.
  //
  // They are deliberately shallow. A check that opens a screen and names the one thing it
  // is for cannot go stale the way a check that asserts a count can, and it is enough to
  // catch the failure that actually happens: a route that stops rendering, or renders the
  // error boundary. Anything deeper belongs in a check of its own, written when she asks
  // for the thing it would guard.

  it('the old routes still land where they were moved to', async ({ page }) => {
    // FOUR LEGACY ROUTES, asserted in code rather than described in a comment. This
    // matters for more than tidiness: the coverage guard reads the spec with comments
    // STRIPPED, because naming a route in prose is not checking it — a lesson it learned
    // by wrongly marking these three covered when a comment merely mentioned them.
    for (const [from, to] of [
      ['/attention', '/settings/data/attention'],
      ['/trash', '/settings/data/trash'],
      ['/export', '/settings/data/export'],
      ['/inbox', '/settings/data/attention'],
    ] as const) {
      await ready(page, from);
      await expect(page).toHaveURL(new RegExp(`${to}$`));
    }
  });

  it('"Edit all places" is the bulk editor, and it says nothing retired', async ({ page }) => {
    await ready(page, '/places/edit');
    await expect(page.getByRole('heading', { name: /^Edit all places$/i })).toBeVisible();
    // §0.2 retired the scope words, and this screen's filter carried them longest — it
    // read "All · Just me · Just Josh · Together" as recently as item 4.
    const body = await page.locator('body').innerText();
    for (const word of ['Just me', 'Just Josh', 'Just Erica', 'Together', 'Both', 'Anyone']) {
      expect(body, `"${word}" is retired (§0.2) and is on /places/edit`).not.toMatch(
        new RegExp(`\\b${word}\\b`),
      );
    }
  });

  it('duplicates can be merged or kept apart', async ({ page }) => {
    await ready(page, '/duplicates');
    await expect(page.getByRole('heading', { name: /^Duplicate places$/i })).toBeVisible();
    // Both answers, because offering only "Merge" would make it a one-way door.
    await expect(page.getByRole('button', { name: /^Merge$/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /keep separate/i }).first()).toBeVisible();
  });

  it('the photo sorter is one door, and it is where she moved it', async ({ page }) => {
    await ready(page, '/photos/sort');
    await expect(page.getByRole('heading', { name: /^Sort photos into places$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /choose photos/i })).toBeVisible();
  });

  it('the smart albums render', async ({ page }) => {
    // ADDED AFTER A FALSE ALARM, which is why it exists. On one pass of a long sweep this
    // route came back as the error boundary — "Something went wrong. The app hit an
    // unexpected error." It was NOT reproducible: four further loads, three of them direct
    // and one repeating the exact sequence, all rendered `Smart albums` with zero page
    // errors, so it is recorded as unexplained and NOT as a defect. The check is here so
    // that if it ever is one, something says so.
    await ready(page, '/albums');
    await expect(page.getByRole('heading', { name: /^Smart albums$/i })).toBeVisible();
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
  });

  it('Wrapped is a year in travel, and the years are the control', async ({ page }) => {
    await ready(page, '/wrapped');
    await expect(page.getByRole('heading', { name: /Year in Travel/i })).toBeVisible();
    // A year to pick, not a fixed page.
    await expect(page.getByRole('button', { name: /^20\d\d$/ }).first()).toBeVisible();
  });

  it('Needs attention lists what is waiting, on its own destination', async ({ page }) => {
    await ready(page, '/settings/data/attention');
    await expect(page.getByRole('heading', { name: /^Needs attention$/i })).toBeVisible();
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
  });

  it('"Download everything you can take with you" — three formats and an archive', async ({
    page,
  }) => {
    await ready(page, '/settings/data/export');
    await expect(page.getByRole('heading', { name: /^Export & backup$/i })).toBeVisible();
    // The two that open somewhere else, and the one you keep.
    for (const fmt of ['CSV', 'GPX', 'KML']) {
      await expect(
        page.getByRole('button', { name: new RegExp(`^${fmt}$`) }).first(),
      ).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /build the archive/i })).toBeVisible();
  });

  it('the trash holds deletions for 30 days and gives them back', async ({ page }) => {
    await ready(page, '/settings/data/trash');
    await expect(page.getByRole('heading', { name: /^Trash$/i })).toBeVisible();
    await expect(page.getByText(/30 days/i)).toBeVisible();
  });
});
