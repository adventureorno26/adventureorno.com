import { test, expect } from './fixtures';

// Layout assertions (Prompt 7, rec 48): no page should overflow horizontally at any
// target viewport — the classic source of a stray scrollbar / clipped content / the
// bottom nav sitting over pills. Runs on the PUBLIC login page so it executes in CI
// without the TEST_BOT secrets. (Authenticated-route overlap assertions need the
// dedicated test tenant — see the CI TODO in ci.yml.)
const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1440x900', width: 1440, height: 900 },
];

test.describe('layout — no horizontal overflow', () => {
  for (const v of VIEWPORTS) {
    test(`login has no horizontal overflow at ${v.name}`, async ({ page }) => {
      await page.setViewportSize({ width: v.width, height: v.height });
      await page.goto('/login');
      await expect(page.locator('body')).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      // Allow 1px for sub-pixel rounding.
      expect(scrollWidth, `horizontal overflow at ${v.name}`).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});
