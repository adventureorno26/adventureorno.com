import { test as base, expect } from '@playwright/test';

// Auth for e2e without magic links: a password grant, injected into localStorage
// before the app boots so the Supabase client picks it up.
//
// TWO fixture families:
//
//  * `authedTest` — a single TEST BOT account, used for NON-DESTRUCTIVE checks that
//    may run against a shared/hosted database. Needs TEST_BOT_EMAIL/PASSWORD.
//
//  * `roleTest` — deterministic fictional OWNER / EDITOR / VIEWER identities seeded
//    by `scripts/seed-e2e-users.mjs`. These back the MUTATING acceptance flows, so
//    they are hard-gated to a LOCAL Supabase host: pointing them at a hosted project
//    would write into real household data. See `mutating.spec.ts`.
//
// CI sets REQUIRE_AUTH_E2E=true, which turns a missing fixture into a hard failure
// so a green canonical run can never hide skipped authenticated coverage.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const EMAIL = process.env.TEST_BOT_EMAIL;
const PASSWORD = process.env.TEST_BOT_PASSWORD;

export const hasAuthEnv = Boolean(SUPABASE_URL && KEY && EMAIL && PASSWORD);
const requireAuth = process.env.REQUIRE_AUTH_E2E === 'true';

if (requireAuth && !hasAuthEnv) {
  throw new Error(
    'REQUIRE_AUTH_E2E=true but VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, TEST_BOT_EMAIL, or TEST_BOT_PASSWORD is missing.',
  );
}

export type Role = 'owner' | 'editor' | 'viewer';

const ROLE_CREDS: Record<Role, { email: string; password: string }> = {
  owner: {
    email: process.env.TEST_OWNER_EMAIL || 'owner.e2e@example.invalid',
    password: process.env.TEST_OWNER_PASSWORD || 'Local-E2E-owner-2026!',
  },
  editor: {
    email: process.env.TEST_EDITOR_EMAIL || 'editor.e2e@example.invalid',
    password: process.env.TEST_EDITOR_PASSWORD || 'Local-E2E-editor-2026!',
  },
  viewer: {
    email: process.env.TEST_VIEWER_EMAIL || 'viewer.e2e@example.invalid',
    password: process.env.TEST_VIEWER_PASSWORD || 'Local-E2E-viewer-2026!',
  },
};

/** True only when VITE_SUPABASE_URL points at a local disposable stack. */
export function isLocalSupabase(): boolean {
  if (!SUPABASE_URL) return false;
  try {
    return ['127.0.0.1', 'localhost', '::1'].includes(new URL(SUPABASE_URL).hostname);
  } catch {
    return false;
  }
}

