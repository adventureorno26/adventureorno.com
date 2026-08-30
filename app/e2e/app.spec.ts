import { authedTest as test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

// Signed in as the test bot. NON-DESTRUCTIVE: these navigate and inspect the UI
// but never Save, so they don't write to the shared database. The full mutating
// acceptance flows (create place, log two visits, duplicate handling, upload
// retry) require a dedicated test tenant — tracked as a follow-up.
test.describe('authenticated app (non-destructive)', () => {
  test('primary navigation is present with all four tabs', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('nav.primary-nav');
    await expect(nav).toBeVisible();
    // FOUR tabs since 2026-08-11: Settings moved to the gear, because a pill and a
    // gear were two doors to the same page.
    //
    // ADD IS EXACT, and that is the point of the regex (Erica, 2026-08-16: "It should
    // just say Add"). It used to be /^Add( \d+)?$/ so the pending review count could
    // ride on the label; that count is gone from the pill and lives on /add, which is
    // the screen that can do something about it. Matching by prefix here would let it
    // creep back without failing anything.
    // THE FOUR CHANGED, 2026-08-22, and so did the last line. This asserted that Settings
    // was NOT in the nav — true while the nav was four places you could go that were not
    // Settings, and false now that Settings is one of the four. Kept as an assertion rather
    // than dropped: it now says Settings IS there, so the count still cannot drift.
    for (const label of [/^Map$/, /^Add$/, /^Insights$/, /^Settings$/]) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: /^Places$/ })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: /^Timeline$/ })).toHaveCount(0);
  });

  // A SMOKE TEST, DELIBERATELY THIN. The old test here required "Sort photos" and
  // "Import an activity file" to be ON this page; both moved to Settings today, so
  // it was asserting the opposite of the app and failing CI.
  //
  // It is not replaced with inverted assertions. Erica is reworking Add — it is due
  // to open a fillable card — and a test that pins down which buttons exist would
  // fight her on every change. This checks only that the page LOADS and the review
  // queue renders, so a genuinely broken Add is caught and a redesign is not.
  // STALE UNTIL 2026-08-16, and it could not have told anyone. This asserted that the
  // Add TAB links to /add and lands on the Add page. #94 changed it on 08-15 — the tab
  // is `to: '/?add=1'` and opens the blank card over the map, because ADD OPENS A
  // FILLABLE CARD (docs/STATE.md, Erica 2026-08-15). The assertions have been wrong
  // ever since and nothing went red: this file only runs in the nightly `Full browser
  // matrix`, and the nightly was failing in 7 seconds on GitHub billing.
  //
  // /add still exists and still renders — Settings links to it for importing and
  // sorting — so that is now checked directly rather than through the tab.
  test('the Add tab opens the blank card over the map', async ({ page }) => {
    await page.goto('/');
    const addTab = page.locator('nav.primary-nav').getByRole('link', { name: /^Add$/ });
    await expect(addTab).toHaveAttribute('href', '/?add=1');
    await addTab.click();

    await expect(page).toHaveURL(/[?&]add=1/);
    // "New place" — the card's own accessible name. The chooser it replaced was named
    // "Add", which is why every test still looking for that name failed on the locator.
    await expect(page.getByRole('dialog', { name: 'New place' })).toBeVisible();
  });

  // REWRITTEN 2026-08-28. It asserted a "To review" heading ON /add, and #134 moved the
  // queue OFF it: ONE VERB PER SCREEN — /add creates, /attention repairs. Erica had asked
  // where the pending cards were precisely because they sat on the page named after
  // creating. The old expectation is recorded rather than deleted, because a check that
  // quietly changes its mind is how you stop being able to tell a decision from a
  // regression. This is what kept main red from 08-23.
  test('/add creates, and points at the repairs rather than holding them', async ({ page }) => {
    await page.goto('/add');
    await expect(page.getByRole('heading', { name: 'Add', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Add a place, visit or activity/ }),
    ).toBeVisible();
    // The queue is NOT here. Asserted only after the screen above has rendered — a count
    // of zero proves nothing until there is something to count.
    await expect(page.getByRole('heading', { name: /To review/ })).toHaveCount(0);
  });

  // THE CHOOSER IS GONE, and this test was the last thing describing it. #94 replaced
  // AddSheet ("What are you adding?" plus three choices) with the blank fillable card,
  // because a chooser is the exact thing STATE.md said Add must not be. AddSheet is now
  // dead code — nothing imports it, and lockedCard.test.ts asserts MapView does not
  // render it — so every assertion below the first described a component that can no
  // longer reach the screen.
  test('the card still opens over the map, because picking a spot needs the map', async ({
    page,
  }) => {
    await page.goto('/add');
    await page.getByRole('button', { name: /Add a place, visit or activity/ }).click();

    const card = page.getByRole('dialog', { name: 'New place' });
    await expect(card).toBeVisible();
    // It opens FILLABLE, centred on wherever the map is — no question asked first.
    await expect(card.getByRole('textbox').first()).toBeVisible();
  });

  // Nothing is orphaned: the retired Inbox tab's URL still works.
  // REWRITTEN 2026-08-28, same cause. WAS: "/inbox lands on Add". #134 repointed it at
  // /attention, which is where the cards it used to hold actually live now.
  // The path moved with the 08-20 restructure: Needs attention is a section of Data &
  // Privacy now (/settings/data/attention), and /attention redirects there too.
  test('the retired /inbox lands on Needs attention', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page).toHaveURL(/\/attention$/);
  });

  // Same story as the chooser test above: this drove Photos -> "From this device" ->
  // Back -> the choice list, and none of those steps exist now. On the card, choosing
  // photos is a ROW, not a branch you navigate into and back out of.
  test('the card offers photos from this device, on the card itself', async ({ page }) => {
    await page.goto('/?add=1');
    const card = page.getByRole('dialog', { name: 'New place' });
    await expect(card).toBeVisible();
    // "Choose photos" is always there; the Google Photos button depends on the client
    // id being configured, which it is not in the e2e environment.
    await expect(card.getByRole('button', { name: 'Choose photos' })).toBeVisible();
  });

  // THE GUARD THAT WOULD HAVE CAUGHT THE TWO CRITICAL VIOLATIONS #94 SHIPPED: an
  // unlabelled <input type="date"> and an unlabelled <select>. It could not, because it
  // was looking for a dialog named "Add" and the card is named "New place", so it failed
  // on the locator before axe ever ran. A guard aimed at the wrong element reports
  // nothing about the right one.
  test('the new-place card has no critical accessibility violations', async ({ page }) => {
    await page.goto('/?add=1');
    await expect(page.getByRole('dialog', { name: 'New place' })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });

  // REWRITTEN 2026-08-28 to the approved navigation.
  //
  //   WAS (2026-08-17): "the bottom nav is not on Settings" — Erica: "map places add
  //   timeline should not appear on the settings page", and she was right, because none of
  //   those four WAS Settings, so the bar offered only ways to leave a screen she was
  //   still reading.
  //   NOW (2026-08-22, #153): the nav is `Map | Add | Insights | Settings`. Settings is one
  //   of the four, so the bar says where she IS rather than only where else to go. That
  //   reverses the older instruction rather than ignoring it, and it is recorded here.
  test('the nav is the approved four, and it includes the page it sits on', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /settings/i }).first()).toBeVisible();
    const tabs = await page.locator('nav.primary-nav a').allTextContents();
    expect(tabs.map((t) => t.trim())).toEqual(['Map', 'Add', 'Insights', 'Settings']);
  });

  // REWRITTEN 2026-08-30, and the reason is a RULING rather than a drift.
  //
  //   WAS (2026-08-11): "Settings is one page, with no tab bar to click through."
  //   Erica: "everything from account, connections, privacy, data, and advanced should
  //   [be] extracted and added to one page... make it look like a seamless page."
  //   NOW (2026-08-20, ruled definitive 2026-08-30): Settings has EXACTLY THREE
  //   destinations — Account | Integrations | Data & Privacy.
  //
  // Those two instructions contradicted each other and both were live in docs/STATE.md
  // until 2026-08-30, when Erica ruled for the 08-20 plan and retired the 08-11 "no
  // section labels" line by name. The old expectation is recorded rather than deleted.
  //
  // `.settings-tabs` STAYS PINNED AT ZERO: that class was the FIVE-tab bar 08-11
  // removed, its CSS is deleted, and nothing may bring it back. The three destinations
  // are `.settings-dests`, which is a different contract — and asserted, so this check
  // cannot pass against a Settings page that simply lost its navigation.
  test('Settings has exactly the three approved destinations', async ({ page }) => {
    await page.goto('/settings');
    // /settings is not itself a destination — it lands on Account.
    await expect(page).toHaveURL(/\/settings\/account$/);
    await expect(page.locator('.settings-tabs')).toHaveCount(0);
    const dests = await page.locator('.settings-dests a').allTextContents();
    expect(dests.map((t) => t.trim())).toEqual(['Account', 'Integrations', 'Data & Privacy']);
    // Identity is Account's, by the contract's own words.
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  // Nothing was dropped in the restructure: each destination still carries the cards
  // that used to sit under its heading on the one long page.
  test('every destination carries what moved into it', async ({ page }) => {
    await page.goto('/settings/account');
    await expect(page.getByRole('heading', { name: 'Map appearance' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();

    await page.goto('/settings/integrations');
    await expect(page.getByRole('heading', { name: /Strava/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Import history' })).toBeVisible();

    // Data & Privacy is ONE CONTINUOUS PAGE — the contract says so in as many words —
    // so every section is on it at once, not behind pills or sub-tabs.
    await page.goto('/settings/data');
    for (const heading of [
      /^Location$/,
      /^Sharing/,
      /^Messaging and event privacy$/,
      /^Needs attention$/,
      /^Your data$/,
    ]) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
    // A LINK, not a button — and it always was. Same shape as the "Import & sort photos"
    // correction recorded in erica-asked-for.spec.ts: asking for role=button asked for
    // something that was never there. Data health moved with the rest of Data Management.
    await page.goto('/settings/data/manage');
    await expect(page.getByRole('link', { name: 'Data health' })).toBeVisible();
  });

  // ONE VERB PER SCREEN (2026-08-20). Erica: "Needs Attention and Review Inbox are
  // redundant" — and worse, the cards lived on /add, the page named after CREATING, with
  // /inbox redirecting there. She asked where the pending cards were because they were
  // filed under the wrong verb.
  //
  //     /add                          create and import
  //     /settings/data/attention      repair            ← the cards
  //     /inbox, /attention            redirect there
  //
  // Pinned because it is exactly the kind of thing that drifts back: an embedded queue is
  // easy to drop onto whichever page someone is working on next.
  test('the review cards live on /attention, and /add only points at them', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page).toHaveURL(/\/attention/);

    // The queue itself renders here — not a link to somewhere else.
    await expect(page.locator('.attn-cards')).toHaveCount(1);

    await page.goto('/add');
    await expect(page.getByRole('heading', { name: /^Add$/ })).toBeVisible();
    // /add must not host the queue any more.
    await expect(page.locator('.attn-cards')).toHaveCount(0);
    await expect(page.locator('.inbox-card')).toHaveCount(0);
  });
});
