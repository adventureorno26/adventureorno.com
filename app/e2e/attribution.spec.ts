// WHEREVER THERE IS A MAP, THERE IS A CREDIT — visible, without interaction.
//
// The tiles are built from OpenStreetMap data under ODbL, so the credit is a condition of
// using the DATA. Self-hosting changed who serves the bytes and who bills us; it changed
// nothing about this. The OSMF guideline is specific: legible without interaction, in a
// corner of the map or adjacent to it, with a route to the origin and licence.
//
// THIS TEST EXISTS BECAUSE THE CREDIT WAS DELIBERATELY MADE QUIET. Erica asked for it to
// be less visible (2026-08-17) and it now renders at 10-11px in --muted, which is allowed
// — size and colour are ours, the floor is not. But "quiet" and "gone" are one small edit
// apart, and the edit that crosses the line looks exactly like the edits that did not.
//
// Two ways to satisfy it, both accepted by the guideline:
//   * MapLibre's own attribution control on the map (the big maps), or
//   * one `.osm-credit` line on the page (components/OsmCredit.tsx) — Erica, 2026-08-17:
//     "once at the page level". A control inside a 120px route map is most of the map.
//
// It asserts VISIBILITY, not presence. A credit in the DOM behind `display: none` is the
// failure mode the guideline names, and `toBeVisible()` is the difference.
import { authedTest as test, expect } from './fixtures';

// WHY THERE IS NO "every map route has a credit" TEST IN THIS FILE.
//
// There was one, and it failed on / and /bucket for a reason worth writing down: the map's
// own credit is supplied BY THE BASEMAP STYLE, and the style does not load in the test
// environment. The canvas mounts, no source resolves, MapLibre has no attribution to show,
// and the assertion failed while production was perfectly correct.
//
// A test that cannot see the thing it judges is the shape this repository keeps getting
// caught by. So the split is deliberate:
//
//   * HERE — the credit that is OURS and always in the DOM: the page-level `.osm-credit`.
//   * e2e/erica-asked-for.spec.ts — the MAP's credit, checked against adventureorno.com
//     where the real style loads. Attribution compliance is a fact about the live site.

test.describe('OpenStreetMap attribution', () => {
  // The place card is its own case: on a phone it COVERS the main map, so the map's own
  // chip is off screen while `RouteMiniMap` keeps drawing OSM tiles inside the card.
  test('the place card carries its own credit, because on a phone it covers the map', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/places');
    await page.waitForTimeout(1500);

    const first = page.locator('a[href^="/place/"]').first();
    if ((await page.locator('a[href^="/place/"]').count()) === 0) return;
    await first.click();
    await expect(page.locator('.panel')).toBeVisible();

    const credit = page.locator('.panel .osm-credit');
    await expect(
      credit,
      'the card draws OpenStreetMap tiles in RouteMiniMap and hides the map behind itself',
    ).toHaveCount(1);
    await credit.scrollIntoViewIfNeeded();
    await expect(credit).toBeVisible();
  });
});