async function signIn(email: string, password: string): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Sign-in failed for ${email} (${res.status})`);
  return res.json();
}

function projectRef(url: string): string {
  return new URL(url).hostname.split('.')[0];
}

function storageKeyFor(url: string): string {
  // The local stack's URL has no project ref in the hostname; supabase-js derives
  // the key from the ref segment, which is `127` for 127.0.0.1. Match whatever the
  // client will actually look up rather than hard-coding the hosted ref.
  return `sb-${projectRef(url)}-auth-token`;
}

// `BrowserContext`, not a hand-written shape. The structural one did not actually
// accept a real context — `addInitScript` is generic — and nothing noticed, because
// until 2026-08-22 `e2e/` was typechecked by nothing at all.
async function injectSession(
  context: import('@playwright/test').BrowserContext,
  session: unknown,
): Promise<void> {
  await context.addInitScript(
    ([k, v]: [string, string]) => {
      window.localStorage.setItem(k, v);
    },
    // The tuple type has to be written down: inferred, the argument widens to `string[]`
    // and no longer matches the destructuring pair the browser side expects.
    [storageKeyFor(SUPABASE_URL!), JSON.stringify(session)] as [string, string],
  );
}

// A page already signed in as the shared test bot (non-destructive use only).
export const authedTest = base.extend({
  page: async ({ page, context }, use) => {
    if (!hasAuthEnv) {
      base.skip(true, 'Set TEST_BOT_* + VITE_SUPABASE_* to run authenticated e2e.');
      await use(page);
      return;
    }
    await injectSession(context, await signIn(EMAIL!, PASSWORD!));
    await use(page);
  },
});

// ---------------------------------------------------------------------------
// A session WITHOUT a password, for the live check.
//
// `verify:live` has to sign in as the test bot against production, and there is no
// TEST_BOT_PASSWORD in .env.local — nor should the live check depend on one existing.
// Supabase's admin API can mint a one-time link for an account, and that link's token
// exchanges for a real session. The service key never leaves this Node process; only
// the resulting session is put in the browser.
//
// It reads SUPABASE_SECRET_KEY (the current key — AON_SUPABASE_SECRET_KEY is the
// disabled legacy JWT, see docs/STATE.md §8).
const SECRET = process.env.SUPABASE_SECRET_KEY;
const BOT_EMAIL = process.env.TEST_BOT_EMAIL ?? 'testbot@adventureorno.dev';

export const canMintSession = Boolean(SUPABASE_URL && KEY && SECRET);

async function mintSession(email: string): Promise<unknown> {
  const gen = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: SECRET!,
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!gen.ok) throw new Error(`Could not mint a link for ${email} (${gen.status})`);
  const link = (await gen.json()) as { hashed_token?: string };
  if (!link.hashed_token) throw new Error('generate_link returned no token');

  const res = await fetch(`${SUPABASE_URL}/auth/v1/verify?type=magiclink`, {
    method: 'POST',
    headers: { apikey: KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
  });
  if (!res.ok) throw new Error(`Could not exchange the link for a session (${res.status})`);
  return res.json();
}

/** A page signed in as the test bot, with no password needed. Read-only use. */
export const liveTest = base.extend({
  page: async ({ page, context }, use) => {
    if (!canMintSession) {
      throw new Error(
        'verify:live needs VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and ' +
          'SUPABASE_SECRET_KEY. They are in .env.local; `npm run verify:live` loads it.',
      );
    }
    await injectSession(context, await mintSession(BOT_EMAIL));
    await use(page);
  },
});

/**
 * A page signed in as a specific seeded role. MUTATING — refuses to run against a
 * non-local Supabase host so these can never write to household data.
 */
export const roleTest = base.extend<{ signInAs: (role: Role) => Promise<void> }>({
  signInAs: async ({ context }, use) => {
    await use(async (role: Role) => {
      if (!SUPABASE_URL || !KEY) {
        throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required.');
      }
      if (!isLocalSupabase()) {
        throw new Error(
          `Refusing to run mutating e2e against a non-local Supabase host: ${SUPABASE_URL}. ` +
            'Start the disposable stack (supabase start + scripts/db-bootstrap.sh + npm run seed:e2e).',
        );
      }
      const { email, password } = ROLE_CREDS[role];
      await injectSession(context, await signIn(email, password));
    });
  },
});

/** Supabase REST base + anon key, for direct API authorization assertions. */
export function supabaseEnv(): { url: string; key: string } {
  if (!SUPABASE_URL || !KEY) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required.');
  }
  return { url: SUPABASE_URL, key: KEY };
}

/**
 * Access token for a seeded role. Local-only, same guard as `roleTest` — these
 * tokens are used to attempt writes, so they must never point at a hosted project.
 */
export async function getRoleToken(role: Role): Promise<string> {
  if (!isLocalSupabase()) {
    throw new Error(
      `Refusing to mint a mutating role token against a non-local Supabase host: ${SUPABASE_URL}.`,
    );
  }
  const { email, password } = ROLE_CREDS[role];
  const session = (await signIn(email, password)) as { access_token?: string };
  if (!session.access_token) throw new Error(`No access_token returned for ${role}.`);
  return session.access_token;
}

export const test = base;
export { expect };
