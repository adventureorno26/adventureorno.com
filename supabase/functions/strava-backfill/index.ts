// strava-backfill — pull historical activities for a date range, one page per
// invocation so the SPA can show progress and pace itself under Strava's rate
// limit (100 req / 15 min). Applies rule #2 via ingestActivity.
//
// verify_jwt = true — owner only. Body: { after?: unix, before?: unix, page?: 1 }.
// Response: { processed, stored, skipped, page, hasMore }.
// Deploy: supabase functions deploy strava-backfill

import {
  adminClient,
  getHomeZone,
  getValidAccessToken,
  ingestActivity,
  type StravaActivity,
} from '../_shared/strava.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const PER_PAGE = 100;

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

  let body: { after?: number; before?: number; page?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const page = Math.max(1, body.page ?? 1);

  try {
    const access = await getValidAccessToken(admin);
    const zone = await getHomeZone(admin);
    const params = new URLSearchParams({ per_page: String(PER_PAGE), page: String(page) });
    if (body.after) params.set('after', String(body.after));
    if (body.before) params.set('before', String(body.before));

    const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?${params}`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (res.status === 429) return json({ error: 'rate_limited', retryAfter: 900 }, 429);
    if (!res.ok) return json({ error: `list failed ${res.status}` }, 502);

    const activities = (await res.json()) as StravaActivity[];
    let stored = 0;
    let skipped = 0;
    for (const a of activities) {
      const outcome = await ingestActivity(admin, a, zone);
      if (outcome === 'stored') stored++;
      else skipped++;
    }

    return json({
      processed: activities.length,
      stored,
      skipped,
      page,
      hasMore: activities.length === PER_PAGE,
    });
  } catch (e) {
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
