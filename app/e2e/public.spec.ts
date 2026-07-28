import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

// Unauthenticated — runs anywhere, no secrets needed.
test.describe('public', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('body')).toBeVisible();
  });

  test('login page has no critical accessibility violations', async ({ page }) => {
    await page.goto('/login');
    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter((v) => v.impact === 'critical');
    expect(critical.map((v) => v.id)).toEqual([]);
  });

  test('unknown route redirects to the map (which gates to login)', async ({ page }) => {
    await page.goto('/no-such-page');
    // Not authenticated → RequireAuth bounces to /login.
    await expect(page).toHaveURL(/\/login/);
  });
});
