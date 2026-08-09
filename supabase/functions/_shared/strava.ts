// Shared Strava helpers used by strava-auth / strava-webhook / strava-backfill.
// Secrets (Supabase project secrets): STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const STRAVA_CLIENT_ID = Deno.env.get('STRAVA_CLIENT_ID') ?? '';
export const STRAVA_CLIENT_SECRET = Deno.env.get('STRAVA_CLIENT_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY =
  Deno.env.get('AON_SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  scope?: string;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse & { athlete?: { id: number } };
}

interface Account {
  athlete_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

/** Every connected athlete (Erica + Josh). */
export async function getAllAccounts(admin: SupabaseClient): Promise<Account[]> {
  const { data } = await admin
    .from('strava_accounts')
    .select('athlete_id, access_token, refresh_token, expires_at')
    .order('created_at', { ascending: true });
  return (data ?? []) as Account[];
}

/** A fresh access token for one account, refreshing if it expires within 5 min. */
async function tokenFor(admin: SupabaseClient, acct: Account): Promise<string> {
  const expMs = new Date(acct.expires_at).getTime();
  if (expMs - Date.now() > 5 * 60_000) return acct.access_token;
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: acct.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  const t = (await res.json()) as TokenResponse;
  await admin
    .from('strava_accounts')
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: new Date(t.expires_at * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('athlete_id', acct.athlete_id);
  return t.access_token;
}

/** Valid access token for a specific athlete (webhook routes by owner_id). */
export async function getValidAccessTokenFor(
  admin: SupabaseClient,
  athleteId: number,
): Promise<string> {
  const { data: acct } = await admin
    .from('strava_accounts')
    .select('athlete_id, access_token, refresh_token, expires_at')
    .eq('athlete_id', athleteId)
    .maybeSingle();
  if (!acct) throw new Error(`no Strava account for athlete ${athleteId}`);
  return tokenFor(admin, acct as Account);
}

/** Back-compat: token for the first connected athlete. */
export async function getValidAccessToken(admin: SupabaseClient): Promise<string> {
  const accts = await getAllAccounts(admin);
  if (accts.length === 0) throw new Error('no connected Strava account');
  return tokenFor(admin, accts[0]);
}

export interface StravaActivity {
  id: number;
  name?: string;
  type?: string;
  sport_type?: string;
  distance?: number;
  total_elevation_gain?: number;
  moving_time?: number;
  elapsed_time?: number;
  start_date?: string;
  start_latlng?: [number, number] | null;
  map?: { summary_polyline?: string | null };
}

/** Decode a Strava summary polyline to [lat, lng] points. */
function decodePolyline(p: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < p.length) {
    for (const isLat of [true, false]) {
      let shift = 0, result = 0, b: number;
      do {
        b = p.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (isLat) lat += d; else lng += d;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

/**
 * Name a place the placement RPC just created.
 *
 * place_for_activity inserts new leaf places called literally "New place" with
 * needs_geocode set, on the assumption that a nightly geocoder would name them.
 * That job was unscheduled in migration 0130 because sweeping every place
 * overwrote names Erica had given — so nothing named them, and every hike in a
 * new spot left a "New place" behind.
 *
 * This names only the ONE place just created, and only while it is still called
 * "New place" and unlocked, so it can never touch a name a person chose.
 *
 * It geocodes the route MIDPOINT, not the start: an activity starts in a
 * trailhead car park, which is why the start point returns things like "SR630"
 * and "TR408" while the midpoint returns "Tuscarora-Overall Run Trail".
 */
async function nameNewPlace(
  admin: SupabaseClient,
  placeId: string,
  a: StravaActivity,
  lat: number,
  lng: number,
): Promise<void> {
  const key = Deno.env.get('MAPTILER_KEY');
  if (!key) return;

  const { data: place } = await admin
    .from('places')
    .select('name, needs_geocode, name_locked')
    .eq('id', placeId)
    .maybeSingle();
  if (!place || place.name_locked || place.name !== 'New place') return;

  let [mlat, mlng] = [lat, lng];
  const poly = a.map?.summary_polyline;
  if (poly) {
    try {
      const pts = decodePolyline(poly);
      if (pts.length) [mlat, mlng] = pts[Math.floor(pts.length / 2)];
    } catch {
      /* fall back to the start point */
    }
  }

  for (const types of ['poi', 'address', 'municipality']) {
    try {
      const r = await fetch(
        `https://api.maptiler.com/geocoding/${mlng},${mlat}.json` +
          `?key=${key}&limit=1&types=${types}`,
      );
      if (!r.ok) continue;
      const f = (await r.json())?.features?.[0];
      const text: string | undefined = f?.text;
      if (!text) continue;
      const ctx: { id?: string; text?: string }[] = f.context ?? [];
      await admin
        .from('places')
        .update({
          name: text,
          address: f.place_name ?? null,
          admin1: ctx.find((c) => c.id?.startsWith('region'))?.text ?? null,
          country: ctx.find((c) => c.id?.startsWith('country'))?.text ?? null,
          needs_geocode: false,
        })
        .eq('id', placeId)
        .eq('name', 'New place');   // never clobber a name set meanwhile
      return;
    } catch {
      /* try the next granularity */
    }
  }
}

/** Upsert one Strava activity. Placed activities get a leaf place; coordinate-free
 *  (indoor/GPS-less) activities are still ingested when they carry real movement —
 *  they count toward mileage + the timeline but stay UNPLACED (place_id null) and OFF
 *  the map (no summary_polyline). Returns 'stored' | 'skipped'. */
export async function ingestActivity(
  admin: SupabaseClient,
  a: StravaActivity,
  athleteId?: number,
): Promise<'stored' | 'skipped'> {
  const type = a.type ?? a.sport_type ?? 'Workout';
  const ll = a.start_latlng;
  const hasCoords = Array.isArray(ll) && ll.length >= 2;
  // Drop only the truly empty ones: no coordinates AND no distance to count.
  if (!hasCoords && (a.distance ?? 0) <= 0) return 'skipped';
  const lat = hasCoords ? ll![0] : null;
  const lng = hasCoords ? ll![1] : null;

  // If this activity already exists, sync only the Strava-owned fields (name,
  // type, distance…) and PRESERVE any manual place/trailhead assignment (e.g. a
  // run moved onto the W&OD/AT). Only newly-seen activities get auto-placed.
  const { data: existing } = await admin
    .from('activities')
    .select('id, place_id')
    .eq('strava_id', a.id)
    .maybeSingle();

  const stravaFields = {
    type,
    name: a.name ?? null,
    distance: a.distance ?? 0,
    elevation_gain: a.total_elevation_gain ?? null,
    moving_time: a.moving_time ?? null,
    elapsed_time: a.elapsed_time ?? null,
    start_date: a.start_date ?? null,
    lat,
    lng,
    summary_polyline: a.map?.summary_polyline ?? null,
    // Which of us recorded it (for "just me / just Josh / both" + dedupe).
    ...(athleteId != null ? { athlete_id: athleteId } : {}),
  };

  let placeId: string | null = null;
  if (existing) {
    placeId = existing.place_id as string | null;
    const { error } = await admin.from('activities').update(stravaFields).eq('id', existing.id);
    if (error) throw new Error(`update activity failed: ${error.message}`);
  } else {
    // A placed activity gets its OWN leaf place at its start point (reusing a leaf
    // within 150 m). No 30 km nearest-pin snapping. Coordinate-free activities stay
    // unplaced (place_id null).
    if (hasCoords) {
      const { data: assigned } = await admin.rpc('place_for_activity', {
        p_lat: lat,
        p_lng: lng,
        p_type: a.type ?? null,
        p_name: a.name ?? null,
      });
      placeId = (assigned as string | null) ?? null;
    }
    const { error } = await admin
      .from('activities')
      .insert({ strava_id: a.id, place_id: placeId, ...stravaFields });
    if (error) throw new Error(`insert activity failed: ${error.message}`);
  }
  if (placeId) {
    // Name it before the stats run, so the card never shows "New place".
    if (!existing && hasCoords) await nameNewPlace(admin, placeId, a, lat!, lng!);
    await admin.rpc('recompute_place_stats', { p_place: placeId });
    await admin.rpc('rebuild_place_visits', { p_place: placeId });
  }
  return 'stored';
}
