// Shared Strava helpers used by strava-auth / strava-webhook / strava-backfill.
// Secrets (Supabase project secrets): STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { reverseGeocode as sharedReverseGeocode } from './geocode.ts';

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
 * Would this geocoder result read as a place you'd recognise?
 *
 * MapTiler returns "-" as its placeholder when an address has no house number,
 * and its nearest-POI results near a trail are often infrastructure rather than
 * anywhere you went: "Reston Community Storage Lot", "Potomac Interceptor Long
 * Term Odor Abatement Program", "BriteWash Auto Wash". Reject those and try the
 * next granularity rather than writing a name Erica would have to undo.
 */
export function usablePlaceName(text: string | undefined | null): text is string {
  const s = (text ?? '').trim();
  if (!s || s === '-') return false;
  if (/^[\d\s.,-]+$/.test(s)) return false; // "-", "1200", "12-14"
  if (/^\p{L}$/u.test(s)) return false; // a single letter
  // Plumbing, parking and retail: not a destination.
  if (
    /\b(storage|odor|abatement|interceptor|substation|pump(ing)?\s+station|water\s+treatment|sewer|utility|maintenance\s+(yard|facility)|auto\s+wash|car\s+wash|self[\s-]storage|cell\s+tower|transfer\s+station)\b/i.test(
      s,
    )
  ) {
    return false;
  }
  // A road is where you drove to the trail, not the trail — unless the name is
  // itself outdoorsy ("Skyline Drive", "Blue Ridge Parkway", "Trail Road").
  const roady =
    /\b(rd|road|st|street|ave|avenue|dr|drive|ln|lane|ct|court|blvd|boulevard|hwy|highway|pkwy|parkway|way|circle|cir|ter|terrace|route|rte|sr|tr)\b\.?$/i;
  const outdoorsy =
    /\b(trail|trailhead|park|forest|preserve|reserve|refuge|wilderness|mountain|mtn|peak|summit|ridge|gap|hollow|falls|creek|river|lake|pond|overlook|canyon|gorge|beach|island|battlefield|monument|greenway|towpath|skyline|parkway)\b/i;
  if (roady.test(s) && !outdoorsy.test(s)) return false;
  // A pure road designation: "SR630", "TR408", "US-15".
  if (/^(sr|tr|us|va|md|wv|pa|i)[\s-]?\d+$/i.test(s)) return false;
  return true;
}

/**
 * Is this a name, or just a clock reading?
 *
 * Strava names almost everything "Morning Hike" / "Evening Walk" from the time of
 * day. Erica: "I want the names of real places, not 'morning walk'." The date
 * already says when; the name should say where. This is the TypeScript twin of
 * `public.is_generic_activity_name` (migration 0147) — keep the two in step.
 */
export function isGenericActivityName(name: string | null | undefined): boolean {
  const s = (name ?? '').trim();
  if (!s) return true;
  return (
    /^(morning|afternoon|evening|night|lunch|late[\s-]?night)[\s_-]+(walk|run|hike|ride|swim|workout|activity|jog|cycle)s?$/i.test(
      s,
    ) ||
    /^(hiking|running|cycling|walking|swimming|activity|workout)[\s_-]*\d{4}-\d{2}-\d{2}/i.test(s) ||
    /^\d{4}-\d{2}-\d{2}[\sT_-]/.test(s) ||
    /^activity_?\d+$/i.test(s) ||
    /^(walk|run|hike|ride|swim|workout|activity)$/i.test(s)
  );
}

/** What to call an activity: the name a person wrote, else the place it happened at. */
async function activityNameFor(
  admin: SupabaseClient,
  given: string | null | undefined,
  placeId: string | null,
  type: string,
): Promise<string> {
  if (!isGenericActivityName(given)) return given!.trim();
  if (placeId) {
    const { data } = await admin.from('places').select('name').eq('id', placeId).maybeSingle();
    const placeName = (data?.name ?? '').trim();
    if (placeName && placeName !== 'New place') return placeName;
  }
  return (given ?? '').trim() || type || 'Activity';
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

  // Mapbox first; MapTiler is suspended and 403s, so this naming path had been
  // dead since 2026-08-10 and every new Strava place stayed "New place".
  const hit = await sharedReverseGeocode(mlng, mlat);
  if (!usablePlaceName(hit.name)) return; // no suggestion means leave it alone
  await admin
    .from('places')
    .update({
      name: hit.name,
      admin1: hit.admin1,
      country: hit.country,
      needs_geocode: false,
    })
    .eq('id', placeId)
    .eq('name', 'New place'); // never clobber a name set meanwhile
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
    // NAME IS NOT A STRAVA-OWNED FIELD. Strava calls almost everything "Morning
    // Hike"; those rows have been renamed after the place they happened at, and a
    // routine re-sync must not put the clock reading back. Only a name Strava's
    // user actually typed comes across.
    const nameUpdate = isGenericActivityName(a.name) ? {} : { name: a.name };
    const { error } = await admin
      .from('activities')
      .update({ ...stravaFields, ...nameUpdate })
      .eq('id', existing.id);
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
      // Name the PLACE first, so the activity below can be named after it and the
      // card never shows "New place".
      if (placeId) await nameNewPlace(admin, placeId, a, lat!, lng!);
    }
    const { error } = await admin.from('activities').insert({
      strava_id: a.id,
      place_id: placeId,
      name: await activityNameFor(admin, a.name, placeId, type),
      ...stravaFields,
    });
    if (error) throw new Error(`insert activity failed: ${error.message}`);
  }
  if (placeId) {
    await admin.rpc('recompute_place_stats', { p_place: placeId });
    await admin.rpc('rebuild_place_visits', { p_place: placeId });
  }
  return 'stored';
}
