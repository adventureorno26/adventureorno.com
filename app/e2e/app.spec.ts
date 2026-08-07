import { authedTest as test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

// Signed in as the test bot. NON-DESTRUCTIVE: these navigate and inspect the UI
// but never Save, so they don't write to the shared database. The full mutating
// acceptance flows (create place, log two visits, duplicate handling, upload
// retry) require a dedicated test tenant — tracked as a follow-up.
test.describe('authenticated app (non-destructive)', () => {
  test('primary navigation is present with all five tabs', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('nav.primary-nav');
    await expect(nav).toBeVisible();
    for (const label of ['Map', 'Places', 'Add', 'Timeline', 'More']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
  });

  test('Add tab opens the guided wizard at step 1 of 5', async ({ page }) => {
    await page.goto('/');
    await page.locator('nav.primary-nav').getByRole('link', { name: 'Add', exact: true }).click();
    await expect(page).toHaveURL(/\/add/);
    await expect(page.getByText(/1 of 5/)).toBeVisible();
    await expect(page.getByText('Where?')).toBeVisible();
  });

  test('Add wizard search is keyboard-operable and handles no matches', async ({ page }) => {
    await page.goto('/add');
    const search = page.getByPlaceholder(/Start typing a place name/i);
    await expect(search).toBeFocused(); // autoFocus
    await search.fill('zzz-definitely-not-a-real-place');
    // No matches, no crash — Continue stays disabled until a place is chosen.
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  test('Add wizard has no critical accessibility violations', async ({ page }) => {
    await page.goto('/add');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });

  test('Settings groups maintenance tools under "Manage data"', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Manage data' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Data health' })).toBeVisible();
  });
});
