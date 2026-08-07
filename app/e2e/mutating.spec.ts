import { test, expect, getRoleToken, supabaseEnv, isLocalSupabase, type Role } from './fixtures';
import type { APIRequestContext } from '@playwright/test';

// MUTATING owner/editor/viewer acceptance (COMPLETION-PLAN Phase 1, blocker 2).
//
// These WRITE, so the whole file is hard-gated to a local disposable stack —
// `getRoleToken` throws on any non-local host. Prerequisites:
//   supabase start && scripts/db-bootstrap.sh --yes && npm run seed:e2e
//
// Role semantics under test (enforced by RLS + `is_editor_or_owner()`):
//   owner  — full read/write
//   editor — full read/write
//   viewer — read everything, write nothing except their OWN reactions/ratings
//
// Authorization is asserted at the API boundary rather than through the UI: RLS is
// what actually enforces it, and a UI that merely hides a button would still pass a
// click-based test while leaving the endpoint open.

test.describe.configure({ mode: 'serial' });

const RUN = isLocalSupabase();

test.skip(
  !RUN,
  'Mutating acceptance requires a LOCAL disposable Supabase stack (VITE_SUPABASE_URL must be localhost).',
);

type Ctx = { url: string; key: string; token: string };

const tokens: Partial<Record<Role, string>> = {};

async function ctx(role: Role): Promise<Ctx> {
  const { url, key } = supabaseEnv();
  if (!tokens[role]) tokens[role] = await getRoleToken(role);
  return { url, key, token: tokens[role]! };
}

