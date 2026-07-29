// Shared Strava helpers used by strava-auth / strava-webhook / strava-backfill.
// Secrets (Supabase project secrets): STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const STRAVA_CLIENT_ID = Deno.env.get('STRAVA_CLIENT_ID') ?? '';
export const STRAVA_CLIENT_SECRET = Deno.env.get('STRAVA_CLIENT_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Rule #2: these are always ingested, even inside the home zone.
const HOME_EXEMPT = new Set(['Hike', 'Walk', 'Run']);
const EARTH_RADIUS_M = 6371008.8;

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

const toRad = (d: number): number => (d * Math.PI) / 180;
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface HomeZone {
  lat: number;
  lng: number;
  radius_m: number;
}

export async function getHomeZone(admin: SupabaseClient): Promise<HomeZone> {
  const { data } = await admin.from('settings').select('value').eq('key', 'home_zone').maybeSingle();
  return (data?.value ?? { lat: 39.1157, lng: -77.5636, radius_m: 24140 }) as HomeZone;
}

/** Rule #2: Hike/Walk/Run always; any other type only if the start point is
 *  outside the home zone. */
export function shouldIngest(type: string, lat: number, lng: number, zone: HomeZone): boolean {
  if (HOME_EXEMPT.has(type)) return true;
  return haversineM(lat, lng, zone.lat, zone.lng) > zone.radius_m;
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

/** Upsert one Strava activity, applying rule #2 and assigning a place. Returns
 *  'stored' | 'skipped'. */
export async function ingestActivity(
  admin: SupabaseClient,
  a: StravaActivity,
  zone: HomeZone,
  athleteId?: number,
): Promise<'stored' | 'skipped'> {
  const type = a.type ?? a.sport_type ?? 'Workout';
  const ll = a.start_latlng;
  if (!ll || ll.length < 2) return 'skipped'; // no start point → can't place it
  const [lat, lng] = ll;
  if (!shouldIngest(type, lat, lng, zone)) return 'skipped';

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
    // An activity gets its OWN leaf place at its start point (reusing a leaf
    // within 150 m). No 30 km nearest-pin snapping.
    const { data: assigned } = await admin.rpc('place_for_activity', {
      p_lat: lat,
      p_lng: lng,
      p_type: a.type ?? null,
      p_name: a.name ?? null,
    });
    placeId = (assigned as string | null) ?? null;
    const { error } = await admin
      .from('activities')
      .insert({ strava_id: a.id, place_id: placeId, ...stravaFields });
    if (error) throw new Error(`insert activity failed: ${error.message}`);
  }
  if (placeId) {
    await admin.rpc('recompute_place_stats', { p_place: placeId });
    await admin.rpc('rebuild_place_visits', { p_place: placeId });
  }
  return 'stored';
}
