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

  // The Add tab opens ONE sheet over the map. It replaced a five-step wizard at
  // /add that could add neither photos nor a Google Photos import, which is how
  // the app ended up with two different answers to "add something".
  test('Add tab opens the one add sheet, asking what you are adding', async ({ page }) => {
    await page.goto('/');
    const addTab = page.locator('nav.primary-nav').getByRole('link', { name: 'Add', exact: true });
    await expect(addTab).toHaveAttribute('href', '/?add=1');
    await addTab.click();

    const sheet = page.getByRole('dialog', { name: 'Add' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('What are you adding?')).toBeVisible();
    for (const choice of ['Photos', 'A place I’ve been', 'Somewhere to go later']) {
      await expect(sheet.getByRole('button', { name: choice, exact: true })).toBeVisible();
    }
    // Three choices and a close button — nothing else to wade through.
    await expect(sheet.locator('.add-choices button')).toHaveCount(3);
  });

  test('the retired /add wizard redirects to the sheet', async ({ page }) => {
    await page.goto('/add');
    await expect(page).toHaveURL(/\/($|\?)/);
    await expect(page.getByRole('dialog', { name: 'Add' })).toBeVisible();
  });

  test('Photos is the one home for both device and Google Photos imports', async ({ page }) => {
    await page.goto('/?add=1');
    const sheet = page.getByRole('dialog', { name: 'Add' });
    await sheet.getByRole('button', { name: 'Photos', exact: true }).click();
    // "From this device" is always there; the Google option depends on the client
    // id being configured, which it is not in the e2e environment.
    await expect(sheet.getByRole('button', { name: 'From this device' })).toBeVisible();
    await sheet.getByRole('button', { name: /Back/ }).click();
    await expect(sheet.getByRole('button', { name: 'A place I’ve been' })).toBeVisible();
  });

  test('the add sheet has no critical accessibility violations', async ({ page }) => {
    await page.goto('/?add=1');
    await expect(page.getByRole('dialog', { name: 'Add' })).toBeVisible();
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
