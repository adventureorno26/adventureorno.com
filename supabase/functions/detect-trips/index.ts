// detect-trips — passively drafts trips from photos + Strava activities.
//
// Algorithm (temporal gap clustering with a home filter — tuned to our sparse
// timestamped events, not a continuous GPS breadcrumb):
//   1. events = photos (taken_at) + activities (start_date), each with lat/lng
//   2. drop events within 15 mi of home (Leesburg) — those never make a trip
//   3. sort by time; split into clusters wherever the gap > 20 h
//   4. a cluster is a TRIP if: span >= 20 h AND >= 2 distinct local days AND
//      max distance from home >= 40 mi AND >= 3 events
//   5. name it by reverse-geocoding the centroid; create a place tagged 'trip'
//      with suggested=true + a visit for the date range
//   6. attach every existing place inside the trip's dates + bbox (part_of)
//
// Idempotent: skips a candidate whose date range overlaps an existing trip-place.
// Only ever creates suggested drafts — never mutates a confirmed trip.
//
// Callers: nightly cron (AON_SUPABASE_SECRET_KEY in apikey) or the owner from
// /settings. Custom auth requires verify_jwt=false.
// Secrets: MAPTILER_KEY, AON_SUPABASE_SECRET_KEY.
// Deploy: supabase functions deploy detect-trips --no-verify-jwt

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { reverseGeocode as sharedReverseGeocode } from '../_shared/geocode.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY =
  Deno.env.get('AON_SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY =
  Deno.env.get('AON_SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;

// Home center falls back to Leesburg; the real value comes from settings.home_zone.
// NOTE: this 3-mi radius is used ONLY here (trip detection) — it filters out
// near-home events so neighborhood walks never look like a trip. Ingest no longer
// excludes the home zone (settings radius_m = 0), so those walks are still logged.
const HOME_FALLBACK = { lat: 39.1157, lng: -77.5636 };
const HOME_MI = 3;
const GAP_H = 20;
const MIN_SPAN_H = 20;
const MIN_DIST_MI = 40;
const MIN_EVENTS = 3;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s));
}

// Local calendar date at a longitude (approx timezone = lng/15 hours).
function localDay(ms: number, lng: number): string {
  return new Date(ms + (lng / 15) * 3600_000).toISOString().slice(0, 10);
}

async function reverseGeocode(
  lng: number,
  lat: number,
): Promise<{ name: string; admin1: string | null; country: string | null }> {
  // Mapbox first; MapTiler is suspended and 403s. "Trip" stays the fallback name
  // when nothing can be resolved — a trip still needs SOMETHING to be called.
  const hit = await sharedReverseGeocode(lng, lat);
  return {
    name: hit.name || 'Trip',
    admin1: hit.admin1,
    country: hit.country,
  };
}

