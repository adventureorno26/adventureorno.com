import { test as base, expect } from '@playwright/test';

// Auth for e2e without magic links: a password grant for a dedicated TEST BOT
// account, injected into localStorage before the app boots so the Supabase
// client picks it up. Requires these env vars (CI secrets / local shell):
//   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, TEST_BOT_EMAIL, TEST_BOT_PASSWORD
// When any are missing, `authedTest` SKIPS rather than failing — so the
// non-destructive public suite still runs (e.g. in forks without secrets).

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const EMAIL = process.env.TEST_BOT_EMAIL;
const PASSWORD = process.env.TEST_BOT_PASSWORD;

export const hasAuthEnv = Boolean(URL && KEY && EMAIL && PASSWORD);

async function getSession(): Promise<unknown> {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Test-bot sign-in failed (${res.status})`);
  return res.json();
}

function projectRef(url: string): string {
  return new URL(url).host.split('.')[0];
}

// A page that is already signed in as the test bot.
export const authedTest = base.extend({
  page: async ({ page, context }, use) => {
    if (!hasAuthEnv) {
      base.skip(true, 'Set TEST_BOT_* + VITE_SUPABASE_* to run authenticated e2e.');
      await use(page);
      return;
    }
    const session = await getSession();
    const storageKey = `sb-${projectRef(URL!)}-auth-token`;
    await context.addInitScript(
      ([k, v]) => {
        window.localStorage.setItem(k as string, v as string);
      },
      [storageKey, JSON.stringify(session)],
    );
    await use(page);
  },
});

export const test = base;
export { expect };
