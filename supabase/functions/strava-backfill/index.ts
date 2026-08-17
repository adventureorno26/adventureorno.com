// strava-backfill — pull historical activities for a date range, one page per
// invocation so the SPA can show progress and pace itself under Strava's rate
// limit (100 req / 15 min). Every activity with a start point is ingested.
//
// verify_jwt = true — owner only.
// Body: { after?: unix, before?: unix, page?: 1, athlete?: number, perPage?: 1..100 }.
// Response: { processed, stored, skipped, page, hasMore, failed }.
// Deploy: supabase functions deploy strava-backfill
//
// WHY THE BATCH IS SMALL AND SCOPEABLE, decided by a measurement rather than by taste.
// Josh's first backfill fetched a 100-activity page for EVERY connected athlete in one
// invocation. Each activity costs ~5 round trips (place_for_activity, the naming reads,
// recompute_place_stats, rebuild_place_visits, recordStravaSource), so two athletes was
// ~1,000 sequential calls in one function — it timed out at 150s on page 1, and re-running
// it later returned WORKER_RESOURCE_LIMIT three times in a row. 28 of his 93 activities
// were missing as a result, and the pager reported success.
//
//   `athlete`  scopes a run to one connected athlete. Paging across several at once was
//              never meaningful anyway: page 3 of a 93-activity athlete and page 3 of a
//              184-activity one are unrelated, so one athlete's end forced the other's.
//   `perPage`  bounds the work per invocation. 50 is the default because it halves the
//              round trips while still finishing a full history in a handful of calls.
//
// A page that cannot finish is worse than a page that is small, because the caller cannot
// tell a timeout from an empty result.

import {
  adminClient,
  getAllAccounts,
  getValidAccessTokenFor,
  ingestActivity,
  type StravaActivity,
} from '../_shared/strava.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY =
  Deno.env.get('AON_SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
const DEFAULT_PER_PAGE = 50;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}

function jwtRole(jwt: string): string | null {
  try {
    return JSON.parse(atob(jwt.split('.')[1])).role ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const admin = adminClient();

  // Owner-only.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!jwt) return json({ error: 'unauthenticated' }, 401);
  if (jwtRole(jwt) !== 'service_role') {
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await asCaller.auth.getUser();
    if (!user) return json({ error: 'invalid session' }, 401);
    const { data: prof } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (prof?.role !== 'owner') return json({ error: 'owner required' }, 403);
  }

  let body: {
    after?: number;
    before?: number;
    page?: number;
    athlete?: number;
    perPage?: number;
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const page = Math.max(1, body.page ?? 1);
  const perPage = Math.min(100, Math.max(1, Math.trunc(body.perPage ?? DEFAULT_PER_PAGE)));

  try {
    let accounts = await getAllAccounts(admin);
    if (accounts.length === 0) return json({ error: 'no connected Strava account' }, 400);
    if (body.athlete != null) {
      accounts = accounts.filter((a) => a.athlete_id === body.athlete);
      // Say so rather than returning an empty success — an unknown athlete id that
      // silently processes nothing reads exactly like "there was nothing to fetch".
      if (accounts.length === 0) return json({ error: 'athlete not connected' }, 404);
    }

    // Backfill the same page for EVERY connected athlete (Erica + Josh), tagging
    // each activity with whose it is. hasMore is true if any account has more.
    let processed = 0;
    let stored = 0;
    let skipped = 0;
    let hasMore = false;
    // Athletes whose page could NOT be fetched this run — reported so the caller can
    // retry the page rather than silently losing that athlete's activities.
    const failed: number[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    for (const acct of accounts) {
      const params = new URLSearchParams({ per_page: String(perPage), page: String(page) });
      if (body.after) params.set('after', String(body.after));
      if (body.before) params.set('before', String(body.before));

      // Fetch the page with bounded backoff on transient (5xx / network) errors.
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const access = await getValidAccessTokenFor(admin, acct.athlete_id);
          res = await fetch(`https://www.strava.com/api/v3/athlete/activities?${params}`, {
            headers: { Authorization: `Bearer ${access}` },
          });
        } catch {
          res = null; // network error → treat as transient
        }
        if (res && (res.ok || res.status === 429 || (res.status >= 400 && res.status < 500))) break;
        if (attempt < 2) await sleep(400 * (attempt + 1)); // 400ms, 800ms
      }

      if (res && res.status === 429) return json({ error: 'rate_limited', retryAfter: 900 }, 429);
      if (!res || !res.ok) {
        // Do NOT silently skip — record the athlete so the caller retries this page.
        failed.push(acct.athlete_id);
        continue;
      }
      const activities = (await res.json()) as StravaActivity[];
      processed += activities.length;
      if (activities.length === perPage) hasMore = true;
      for (const a of activities) {
        const outcome = await ingestActivity(admin, a, acct.athlete_id);
        if (outcome === 'stored') stored++;
        else skipped++;
      }
    }

    // Once we've reached the end (and nothing failed), link any outings both of you
    // recorded so stats count them once.
    if (!hasMore && failed.length === 0) {
      // rpc() has no .catch() — it reports failure in `error`. Calling .catch() threw
      // a TypeError that turned the LAST page of every backfill into a 500.
      const { error } = await admin.rpc('dedupe_shared_outings');
      if (error) console.error('dedupe_shared_outings failed', error.message);
    }

    // Report failed athletes so the caller can surface them and re-run — never a
    // silent skip. hasMore stays data-driven so a persistently-broken athlete can't
    // trap the pager in an infinite loop.
    return json({ processed, stored, skipped, page, hasMore, failed });
  } catch (e) {
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
