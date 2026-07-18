// import-timeline — receives batches of {lat,lng,time} points parsed from a
// Google Takeout / on-device Timeline export in the browser, and stores the
// ones outside the home zone as location_pings (source='timeline'). Owner only.
//
// The client does the JSON parsing (files can be large) and posts points in
// batches; this function is the home-zone backstop + writer.
//
// verify_jwt = true (owner session). Deploy: supabase functions deploy import-timeline

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const EARTH_RADIUS_M = 6371008.8;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
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

interface Point {
  lat: number;
  lng: number;
  time?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // Owner only.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!jwt) return json({ error: 'unauthenticated' }, 401);
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await asCaller.auth.getUser();
  if (!user) return json({ error: 'invalid session' }, 401);
  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (prof?.role !== 'owner') return json({ error: 'owner required' }, 403);

  let body: { points?: Point[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const points = body.points ?? [];

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

  const rows = points
    .filter(
      (p) =>
        typeof p.lat === 'number' &&
        typeof p.lng === 'number' &&
        haversineM(p.lat, p.lng, zone.lat, zone.lng) > zone.radius_m,
    )
    .map((p) => ({
      lat: p.lat,
      lng: p.lng,
      recorded_at: p.time ?? new Date().toISOString(),
      source: 'timeline',
    }));

  if (rows.length > 0) {
    const { error } = await admin.from('location_pings').insert(rows);
    if (error) return json({ error: error.message }, 500);
  }
  return json({ received: points.length, saved: rows.length });
});
