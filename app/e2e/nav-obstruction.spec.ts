import { authedTest as test, expect } from './fixtures';

// The floating bottom nav (`nav.primary-nav`) is `position: fixed` and paints above
// page content. Any scroll view whose last element is interactive must reserve
// `--pnav-clearance` at the bottom, or the nav silently covers that element and
// steals the tap.
//
// REGRESSION (2026-08-07, found on live production): the place card reserved only
// 40px while the nav's footprint is 62px (12px offset + 50px pill). On iPhone the
// primary "Log a visit" button was 91% covered and `elementFromPoint` at its centre
// returned the Add tab — so tapping "Log a visit" navigated to /add instead. The
// build was green and the button was `toBeVisible()`; only hit-testing caught it.
//
// This asserts the property rather than the single button: for every interactive
// element on the route, whatever is on top at its centre must be the element itself
// (or its own descendant) — never the nav.

// A live audit of production found the same defect on four MORE routes than the
// original place card: /health's GPX/KML/CSV export buttons were untappable on a
// phone, and /trips, /bucket and /timeline each had their last entry covered.
// All of them repeated the same inline page-wrapper style with zero bottom
// padding; they now share `.page`, which carries `--pnav-clearance`.
// `/settings` USED TO BE ON THIS LIST and is deliberately not any more.
//
// Erica, 2026-08-17: *"map places add timeline should not appear on the settings page"* —
// so `PrimaryNav` returns null there. Both tests below then assert something that is no
// longer true (`nav.primary-nav` visible, and a footprint > 0), and a route with no nav
// cannot be obstructed by one. Leaving it here would have failed the full browser matrix
// for a page that is now CORRECT.
//
// Rewritten to the newer instruction with the old one recorded, per the rule the
// acceptance list already follows — never silently deleted. The replacement assertion is
// in `app.spec.ts`: the nav has count 0 on /settings and is visible on /places, so its
// removal is still pinned, just from the other side.
//
// Worth stating because it is the reason this was missed: the /settings obstruction the
// plan tracked in §3 — `Celebrate Virginia`, `Mill Mountain Trail`, `Red Spring Gap`
// untappable — is GONE as a side effect of that change, measured on the live site with her
// data on 2026-08-17. Nothing else on the page is covered either.
const ROUTES = ['/', '/places', '/timeline', '/health', '/bucket', '/trash', '/albums'];

// Phone viewports are where the nav overlaps; desktop puts it out of the way.
const PHONE = { width: 390, height: 844 };

type Obstructed = { label: string; tag: string; cls: string; coveredBy: string };

