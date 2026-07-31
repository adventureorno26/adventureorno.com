// ingest-overland — receives Overland's GeoJSON batches and stores them as
// location_pings. Auth: the same device ingest token as photos (rule #7), sent
// either as `Authorization: Bearer <token>` or `?token=<token>` (Overland can
// append query params but not custom headers on every build).
//
// Rules: drop points with horizontal accuracy > 200 m; return Overland's expected
// {"result":"ok"} so the app clears its queue.
//
// verify_jwt = false for this function (device-token auth, not a Supabase JWT).
// Deploy: supabase functions deploy ingest-overland --no-verify-jwt

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY =
  Deno.env.get('AON_SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ACCURACY_MAX_M = 200;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface OverlandFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { timestamp?: string; horizontal_accuracy?: number };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Overland pings the URL with GET to test connectivity.
  if (req.method === 'GET') return json({ result: 'ok' });
  if (req.method !== 'POST') return json({ result: 'error', error: 'method' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : url.searchParams.get('token');
  if (!token) return json({ result: 'error', error: 'no token' }, 401);

  const tokenHash = await sha256Hex(token);
  const { data: tok } = await admin
    .from('ingest_tokens')
    .select('id, profile_id')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle();
  if (!tok) return json({ result: 'error', error: 'invalid token' }, 401);
  // Attribution comes from the TOKEN, never the request body — a device can't forge
  // whose pings these are.
  const profileId = tok.profile_id as string | null;
  await admin
    .from('ingest_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', tok.id);

  // Accepts BOTH Overland ({locations:[Feature]}) and OwnTracks
  // ({_type:'location', lat, lon, tst, acc}). OwnTracks posts one message per
  // request and expects a JSON *array* back; Overland expects {"result":"ok"}.
  let payload: {
    locations?: OverlandFeature[];
    _type?: string;
    lat?: number;
    lon?: number;
    tst?: number;
    acc?: number;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ result: 'error', error: 'bad json' }, 400);
  }
  const isOwnTracks = typeof payload._type === 'string';

  interface Row {
    lat: number;
    lng: number;
    recorded_at: string;
    source: string;
    accuracy: number | null;
    profile_id: string | null;
  }
  // Keep every point with usable accuracy, regardless of location.
  const keep = (_lat: number, _lng: number, acc: number | null): boolean =>
    !(acc != null && acc > ACCURACY_MAX_M);

  const rows: Row[] = [];

  if (isOwnTracks) {
    // Only 'location' messages carry coordinates; ack everything else (transition,
    // waypoint, lwt, …) with an empty array so the app doesn't retry.
    if (payload._type === 'location' && typeof payload.lat === 'number' && typeof payload.lon === 'number') {
      const acc = typeof payload.acc === 'number' ? payload.acc : null;
      if (keep(payload.lat, payload.lon, acc)) {
        rows.push({
          lat: payload.lat,
          lng: payload.lon,
          recorded_at: payload.tst ? new Date(payload.tst * 1000).toISOString() : new Date().toISOString(),
          source: 'owntracks',
          accuracy: acc,
          profile_id: profileId,
        });
      }
    }
    if (rows.length > 0) {
      const { error } = await admin.from('location_pings').insert(rows);
      // Never ack a failed insert — OwnTracks would drop the message. Return a 500
      // so the device retries instead of discarding the point.
      if (error) return json({ result: 'error', error: error.message }, 500);
    }
    return json([]); // OwnTracks expects a (possibly empty) array of messages back
  }

  // Overland batch.
  const features = payload.locations ?? [];
  for (const f of features) {
    const c = f.geometry?.coordinates;
    if (!c || c.length < 2) continue;
    const [lng, lat] = c;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const acc = typeof f.properties?.horizontal_accuracy === 'number'
      ? f.properties.horizontal_accuracy
      : null;
    if (!keep(lat, lng, acc)) continue;
    rows.push({
      lat,
      lng,
      recorded_at: f.properties?.timestamp ?? new Date().toISOString(),
      source: 'overland',
      accuracy: acc,
      profile_id: profileId,
    });
  }

  if (rows.length > 0) {
    const { error } = await admin.from('location_pings').insert(rows);
    if (error) return json({ result: 'error', error: error.message }, 500);
  }

  // Overland clears its queue only on {"result":"ok"}.
  return json({ result: 'ok', saved: rows.length, received: features.length });
});
