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

/** Return a valid access token for the (single) connected athlete, refreshing if
 *  it expires within 5 minutes. */
export async function getValidAccessToken(admin: SupabaseClient): Promise<string> {
  const { data: acct, error } = await admin
    .from('strava_accounts')
    .select('athlete_id, access_token, refresh_token, expires_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !acct) throw new Error('no connected Strava account');

  const expMs = new Date(acct.expires_at as string).getTime();
  if (expMs - Date.now() > 5 * 60_000) return acct.access_token as string;

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

export interface StravaActivity {
  id: number;
  name?: string;
  type?: string;
  sport_type?: string;
  distance?: number;
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
): Promise<'stored' | 'skipped'> {
  const type = a.type ?? a.sport_type ?? 'Workout';
  const ll = a.start_latlng;
  if (!ll || ll.length < 2) return 'skipped'; // no start point → can't place it
  const [lat, lng] = ll;
  if (!shouldIngest(type, lat, lng, zone)) return 'skipped';

  const { data: placeId } = await admin.rpc('assign_activity_place', { p_lat: lat, p_lng: lng });

  const { error } = await admin.from('activities').upsert(
    {
      strava_id: a.id,
      type,
      name: a.name ?? null,
      distance: a.distance ?? 0,
      moving_time: a.moving_time ?? null,
      elapsed_time: a.elapsed_time ?? null,
      start_date: a.start_date ?? null,
      lat,
      lng,
      summary_polyline: a.map?.summary_polyline ?? null,
      place_id: placeId,
    },
    { onConflict: 'strava_id' },
  );
  if (error) throw new Error(`upsert activity failed: ${error.message}`);
  if (placeId) await admin.rpc('recompute_place_stats', { p_place: placeId });
  return 'stored';
}
