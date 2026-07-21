// strava-webhook — Strava push subscription endpoint.
//   GET  ?hub.challenge&hub.verify_token → echo challenge if the token matches
//        our STRAVA_VERIFY_TOKEN (handshake when the subscription is created).
//   POST event → for activity create/update fetch the activity + upsert (rule #2);
//        for delete, remove the row.
//
// verify_jwt = false (Strava calls this, no Supabase JWT).
// Secret: STRAVA_VERIFY_TOKEN (any random string, also passed at subscribe time).
// Deploy: supabase functions deploy strava-webhook --no-verify-jwt

import {
  adminClient,
  getHomeZone,
  getValidAccessTokenFor,
  ingestActivity,
  type StravaActivity,
} from '../_shared/strava.ts';

const VERIFY_TOKEN = Deno.env.get('STRAVA_VERIFY_TOKEN') ?? '';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface StravaEvent {
  object_type: 'activity' | 'athlete';
  object_id: number;
  aspect_type: 'create' | 'update' | 'delete';
  owner_id: number;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Subscription handshake.
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
      return json({ 'hub.challenge': challenge });
    }
    return json({ error: 'verify token mismatch' }, 403);
  }

  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  let event: StravaEvent;
  try {
    event = (await req.json()) as StravaEvent;
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  // Ack immediately for anything we don't act on (Strava expects a fast 200).
  if (event.object_type !== 'activity') return json({ ok: true, ignored: true });

  const admin = adminClient();
  try {
    if (event.aspect_type === 'delete') {
      const { data: row } = await admin
        .from('activities')
        .select('place_id')
        .eq('strava_id', event.object_id)
        .maybeSingle();
      await admin.from('activities').delete().eq('strava_id', event.object_id);
      if (row?.place_id) await admin.rpc('recompute_place_stats', { p_place: row.place_id });
      return json({ ok: true, deleted: event.object_id });
    }

    // create | update → fetch the full activity using the OWNER's token, then
    // apply rule #2 and attribute it to that athlete.
    const access = await getValidAccessTokenFor(admin, event.owner_id);
    const res = await fetch(`https://www.strava.com/api/v3/activities/${event.object_id}`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (!res.ok) return json({ ok: false, error: `fetch activity ${res.status}` });
    const activity = (await res.json()) as StravaActivity;
    const zone = await getHomeZone(admin);
    const outcome = await ingestActivity(admin, activity, zone, event.owner_id);
    if (outcome === 'stored') await admin.rpc('dedupe_shared_outings').catch(() => undefined);
    return json({ ok: true, outcome });
  } catch (e) {
    console.error('strava-webhook error', String(e));
    // Still 200 so Strava doesn't hammer retries; we log for debugging.
    return json({ ok: false, error: String(e).slice(0, 200) });
  }
});