test.describe('bottom nav must not obstruct interactive elements', () => {
  for (const route of ROUTES) {
    test(`no interactive element is covered by the nav on ${route}`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      await page.goto(route);
      await expect(page.locator('nav.primary-nav')).toBeVisible();
      // Let map/data render so late content is measured too.
      await page.waitForTimeout(1500);

      // A floating nav will always cover SOME mid-list element at SOME scroll
      // position — that is not a bug, because the user can scroll it out from
      // under. The property that actually matters is REACHABILITY: once scrolled
      // fully to the bottom, nothing may remain trapped under the nav. That is
      // exactly what `--pnav-clearance` buys, and exactly what was broken.
      await page.evaluate(() => {
        const scrollToEnd = (el: Element | Window) => {
          if (el === window) window.scrollTo(0, document.body.scrollHeight);
          else (el as Element).scrollTop = (el as Element).scrollHeight;
        };
        scrollToEnd(window);
        for (const el of document.querySelectorAll('*')) {
          const s = getComputedStyle(el);
          if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) {
            scrollToEnd(el);
          }
        }
      });
      await page.waitForTimeout(400);

      const obstructed: Obstructed[] = await page.evaluate(() => {
        const nav = document.querySelector('nav.primary-nav');
        if (!nav) return [];
        const hits: Obstructed[] = [];
        const els = document.querySelectorAll<HTMLElement>(
          'button, a[href], input, select, textarea, [role="button"]',
        );
        for (const el of els) {
          if (nav.contains(el)) continue; // the nav's own tabs are meant to be on top
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) continue;
          // Only consider elements actually inside the viewport.
          if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth)
            continue;
          const style = getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')
            continue;

          const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
          const cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
          const top = document.elementFromPoint(cx, cy);
          if (!top) continue;
          if (el.contains(top) || el === top) continue; // element owns its own centre
          if (!nav.contains(top)) continue; // covered by something else — not this test's concern

          hits.push({
            label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
            tag: el.tagName.toLowerCase(),
            cls: el.className?.toString().slice(0, 60) ?? '',
            coveredBy: (top as HTMLElement).className?.toString().slice(0, 40) ?? '',
          });
        }
        return hits;
      });

      expect(
        obstructed,
        `bottom nav covers ${obstructed.length} interactive element(s) on ${route}: ` +
          JSON.stringify(obstructed, null, 2),
      ).toEqual([]);
    });
  }

  // The load-bearing regression guard: content-independent, so it fails on a sparse
  // disposable dataset exactly as it would on Erica's full production data.
  test('page-ending containers reserve at least the nav height', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/places');
    await page.waitForTimeout(1200);

    const navFootprint = await page.evaluate(() => {
      const nav = document.querySelector('nav.primary-nav');
      if (!nav) return -1;
      // Distance from the top of the nav to the bottom of the viewport: everything
      // in that band is painted over.
      return Math.ceil(innerHeight - nav.getBoundingClientRect().top);
    });
    expect(navFootprint, 'nav.primary-nav not found').toBeGreaterThan(0);

    const measure = async (selector: string) =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return Math.floor(parseFloat(getComputedStyle(el).paddingBottom) || 0);
      }, selector);

    // FIXED 2026-08-28. This measured `.page` on /places — and since #153, /places
    // REDIRECTS into `/insights?tab=places`, whose shell is `.insights`. There was no
    // `.page` to measure, so the check reported "shell not rendered" and kept main red
    // from 08-23 while the clearance was in fact correct all along (`.insights` reserves
    // 96px + the safe area, more than the nav's footprint).
    //
    // It measures WHICHEVER shell the route actually rendered, so a future move of this
    // screen fails on the clearance rather than on the selector.
    const SHELLS = ['.insights', '.page'];
    let shell: number | null = null;
    let shellName = '';
    for (const sel of SHELLS) {
      const px = await measure(sel);
      if (px !== null) {
        shell = px;
        shellName = sel;
        break;
      }
    }
    expect(shell, `no scrolling shell rendered — looked for ${SHELLS.join(', ')}`).not.toBeNull();
    expect(
      shell!,
      `${shellName} reserves ${shell}px but the nav occupies ${navFootprint}px — whatever ends the page would be untappable`,
    ).toBeGreaterThanOrEqual(navFootprint);

    // Now open a place card and assert the same for the sheet.
    const first = page.locator('a[href^="/place/"]').first();
    if ((await page.locator('a[href^="/place/"]').count()) > 0) {
      await first.click();
      await expect(page.locator('.panel')).toBeVisible();
      const panel = await measure('.panel');
      expect(
        panel!,
        `.panel reserves ${panel}px but the nav occupies ${navFootprint}px — "Log a visit" would be untappable`,
      ).toBeGreaterThanOrEqual(navFootprint);
    }
  });

  // EVERY ROUTE'S OWN WRAPPER, not just `.page`.
  //
  // The test above is the load-bearing one and it measured exactly two elements: `.page`
  // on /places, and `.panel`. That is a real hole — a route that ships its own scrolling
  // wrapper was never measured AT ALL, and the routes above are only checked by the
  // content-dependent test, which needs enough rows to reach the bottom of the screen
  // before it can see anything.
  //
  // Found while chasing a red run on /settings, which turned out NOT to be a padding bug
  // (its inline 96px clears the 60px footprint, and 94px even on a notched phone). The
  // bug was the guard: it could not have told us either way, because it never looked.
  //
  // Content-independent on purpose, so it fails on an empty disposable database exactly
  // as it would on Erica's real data.
  for (const route of ROUTES) {
    test(`the scrolling wrapper on ${route} reserves the nav height`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      await page.goto(route);
      await page.waitForTimeout(1200);

      const result = await page.evaluate(() => {
        const nav = document.querySelector('nav.primary-nav');
        if (!nav) return { footprint: -1, worst: null as null | { sel: string; pad: number } };
        const footprint = Math.ceil(innerHeight - nav.getBoundingClientRect().top);

        // The element that ENDS the page: the last block-level container holding the
        // route's content. Measuring every candidate wrapper and taking the smallest
        // reserve is what stops a route hiding behind a well-padded sibling.
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>(
            'main > div, main > section, .page, .settings-page',
          ),
        ).filter((el) => {
          if (el.getBoundingClientRect().height <= innerHeight / 2) return false;
          const cs = getComputedStyle(el);
          // A VIEWPORT-PINNED PANE IS NOT A SCROLLING PAGE. `.map-root` is
          // `position: fixed; inset: 0` — the nav floating over the map is the design,
          // not an obstruction, and demanding bottom padding there would be demanding a
          // gap at the bottom of the map. The rule this file states is about SCROLL
          // VIEWS whose last element is interactive; this keeps it to those.
          if (cs.position === 'fixed' || cs.position === 'absolute') return false;
          // A pane that clips its own overflow cannot strand content under the nav
          // either — whatever is down there is unreachable for a different reason.
          if (cs.overflowY === 'hidden') return false;
          return true;
        });

        let worst: { sel: string; pad: number } | null = null;
        for (const el of candidates) {
          const pad = Math.floor(parseFloat(getComputedStyle(el).paddingBottom) || 0);
          const sel = el.className ? `.${String(el.className).split(' ')[0]}` : el.tagName;
          if (!worst || pad < worst.pad) worst = { sel, pad };
        }
        return { footprint, worst };
      });

      expect(result.footprint, 'nav.primary-nav not found').toBeGreaterThan(0);
      // A route may legitimately have no tall wrapper (a short page scrolls nowhere).
      if (!result.worst) return;

      expect(
        result.worst.pad,
        `${route}: ${result.worst.sel} reserves ${result.worst.pad}px but the nav occupies ` +
          `${result.footprint}px — whatever ends that container would be untappable`,
      ).toBeGreaterThanOrEqual(result.footprint);
    });
  }

  test('an open place card keeps its primary action clear of the nav', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/places');
    await page.waitForTimeout(1500);

    // Open the first place from the list, whatever the dataset contains.
    const firstPlace = page.locator('a[href^="/place/"]').first();
    const count = await page.locator('a[href^="/place/"]').count();
    test.skip(count === 0, 'No places in this dataset to open.');
    await firstPlace.click();

    const logVisit = page.locator('.log-visit-btn');
    await expect(logVisit).toBeVisible();
    await logVisit.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const clear = await page.evaluate(() => {
      const btn = document.querySelector('.log-visit-btn');
      const nav = document.querySelector('nav.primary-nav');
      if (!btn || !nav) return { ok: false, reason: 'missing button or nav' };
      const b = btn.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return {
        ok: !!top && (btn.contains(top) || btn === top),
        reason: top ? `covered by ${(top as HTMLElement).className}` : 'nothing at centre',
      };
    });
    expect(clear.ok, `"Log a visit" is not tappable: ${clear.reason}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AND NOTHING AT THE TOP OF A PHONE MAY COVER ANYTHING ELSE AT THE TOP.
// ---------------------------------------------------------------------------
// Found by an audit on 2026-08-21, screenshotting a 390×844 phone: the "On this day" banner
// sat straight on top of the Fog / Heat / None control. Both had been placed at
// `calc(84px + env(safe-area-inset-top))` by rules fifteen hundred lines apart — one written
// to dodge the crowded bottom of the screen, the other to dodge the stats bar at the top.
// Each was right about the collision it knew about; neither knew about the other.
//
// A CSS-text guard was written first and thrown away: it can only see the literal `84px`, and
// the next collision will be two different numbers that happen to overlap. This measures what
// is actually on top at the control's own centre point, which is the property that matters.
test.describe('the top of a phone is not double-booked', () => {
  test('the map layer control is tappable, not under the memory banner', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await page.waitForTimeout(2000);

    const control = page.locator('.layers-control');
    if ((await control.count()) === 0) test.skip(true, 'No layers control on this build.');

    const covered = await page.evaluate(() => {
      const el = document.querySelector('.layers-control');
      if (!el) return { ok: false, by: 'missing' };
      const r = el.getBoundingClientRect();
      // Every button in it, not just the pill: the banner covered Fog and Heat and left
      // None peeking out, which a single centre-point check would have called fine.
      const bad: string[] = [];
      for (const b of Array.from(el.querySelectorAll('button'))) {
        const br = b.getBoundingClientRect();
        const top = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
        if (!(top && (b.contains(top) || b === top))) {
          bad.push(
            `${b.textContent?.trim() || '?'} covered by ${(top as HTMLElement)?.className || 'nothing'}`,
          );
        }
      }
      return { ok: bad.length === 0, by: bad.join('; '), y: Math.round(r.top) };
    });

    expect(covered.ok, `layer control buttons are not tappable: ${covered.by}`).toBe(true);
  });
});
