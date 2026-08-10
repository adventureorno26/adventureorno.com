import { authedTest as test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

// Axe across the AUTHENTICATED routes (COMPLETION-PLAN Phase 4). The pre-existing
// coverage only scanned /login and /add, so the app's single largest accessibility
// defect went unnoticed: every row checkbox on /places was unlabelled — 183 rows,
// 366 nodes across viewports, all announced as a bare "checkbox" to a screen
// reader, driving a BULK tag/untag where picking the wrong one is destructive.
//
// Policy:
//   * CRITICAL violations fail. There are none today and there should never be.
//   * SERIOUS violations fail unless the rule is listed in ACCEPTED_SERIOUS with a
//     reason. That list is deliberately tiny and every entry is a decision, not a
//     shrug — see the note on color-contrast below.

// '/?add=1' opens the add sheet over the map — Add is a sheet, not a page, so
// this is how that surface gets scanned now.
const ROUTES = [
  '/',
  '/places',
  '/timeline',
  '/?add=1',
  '/settings',
  '/health',
  '/bucket',
  // The review queue. New surface, and the one with the most controls per card:
  // radio groups, a free-text alternative, per-option "Never", and photo checkboxes.
  '/inbox',
];

// Phone and desktop. The full seven-viewport sweep lives in layout.spec.ts; axe
// findings are overwhelmingly viewport-independent, so two shapes catch the
// responsive-only cases without octupling the runtime.
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];

/**
 * Serious rules accepted for now, each with a reason. A rule may only sit here
 * because someone decided it should — never because it was easier than fixing it.
 */
const ACCEPTED_SERIOUS: Record<string, string> = {
  // EMPTY, and that is the point.
  //
  // The old entry was a rule-wide allowance for color-contrast, left in place with a
  // note to "retire it once a run is green without it". That day came: Erica asked for
  // the active tab to carry the bright accent fill, which put white on #3b82f6 at
  // 12-13px — 3.68:1, below the 4.5:1 AA needs — and axe flagged it on every
  // authenticated page. Rather than widen the allowance, the pill now uses
  // --accent-strong (#2563eb, 5.17:1); --accent is unchanged everywhere else.
  //
  // A rule-wide allowance also hides unrelated findings, which is exactly what it did
  // here: the same rule id would have swallowed any new contrast bug anywhere in the
  // app. Verified green across /login, /inbox, /timeline, /places and /settings with
  // nothing accepted. Add an entry back only for a decision, never for convenience.
};

test.describe('accessibility — authenticated routes', () => {
  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`no critical/unaccepted-serious axe violations on ${route} @${vp.name}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(route);
        // A redirect to /login would scan the login shell and report a false pass.
        await expect(page).not.toHaveURL(/\/login/);
        await page.waitForTimeout(1500);

        const results = await new AxeBuilder({ page }).analyze();

        const critical = results.violations.filter((v) => v.impact === 'critical');
        const serious = results.violations.filter(
          (v) => v.impact === 'serious' && !(v.id in ACCEPTED_SERIOUS),
        );

        const describe = (v: (typeof results.violations)[number]) =>
          `${v.impact} ${v.id} (${v.nodes.length} node(s)): ${v.help} — first: ${v.nodes[0]?.target?.join(' ')}`;

        expect(
          critical.map(describe),
          `critical accessibility violations on ${route} @${vp.name}`,
        ).toEqual([]);
        expect(
          serious.map(describe),
          `unaccepted serious accessibility violations on ${route} @${vp.name}`,
        ).toEqual([]);
      });
    }
  }

  test('every place row checkbox is distinguishable by name', async ({ page }) => {
    // The specific regression: a bulk-destructive control that a screen reader
    // could not tell apart. Asserted directly so it cannot silently return even
    // if the axe rule set changes.
    await page.goto('/places');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForTimeout(1500);

    const boxes = page.locator('.place-row input[type="checkbox"]');
    const count = await boxes.count();
    test.skip(count === 0, 'No places in this dataset (or the user cannot edit).');

    const unnamed = await page.evaluate(
      () =>
        [...document.querySelectorAll('.place-row input[type="checkbox"]')].filter((el) => {
          const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
          const wrapped = el.closest('label');
          return !aria && !wrapped;
        }).length,
    );
    expect(unnamed, 'place-row checkboxes without an accessible name').toBe(0);

    // Each name must also be non-empty and carry the row's place name, so the
    // control is identifiable rather than just technically labelled. Names are NOT
    // asserted to be globally unique — two real places can share a name.
    const labels: string[] = await page.evaluate(() =>
      [...document.querySelectorAll('.place-row input[type="checkbox"]')].map(
        (el) => el.getAttribute('aria-label') || '',
      ),
    );
    expect(
      labels.filter((l) => !l.trim()),
      'checkboxes with an empty label',
    ).toEqual([]);
    expect(
      labels.every((l) => /^Select .+/.test(l)),
      'every label should read "Select <place name>"',
    ).toBe(true);
  });
});
