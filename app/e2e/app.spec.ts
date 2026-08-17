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
    for (const label of [/^Map$/, /^Places$/, /^Add$/, /^Timeline$/]) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: /^Settings$/ })).toHaveCount(0);
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

  test('/add still renders, with its review queue', async ({ page }) => {
    await page.goto('/add');
    await expect(page.getByRole('heading', { name: 'Add', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /To review/ })).toBeVisible();
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
  test('the retired /inbox lands on Add', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page).toHaveURL(/\/add$/);
    await expect(page.getByRole('heading', { name: /To review/ })).toBeVisible();
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

  // The bottom nav does not follow you into Settings (Erica, 2026-08-17). Settings is
  // entered from the gear and leaves by its own back-bar; a destination bar under it is an
  // invitation to abandon a screen you are still reading.
  test('the bottom nav is not on Settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /settings/i }).first()).toBeVisible();
    await expect(page.locator('nav.primary-nav')).toHaveCount(0);
    // …and it is still there where it belongs.
    await page.goto('/places');
    await expect(page.locator('nav.primary-nav')).toBeVisible();
  });

  // Settings is ONE continuous page since 2026-08-11 — no tabs to click through.
  // Erica: "everything from account, connections, privacy, data, and advanced
  // should [be] extracted and added to one page... make it look like a seamless page."
  test('Settings is one page, with no tab bar to click through', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('.settings-tabs')).toHaveCount(0);
    // Things that used to live under four different tabs are all on the one page.
    await expect(page.getByRole('heading', { name: 'Manage data' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Data health' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
});
