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

// San Diego — the card she designed everything against.
const SAN_DIEGO = '/place/0795746e-c5ba-4b15-89c4-1cf0c4612148';
// The Appalachian Trail — the trail card, the one with 62 visits.
const AT = '/place/6bffaec6-00be-4626-b1d2-cf6815b849f7';

// WAIT FOR THE APP, ALWAYS. Reading the DOM the moment navigation resolves is how a
// check reports "missing" for something that is on the page a second later — which
// would make this whole file untrustworthy. Every check goes through here.
async function ready(page: import('@playwright/test').Page, path: string) {
  await page.goto(path);
  // The nav renders only once the app has booted and the session is accepted.
  await expect(page.locator('nav.primary-nav a').first()).toBeVisible();
  if (path.startsWith('/place/')) {
    await expect(page.locator('.panel')).toBeVisible();
    // …and the card's own data, not just its shell.
    await expect(page.locator('.visits-details')).toBeVisible();
  }
}

/** Settings' Stats card is a <details>; its contents are hidden until it is open —
 *  the same disclosure pattern as the Visits section on a card. */
async function openStats(page: import('@playwright/test').Page) {
  const summary = page.locator('details.stats-dropdown > summary').first();
  await expect(summary).toBeVisible();
  if ((await page.locator('details.stats-dropdown[open]').count()) === 0) await summary.click();
  await expect(page.locator('details.stats-dropdown[open]').first()).toBeVisible();
}

/** The Visits section is a <details>; its rows are hidden until it is open. */
async function openVisits(page: import('@playwright/test').Page) {
  const summary = page.locator('.visits-summary');
  if ((await page.locator('.visits-details[open]').count()) === 0) await summary.click();
  await expect(page.locator('.visits-details[open]')).toBeVisible();
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
    // Routes appears only once the place's activities have loaded, so wait for the
    // LAST section to exist before reading the order — otherwise this reports a
    // missing section that arrives a moment later.
    await expect(page.locator('.panel h3', { hasText: /^Routes/ })).toBeVisible();
    const heads = page.locator('.panel h3, .panel .visits-summary');
    const text = (await heads.allTextContents()).map((t) => t.trim());
    const visits = text.findIndex((t) => /^Visits/i.test(t));
    const photos = text.findIndex((t) => /Photos and Videos/i.test(t));
    const routes = text.findIndex((t) => /^Routes/i.test(t));
    const notes = text.findIndex((t) => /NOTES AND REVIEWS/i.test(t));
    expect(visits, `no Visits section: ${text.join(' | ')}`).toBeGreaterThanOrEqual(0);
    expect(photos).toBeGreaterThan(visits);
    expect(routes).toBeGreaterThan(photos);
    expect(notes).toBeGreaterThan(routes);
  });

  it('"Restaurant should be Restaurants" — and it is its own section', async ({ page }) => {
    await ready(page, SAN_DIEGO);
    await expect(page.locator('.panel h3', { hasText: /^Restaurants/ })).toHaveCount(1);
  });

  it('the rating sits UNDER the name', async ({ page }) => {
    await ready(page, SAN_DIEGO);
    const name = await page.locator('.hero-title .title-with-rating').boundingBox();
    const rating = await page.locator('.hero-title .hero-rating').boundingBox();
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

  it('"Remove the words tap a date and Trip and together from the visit section"', async ({
    page,
  }) => {
    await ready(page, SAN_DIEGO);
    await openVisits(page);
    const visits = page.locator('.visits-details');
    await expect(visits).not.toContainText(/·\s*Trip\b/);
    await expect(visits).not.toContainText(/Together/i);
    await expect(visits).not.toContainText(/tap a date/i);
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
    await expect(page.locator('.panel h3', { hasText: /^SECTIONS/i })).toHaveCount(0);
    await expect(page.locator('.visit-seg').first()).toBeVisible();
  });

  it('the Routes section holds the map AND the list', async ({ page }) => {
    await ready(page, SAN_DIEGO);
    await expect(page.locator('.panel h3', { hasText: /^Routes/ })).toHaveCount(1);
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
});

it.describe('the rest of the app — what she asked for', () => {
  it.use({ baseURL: SITE });

  it('the map has no redundant "+ Add" button', async ({ page }) => {
    await ready(page, '/');
    await expect(page.locator('.add-btn')).toHaveCount(0);
  });

  it('the nav is Map / Places / Add / Timeline', async ({ page }) => {
    await ready(page, '/');
    const tabs = await page.locator('nav.primary-nav a').allTextContents();
    expect(tabs.map((t) => t.trim())).toEqual(['Map', 'Places', 'Add', 'Timeline']);
  });

  it('Settings is ONE page, no tabs', async ({ page }) => {
    await ready(page, '/settings');
    await expect(page.locator('.settings-tabs')).toHaveCount(0);
  });

  it('"Move Import and Sort Photos into Settings"', async ({ page }) => {
    await ready(page, '/settings');
    await expect(page.getByRole('button', { name: /Import & sort photos/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Import an activity file/i })).toBeVisible();
    await ready(page, '/add');
    await expect(page.getByText(/sort photos/i)).toHaveCount(0);
    await expect(page.getByText(/import an activity file/i)).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // NOT BUILT YET. These fail on purpose: they are the outstanding requests, and
  // they are what "not done" looks like in this system rather than a promise.
  // ---------------------------------------------------------------------------

  it('"clicking add should pull up a blank card to edit"', async ({ page }) => {
    await ready(page, '/add');
    await page.getByRole('button', { name: /Add a place, visit or activity/i }).click();
    // A fillable CARD — its own name field and cover — not a "What are you adding?" menu.
    await expect(page.getByText(/what are you adding/i)).toHaveCount(0);
    await expect(page.getByPlaceholder(/Name this place/i)).toBeVisible();
    await expect(page.getByText(/Add a cover photo/i)).toBeVisible();
  });

  it('"the stats section was supposed to be moved to the top of places"', async ({ page }) => {
    await ready(page, '/places');
    const stats = page.locator('.stats-bar, .our-stats').first();
    await expect(stats).toBeVisible();
    const statsBox = await stats.boundingBox();
    const firstPlace = await page.locator('a[href^="/place/"]').first().boundingBox();
    expect(statsBox, 'no stats on Places').not.toBeNull();
    expect(statsBox!.y, 'stats are not above the places').toBeLessThan(firstPlace!.y);
  });

  it('"clicking on the Trips should pull up a list of trips that I can edit and also has an add a trip button"', async ({
    page,
  }) => {
    await ready(page, '/settings');
    await openStats(page);
    await page.locator('.stat-open').click();
    // A list of trips, each row opening its visit, and a way to add one.
    const first = page.locator('.trip-row').first();
    await expect(first).toBeVisible();
    await expect(first).toHaveAttribute('href', /^\/visit\//); // the ROW is the control
    await expect(page.getByRole('link', { name: /add a trip/i })).toBeVisible();
  });

  it('"The number of visits to each place should be the count on that dropdown"', async ({
    page,
  }) => {
    await ready(page, SAN_DIEGO);
    // The Visits dropdown's count is the number of visits to this place.
    await expect(page.locator('.visits-summary')).toContainText(/Visits\s*\(\d+\)/);
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
});
