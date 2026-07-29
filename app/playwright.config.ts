import { defineConfig, devices } from '@playwright/test';

// E2E harness. Tests run against a built preview of the app. Auth uses a test-bot
// session injected into localStorage (see e2e/fixtures.ts); flows that would
// MUTATE data are gated behind a real test tenant and are opt-in — the default
// suite is non-destructive (renders, navigation, wizard steps without saving,
// keyboard, and axe-core accessibility scans) so it never touches the shared
// household database.
const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-safari', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-iphone', use: { ...devices['iPhone 13'] } },
    { name: 'mobile-android', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