interface Ev {
  t: number;
  lat: number;
  lng: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Modern Supabase secret keys are sent only as apikey and require
  // verify_jwt=false; interactive calls still authenticate with a user JWT.
  const isServiceCall = req.headers.get('apikey') === SERVICE_ROLE_KEY;
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!isServiceCall) {
    if (!jwt) return json({ error: 'unauthenticated' }, 401);
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

  // Home center from settings (radius here is our own 3mi, not settings.radius_m).
  const { data: hz } = await admin
    .from('settings')
    .select('value')
    .eq('key', 'home_zone')
    .maybeSingle();
  const home = ((hz?.value as { lat?: number; lng?: number } | null) ?? {}) as {
    lat?: number;
    lng?: number;
  };
  const HOME = { lat: home.lat ?? HOME_FALLBACK.lat, lng: home.lng ?? HOME_FALLBACK.lng };

  // 1. Gather timestamped events.
  const [{ data: photos }, { data: acts }] = await Promise.all([
    admin.from('photos').select('lat, lng, taken_at').not('taken_at', 'is', null),
    admin.from('activities').select('lat, lng, start_date').not('lat', 'is', null),
  ]);
  const events: Ev[] = [];
  for (const p of photos ?? [])
    if (p.lat != null && p.lng != null && p.taken_at)
      events.push({ t: Date.parse(p.taken_at as string), lat: p.lat as number, lng: p.lng as number });
  for (const a of acts ?? [])
    if (a.lat != null && a.lng != null && a.start_date)
      events.push({ t: Date.parse(a.start_date as string), lat: a.lat as number, lng: a.lng as number });

  // 2. Home filter + sort.
  const away = events
    .filter((e) => milesBetween(e.lat, e.lng, HOME.lat, HOME.lng) > HOME_MI)
    .sort((x, y) => x.t - y.t);

  // 3. Gap-split.
  const clusters: Ev[][] = [];
  for (const e of away) {
    const last = clusters[clusters.length - 1];
    if (!last || e.t - last[last.length - 1].t > GAP_H * 3600_000) clusters.push([e]);
    else last.push(e);
  }

  // Existing trip-places' date ranges (idempotency) — a place tagged 'trip' with visits.
  const { data: tripPlaces } = await admin
    .from('places')
    .select('id, first_visit, last_visit')
    .contains('categories', ['trip']);
  const existingRanges = (tripPlaces ?? [])
    .filter((t) => t.first_visit)
    .map((t) => ({ s: t.first_visit as string, e: (t.last_visit ?? t.first_visit) as string }));

  // Existing saved places to attach (loaded once).
  const { data: allPlaces } = await admin
    .from('places')
    .select('id, lat, lng, first_visit, last_visit, part_of, categories, saved, bucket');

  const created: { name: string; start: string; end: string; attached: number }[] = [];

  for (const c of clusters) {
    const spanH = (c[c.length - 1].t - c[0].t) / 3600_000;
    const days = new Set(c.map((e) => localDay(e.t, e.lng))).size;
    const maxDist = Math.max(...c.map((e) => milesBetween(e.lat, e.lng, HOME.lat, HOME.lng)));
    if (spanH < MIN_SPAN_H || days < 2 || maxDist < MIN_DIST_MI || c.length < MIN_EVENTS) continue;

    const start = localDay(c[0].t, c[0].lng);
    const end = localDay(c[c.length - 1].t, c[c.length - 1].lng);
    // Idempotency: skip if an existing trip already overlaps this range.
    if (existingRanges.some((r) => r.s <= end && r.e >= start)) continue;

    const cLat = c.reduce((s, e) => s + e.lat, 0) / c.length;
    const cLng = c.reduce((s, e) => s + e.lng, 0) / c.length;
    const bbox = {
      minLat: Math.min(...c.map((e) => e.lat)) - 0.3,
      maxLat: Math.max(...c.map((e) => e.lat)) + 0.3,
      minLng: Math.min(...c.map((e) => e.lng)) - 0.3,
      maxLng: Math.max(...c.map((e) => e.lng)) + 0.3,
    };
    const geo = await reverseGeocode(cLng, cLat);
    const name = geo.admin1 ? `${geo.name}, ${geo.admin1}` : geo.name;

    const { data: place, error: perr } = await admin
      .from('places')
      .insert({
        name,
        lat: cLat,
        lng: cLng,
        admin1: geo.admin1,
        country: geo.country,
        categories: ['trip'],
        suggested: true,
        saved: false,
        needs_geocode: false,
      })
      .select('id')
      .single();
    if (perr || !place) continue;

    await admin.from('visits').insert({ place_id: place.id, start_date: start, end_date: end });

    // Attach existing saved places inside the dates + bbox.
    let attached = 0;
    for (const p of allPlaces ?? []) {
      if (!p.saved || p.bucket) continue;
      if ((p.categories ?? []).includes('trip')) continue;
      if (p.lat == null || p.lng == null) continue;
      if (p.lat < bbox.minLat || p.lat > bbox.maxLat || p.lng < bbox.minLng || p.lng > bbox.maxLng)
        continue;
      const fv = p.first_visit as string | null;
      const lv = (p.last_visit ?? p.first_visit) as string | null;
      const inRange = (fv && fv <= end && (lv ?? fv) >= start) || false;
      if (!inRange) continue;
      const partOf = (p.part_of as string[] | null) ?? [];
      if (partOf.includes(place.id)) continue;
      await admin
        .from('places')
        .update({ part_of: [...partOf, place.id] })
        .eq('id', p.id);
      attached++;
    }

    existingRanges.push({ s: start, e: end });
    created.push({ name, start, end, attached });
  }

  return json({ suggested: created.length, trips: created });
});
