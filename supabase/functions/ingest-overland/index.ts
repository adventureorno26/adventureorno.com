// ingest-overland — receives Overland's GeoJSON batches and stores them as
// location_pings. Auth: the same device ingest token as photos (rule #7), sent
// either as `Authorization: Bearer <token>` or `?token=<token>` (Overland can
// append query params but not custom headers on every build).
//
// Rules: drop points inside the home zone; drop points with horizontal accuracy
// > 200 m; return Overland's expected {"result":"ok"} so the app clears its queue.
//
// verify_jwt = false for this function (device-token auth, not a Supabase JWT).
// Deploy: supabase functions deploy ingest-overland --no-verify-jwt

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ACCURACY_MAX_M = 200;
const EARTH_RADIUS_M = 6371008.8;

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

const toRad = (d: number): number => (d * Math.PI) / 180;
function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
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
    .select('id')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle();
  if (!tok) return json({ result: 'error', error: 'invalid token' }, 401);
  await admin
    .from('ingest_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', tok.id);

  let payload: { locations?: OverlandFeature[] };
  try {
    payload = await req.json();
  } catch {
    return json({ result: 'error', error: 'bad json' }, 400);
  }
  const features = payload.locations ?? [];

  const { data: setting } = await admin
    .from('settings')
    .select('value')
    .eq('key', 'home_zone')
    .maybeSingle();
  const zone = (setting?.value ?? { lat: 39.1157, lng: -77.5636, radius_m: 24140 }) as {
    lat: number;
    lng: number;
    radius_m: number;
  };

  const rows: Array<{
    lat: number;
    lng: number;
    recorded_at: string;
    source: string;
    accuracy: number | null;
  }> = [];
  for (const f of features) {
    const c = f.geometry?.coordinates;
    if (!c || c.length < 2) continue;
    const [lng, lat] = c;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const acc = f.properties?.horizontal_accuracy;
    if (typeof acc === 'number' && acc > ACCURACY_MAX_M) continue; // too fuzzy
    if (haversineM(lat, lng, zone.lat, zone.lng) <= zone.radius_m) continue; // home zone
    rows.push({
      lat,
      lng,
      recorded_at: f.properties?.timestamp ?? new Date().toISOString(),
      source: 'overland',
      accuracy: typeof acc === 'number' ? acc : null,
    });
  }

  if (rows.length > 0) {
    const { error } = await admin.from('location_pings').insert(rows);
    if (error) return json({ result: 'error', error: error.message }, 500);
  }

  // Overland clears its queue only on {"result":"ok"}.
  return json({ result: 'ok', saved: rows.length, received: features.length });
});
