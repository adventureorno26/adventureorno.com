// THE BOUNDARY, PROVED WITH TWO REAL ACCOUNTS.
//
// Everything else that proves the space boundary does it from inside the database:
// `0289`'s test sets `request.jwt.claims` in psql, `0293`'s does the same for writes. Those
// are the right tests and they must stay — but they answer "does Postgres refuse it", and
// what a person actually has is an HTTP client and a bearer token. STATE.md has carried
// "the partition has never been proved with two real accounts" as an open item since the
// fork. This is that proof, at the boundary a stranger would actually reach: PostgREST.
//
// ---------------------------------------------------------------------------
// WHY A `stranger` AND NOT A `viewer`
// ---------------------------------------------------------------------------
//
// owner/editor/viewer share ONE space and differ by what they may WRITE — §0286: roles
// govern writes, visibility belongs to the space boundary. A viewer proves nothing about
// the boundary, because they are inside it. The stranger is a perfectly valid account that
// is simply not in your space, which after `0289`/`0290`/`0293` is the only thing that
// decides what they may see or touch.
//
// ---------------------------------------------------------------------------
// COUNT THE ROWS, NEVER THE ABSENCE OF AN ERROR
// ---------------------------------------------------------------------------
//
// A PATCH or DELETE that RLS filters to nothing returns **200 with an empty array**. The
// first version of the ten-tables audit asked "did it error?", got "no" five times out of
// seven, and would have reported that a stranger could delete another person's profile.
// Every mutation below sends `Prefer: return=representation` and asserts on the LENGTH of
// what came back. And the owner runs the same calls first, so a zero means refused rather
// than "the filter matched nothing".
import { test, expect, getRoleToken, supabaseEnv, isLocalSupabase, type Role } from './fixtures';
import type { APIRequestContext } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const RUN = isLocalSupabase();
test.skip(
  !RUN,
  'The two-space boundary proof mutates rows, so it requires a LOCAL disposable Supabase stack.',
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

const rpc = (request: APIRequestContext, c: Ctx, fn: string, body: unknown) =>
  request.post(`${c.url}/rest/v1/rpc/${fn}`, { headers: headers(c), data: body });

/** A mutation that returns what it actually changed, so the assertion can count it. */
const mutate = (
  request: APIRequestContext,
  c: Ctx,
  method: 'patch' | 'delete',
  path: string,
  data?: unknown,
) =>
  request.fetch(`${c.url}/rest/v1/${path}`, {
    method,
    headers: headers(c, { Prefer: 'return=representation' }),
    ...(data ? { data } : {}),
  });

const RUN_ID = Date.now().toString(36);

let placeId = '';
let visitId = '';

test.describe('the boundary, with two real accounts', () => {
  test('the owner creates something of their own', async ({ request }, testInfo) => {
    const c = await ctx('owner');
    const res = await rpc(request, c, 'create_experience', {
      p_key: `e2e-2sp-${testInfo.project.name}-${RUN_ID}`,
      p_place: {
        name: `Two-space Fixture ${testInfo.project.name} ${RUN_ID}`,
        lat: 3.4567,
        lng: 4.5678,
        country: 'Testland',
        admin1: 'Test Region',
      },
      p_visit: { date: '2026-04-02', who: 'both' },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    placeId = body.place_id;
    visitId = body.visit_id;
    expect(
      placeId,
      'the fixture place must exist for anything below to mean anything',
    ).toBeTruthy();
    expect(visitId).toBeTruthy();
  });

  test('the owner can see and change it — so the zeros below mean refused', async ({ request }) => {
    const c = await ctx('owner');
    const read = await request.get(`${c.url}/rest/v1/places?id=eq.${placeId}&select=id`, {
      headers: headers(c),
    });
    expect((await read.json()).length, 'the owner reads their own place').toBe(1);

    const wrote = await mutate(request, c, 'patch', `places?id=eq.${placeId}`, {
      review: 'owner was here',
    });
    expect((await wrote.json()).length, 'the owner changes their own place').toBe(1);
  });

  test('a stranger cannot READ it — not the place, the visit, or its participants', async ({
    request,
  }) => {
    const c = await ctx('stranger');
    for (const [what, path] of [
      ['the place', `places?id=eq.${placeId}&select=id`],
      ['the visit', `visits?id=eq.${visitId}&select=id`],
      ['who was on it', `visit_profiles?visit_id=eq.${visitId}&select=visit_id`],
    ] as const) {
      const res = await request.get(`${c.url}/rest/v1/${path}`, { headers: headers(c) });
      expect(res.status(), await res.text()).toBe(200);
      expect((await res.json()).length, `a stranger must not read ${what}`).toBe(0);
    }
  });

  test('a stranger cannot WRITE it — counted, not merely un-errored', async ({ request }) => {
    const c = await ctx('stranger');

    const patched = await mutate(request, c, 'patch', `places?id=eq.${placeId}`, {
      name: 'STRANGER WAS HERE',
    });
    expect([200, 401, 403, 404]).toContain(patched.status());
    if (patched.status() === 200) {
      expect((await patched.json()).length, 'a stranger changed the place').toBe(0);
    }

    const deleted = await mutate(request, c, 'delete', `visits?id=eq.${visitId}`);
    expect([200, 401, 403, 404]).toContain(deleted.status());
    if (deleted.status() === 200) {
      expect((await deleted.json()).length, 'a stranger deleted the visit').toBe(0);
    }
  });

  test('a stranger calling edit_visit is refused by 0293, not merely filtered', async ({
    request,
  }) => {
    const c = await ctx('stranger');
    const res = await rpc(request, c, 'edit_visit', {
      p_id: visitId,
      p_start: '2019-01-01',
      p_end: '2019-01-02',
      p_notes: null,
      p_rating: null,
      p_who: null,
      p_segment: null,
    });
    // 0293 raises 42501 for a row outside your space. PostgREST maps that to 403 — and a
    // 404 is also a pass here, because the guard cannot fire on a row RLS never revealed.
    expect([403, 404], `a stranger got ${res.status()} from edit_visit`).toContain(res.status());
  });

  test('and the owner’s row is untouched by any of it', async ({ request }) => {
    const c = await ctx('owner');
    const res = await request.get(
      `${c.url}/rest/v1/places?id=eq.${placeId}&select=id,name,review`,
      { headers: headers(c) },
    );
    const rows = await res.json();
    expect(rows.length, 'the place still exists').toBe(1);
    expect(rows[0].name, 'the name a stranger tried to overwrite').not.toBe('STRANGER WAS HERE');
    expect(rows[0].review, 'the owner’s own change survived').toBe('owner was here');

    const v = await request.get(`${c.url}/rest/v1/visits?id=eq.${visitId}&select=id,start_date`, {
      headers: headers(c),
    });
    const vis = await v.json();
    expect(vis.length, 'the visit a stranger tried to delete still exists').toBe(1);
    expect(vis[0].start_date, 'and edit_visit did not rewrite its dates').not.toBe('2019-01-01');
  });
});