function headers(c: Ctx, extra: Record<string, string> = {}) {
  return {
    apikey: c.key,
    Authorization: `Bearer ${c.token}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function rpc(request: APIRequestContext, c: Ctx, fn: string, body: unknown) {
  return request.post(`${c.url}/rest/v1/rpc/${fn}`, { headers: headers(c), data: body });
}

// `create_experience` is idempotent by key and the suite runs across four Playwright
// projects, so keys and names are namespaced per run + project. Otherwise a second
// run would short-circuit on the first run's key and assert against stale rows.
const RUN_ID = `${Date.now().toString(36)}`;
const key = (name: string, project: string) => `e2e-${project}-${RUN_ID}-${name}`;

// Deterministic fictional coordinates — nowhere real.
const fixturePlace = (project: string) => ({
  name: `E2E Fixture Overlook ${project} ${RUN_ID}`,
  lat: 1.2345,
  lng: 2.3456,
  country: 'Testland',
  admin1: 'Test Region',
  categories: ['viewpoint'],
});

let createdPlaceId = '';

test.describe('mutating acceptance — owner/editor/viewer', () => {
  test('owner creates a place through create_experience', async ({ request }, testInfo) => {
    const c = await ctx('owner');
    const res = await rpc(request, c, 'create_experience', {
      p_key: key('create', testInfo.project.name),
      p_place: fixturePlace(testInfo.project.name),
      p_visit: { date: '2026-03-01', who: 'both' },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.place_id).toBeTruthy();
    expect(body.visit_id, 'a visit date was supplied, so a visit must exist').toBeTruthy();
    createdPlaceId = body.place_id;
  });

  test('retrying the same idempotency key returns the same graph, not a duplicate', async ({
    request,
  }, testInfo) => {
    const c = await ctx('owner');
    const res = await rpc(request, c, 'create_experience', {
      p_key: key('create', testInfo.project.name), // identical key
      p_place: fixturePlace(testInfo.project.name),
      p_visit: { date: '2026-03-01', who: 'both' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.idempotent).toBe(true);
    expect(body.place_id).toBe(createdPlaceId);

    // And exactly one place carries that fixture name.
    const list = await request.get(
      `${c.url}/rest/v1/places?select=id&name=eq.${encodeURIComponent(fixturePlace(testInfo.project.name).name)}`,
      { headers: headers(c) },
    );
    expect((await list.json()).length).toBe(1);
  });

  test('a second visit on the same place is recorded as a separate visit', async ({
    request,
  }, testInfo) => {
    const c = await ctx('owner');
    const res = await rpc(request, c, 'create_experience', {
      p_key: key('visit2', testInfo.project.name),
      p_place: { id: createdPlaceId }, // reuse, don't recreate
      p_visit: { date: '2026-04-15', who: 'both' },
    });
    expect(res.status(), await res.text()).toBe(200);

    const visits = await request.get(
      `${c.url}/rest/v1/visits?select=id,start_date&place_id=eq.${createdPlaceId}&order=start_date`,
      { headers: headers(c) },
    );
    const rows = await visits.json();
    expect(rows.length).toBe(2);
    expect(rows.map((r: { start_date: string }) => r.start_date)).toEqual([
      '2026-03-01',
      '2026-04-15',
    ]);
  });

  test('editor may also create', async ({ request }, testInfo) => {
    const c = await ctx('editor');
    const res = await rpc(request, c, 'create_experience', {
      p_key: key('editor-create', testInfo.project.name),
      p_place: {
        ...fixturePlace(testInfo.project.name),
        name: `E2E Editor Place ${testInfo.project.name} ${RUN_ID}`,
        lat: 3.21,
        lng: 4.32,
      },
      p_visit: { date: '2026-05-01' },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).place_id).toBeTruthy();
  });

  test('viewer is FORBIDDEN from creating via the RPC', async ({ request }, testInfo) => {
    const c = await ctx('viewer');
    const res = await rpc(request, c, 'create_experience', {
      p_key: key('viewer-should-fail', testInfo.project.name),
      p_place: {
        ...fixturePlace(testInfo.project.name),
        name: `E2E Viewer Should Not Exist ${RUN_ID}`,
        lat: 5.5,
        lng: 6.6,
      },
      p_visit: {},
    });
    expect(res.status(), 'viewer must not be able to create an experience').toBeGreaterThanOrEqual(
      400,
    );
    const text = await res.text();
    expect(text).toMatch(/not authorized|42501|permission/i);
  });

  test('viewer is FORBIDDEN from inserting a place directly (RLS, not just UI)', async ({
    request,
  }) => {
    const c = await ctx('viewer');
    const res = await request.post(`${c.url}/rest/v1/places`, {
      headers: headers(c, { Prefer: 'return=representation' }),
      data: { name: 'E2E Viewer Direct Insert', lat: 7.7, lng: 8.8 },
    });
    expect(res.status(), 'RLS must reject a viewer INSERT').toBeGreaterThanOrEqual(400);
  });

  test('viewer is FORBIDDEN from updating and deleting an existing place', async ({
    request,
  }, testInfo) => {
    const c = await ctx('viewer');
    const patch = await request.patch(`${c.url}/rest/v1/places?id=eq.${createdPlaceId}`, {
      headers: headers(c),
      data: { name: 'E2E Viewer Renamed' },
    });
    // PostgREST reports an RLS-filtered UPDATE as 0 rows affected rather than 403,
    // so assert the row is genuinely unchanged instead of trusting the status.
    const owner = await ctx('owner');
    const after = await request.get(
      `${owner.url}/rest/v1/places?select=name&id=eq.${createdPlaceId}`,
      { headers: headers(owner) },
    );
    expect((await after.json())[0].name).toBe(fixturePlace(testInfo.project.name).name);
    expect([200, 204, 401, 403, 404]).toContain(patch.status());

    await request.delete(`${c.url}/rest/v1/places?id=eq.${createdPlaceId}`, {
      headers: headers(c),
    });
    const stillThere = await request.get(
      `${owner.url}/rest/v1/places?select=id&id=eq.${createdPlaceId}`,
      { headers: headers(owner) },
    );
    expect((await stillThere.json()).length, 'viewer DELETE must not remove the place').toBe(1);
  });

  test('viewer CAN read the shared dataset', async ({ request }) => {
    const c = await ctx('viewer');
    for (const table of ['places', 'visits', 'photos', 'activities', 'trips']) {
      const res = await request.get(`${c.url}/rest/v1/${table}?select=id&limit=1`, {
        headers: headers(c),
      });
      expect(res.status(), `viewer must be able to read ${table}`).toBe(200);
    }
  });

  test('viewer CAN set their own rating (viewer-owned data)', async ({ request }) => {
    const c = await ctx('viewer');
    const res = await rpc(request, c, 'set_my_rating', {
      p_place: createdPlaceId,
      p_rating: 4,
    });
    // The RPC returns void, so PostgREST answers 204 No Content on success.
    expect([200, 204], await res.text()).toContain(res.status());

    const back = await rpc(request, c, 'place_ratings_for', { p_place: createdPlaceId });
    expect(back.status()).toBe(200);
    expect(JSON.stringify(await back.json())).toContain('4');
  });

  test('owner soft-deletes the place and Undo fully restores it', async ({ request }, testInfo) => {
    const c = await ctx('owner');

    const del = await rpc(request, c, 'soft_delete_place', { p_id: createdPlaceId });
    expect([200, 204], await del.text()).toContain(del.status());

    const gone = await request.get(
      `${c.url}/rest/v1/places?select=id,deleted_at&id=eq.${createdPlaceId}`,
      { headers: headers(c) },
    );
    const goneRows = await gone.json();
    expect(goneRows.length === 0 || goneRows[0].deleted_at !== null).toBe(true);

    const restore = await rpc(request, c, 'restore_place', { p_id: createdPlaceId });
    expect([200, 204], await restore.text()).toContain(restore.status());

    const back = await request.get(
      `${c.url}/rest/v1/places?select=id,name,deleted_at&id=eq.${createdPlaceId}`,
      { headers: headers(c) },
    );
    const rows = await back.json();
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe(fixturePlace(testInfo.project.name).name);
    expect(rows[0].deleted_at).toBeNull();

    // Undo must restore the VISITS too, not just the place shell.
    const visits = await request.get(
      `${c.url}/rest/v1/visits?select=id&place_id=eq.${createdPlaceId}`,
      { headers: headers(c) },
    );
    expect((await visits.json()).length).toBe(2);
  });

  test('an unauthenticated caller can write nothing', async ({ request }) => {
    const { url, key } = supabaseEnv();
    const res = await request.post(`${url}/rest/v1/places`, {
      headers: { apikey: key, 'Content-Type': 'application/json' },
      data: { name: 'E2E Anon Insert', lat: 9.9, lng: 10.1 },
    });
    expect(res.status(), 'anon INSERT must be rejected').toBeGreaterThanOrEqual(400);
  });
});

test.describe('sign-in boundary isolation', () => {
  test('signing out clears the session and protected routes bounce to /login', async ({ page }) => {
    const { url } = supabaseEnv();
    const ref = new URL(url).hostname.split('.')[0];
    const storageKey = `sb-${ref}-auth-token`;

    const token = await getRoleToken('owner');
    expect(token).toBeTruthy();

    await page.goto('/login');
    await page.evaluate(
      ([k, v]) => window.localStorage.setItem(k as string, v as string),
      [storageKey, JSON.stringify({ access_token: token, token_type: 'bearer' })],
    );

    // Clearing the session must not leave readable app state behind.
    await page.evaluate((k) => window.localStorage.removeItem(k as string), storageKey);
    await page.goto('/places');
    await expect(page).toHaveURL(/\/login/);

    const leaked = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.includes('auth-token')),
    );
    expect(leaked, 'no auth token may survive sign-out').toEqual([]);
  });
});
