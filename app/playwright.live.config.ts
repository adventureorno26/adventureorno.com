import { defineConfig, devices } from '@playwright/test';

// THE LIVE CHECK. This config points Playwright at the REAL SITE — no dev server, no
// preview build, no localhost. It runs one file: e2e/erica-asked-for.spec.ts, which is
// the list of what Erica asked for.
//
// Erica, 2026-08-11: "I want you to stop fucking around and set up a build system that
// ensures that what I ask for is built and live before moving forward."
//
//   npm run verify:live
//
// A request counts as done when its check is green HERE. Not when it is committed, not
// when a deploy says success, and not when I say so.
//
// One browser on purpose: this answers "is it on the site", not "does it work in
// Safari" — the four-browser suite in playwright.config.ts still does that.
const LIVE = process.env.LIVE_URL ?? 'https://adventureorno.com';

export default defineConfig({
  testDir: './e2e',
  testMatch: /erica-asked-for\.spec\.ts/,
  // The live site does real network work — geocoding, tiles, photos — so give it room.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // ONE AT A TIME. Run in parallel and several workers hammer the live site at once —
  // the panel and its data arrive late, checks fail, and the report says a thing is
  // missing when it is on the page. A verification system that cries wolf is worse
  // than none, so this trades a minute of wall-clock for a result that can be trusted.
  fullyParallel: false,
  workers: 1,
  // Never retry: a check that only passes on the second go is not something to report
  // as live.
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: LIVE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'live', use: { ...devices['Desktop Chrome'] } }],
});
