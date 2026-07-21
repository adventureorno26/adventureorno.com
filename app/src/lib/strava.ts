// Strava client helpers: mileage aggregates, per-place activities/counts, OAuth
// connect link, and the paginated backfill driver.

import { supabase } from './supabase';
import type { Activity, MileageRow } from './types';

const ACTIVITY_COLS =
  'id, strava_id, type, name, distance, moving_time, elapsed_time, start_date, lat, lng, summary_polyline, place_id, trailhead';

// Stats + map trails only reflect activities on/after this date. Older Strava
// history stays in the DB (visits/day views), it just doesn't count. (Erica's
// standing rule — see memory.)
export const STATS_CUTOFF = '2025-12-21';

export async function fetchMileage(): Promise<MileageRow[]> {
  const { data, error } = await supabase
    .from('activity_mileage')
    .select('type, activity_count, meters, miles');
  if (error) throw error;
  return (data ?? []) as MileageRow[];
}

export interface PlaceCount {
  place_id: string;
  photo_count: number;
  route_count: number;
  miles: number;
}

export async function fetchPlaceCounts(): Promise<Map<string, PlaceCount>> {
  const { data, error } = await supabase
    .from('place_counts')
    .select('place_id, photo_count, route_count, miles');
  if (error) throw error;
  const map = new Map<string, PlaceCount>();
  for (const r of (data ?? []) as PlaceCount[]) map.set(r.place_id, r);
  return map;
}

export interface ActivityLine {
  id: string;
  place_id: string | null;
  type: string;
  summary_polyline: string;
}

/** All activity route geometries (for drawing trails on the main map). Only
 *  activities on/after the stats cutoff appear on the map. */
export async function fetchActivityLines(): Promise<ActivityLine[]> {
  const { data, error } = await supabase
    .from('activities')
    .select('id, place_id, type, summary_polyline')
    .gte('start_date', STATS_CUTOFF)
    .not('summary_polyline', 'is', null);
  if (error) return [];
  return (data ?? []).filter(
    (a): a is ActivityLine => !!(a as ActivityLine).summary_polyline,
  ) as ActivityLine[];
}

/** Total meters by activity type across a set of places (trail + its trailheads). */
export async function fetchMileageForPlaces(
  placeIds: string[],
): Promise<Record<string, number>> {
  if (placeIds.length === 0) return {};
  const { data, error } = await supabase
    .from('activities')
    .select('type, distance')
    .in('place_id', placeIds)
    .gte('start_date', STATS_CUTOFF);
  if (error) return {};
  const out: Record<string, number> = {};
  for (const a of (data ?? []) as { type: string; distance: number }[]) {
    out[a.type] = (out[a.type] ?? 0) + Number(a.distance);
  }
  return out;
}

export async function fetchActivitiesForPlace(placeId: string): Promise<Activity[]> {
  const { data, error } = await supabase
    .from('activities')
    .select(ACTIVITY_COLS)
    .eq('place_id', placeId)
    .order('start_date', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Activity[];
}

/** Activities for a place on a specific day (start_date within [day, day+1)). */
export async function fetchActivitiesForDay(placeId: string, day: string): Promise<Activity[]> {
  const next = new Date(day + 'T00:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  const dayEnd = next.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('activities')
    .select(ACTIVITY_COLS)
    .eq('place_id', placeId)
    .gte('start_date', day)
    .lt('start_date', dayEnd)
    .order('start_date');
  if (error) throw error;
  return (data ?? []) as Activity[];
}

/** Move a misgrouped activity to a different place (server recomputes both). */
export async function reassignActivity(activityId: string, placeId: string): Promise<void> {
  const { error } = await supabase.rpc('reassign_activity', {
    p_activity: activityId,
    p_place: placeId,
  });
  if (error) throw error;
}

/** Rename an activity (and optionally fix its type). Owner/editor only. */
export async function updateActivity(id: string, name: string, type?: string): Promise<void> {
  const { error } = await supabase.rpc('update_activity', {
    p_id: id,
    p_name: name,
    p_type: type ?? null,
  });
  if (error) throw error;
}

/** Save a hand-drawn trail as a manual activity (SECURITY DEFINER RPC). */
export async function createManualActivity(args: {
  name: string;
  type: string; // Hike / Walk / Run
  placeId: string | null;
  polyline: string;
  distance: number;
  lat: number;
  lng: number;
  date: string; // ISO
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_manual_activity', {
    p_name: args.name,
    p_type: args.type,
    p_place: args.placeId,
    p_polyline: args.polyline,
    p_distance: args.distance,
    p_lat: args.lat,
    p_lng: args.lng,
    p_date: args.date,
  });
  if (error) throw error;
  return data as string;
}

export async function isStravaConnected(): Promise<boolean> {
  const { data, error } = await supabase.rpc('strava_connected');
  if (error) return false;
  return Boolean(data);
}

/** Whether the CURRENT signed-in user has connected their own Strava. */
export async function isMyStravaConnected(): Promise<boolean> {
  const { data, error } = await supabase.rpc('strava_connected_me');
  if (error) return false;
  return Boolean(data);
}

export interface StravaAthlete {
  athlete_id: number;
  profile_id: string | null;
  display_name: string | null;
}

/** Connected athletes → for attribution and the "just me / both" toggle. */
export async function fetchStravaAthletes(): Promise<StravaAthlete[]> {
  const { data, error } = await supabase.rpc('strava_athletes');
  if (error) return [];
  return (data ?? []) as StravaAthlete[];
}

/** Build the Strava authorize URL. Client ID is public; secret stays server-side.
 *  `state` carries the owner's user id so the callback can attribute the account. */
export function stravaAuthorizeUrl(clientId: string, ownerId: string): string {
  const redirect = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-auth`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state: ownerId,
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

export interface BackfillPage {
  processed: number;
  stored: number;
  skipped: number;
  page: number;
  hasMore: boolean;
}

/** Run one backfill page via the Edge Function. Caller loops + paces (rate limit). */
export async function backfillPage(
  after: number,
  before: number,
  page: number,
): Promise<BackfillPage> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-backfill`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ after, before, page }),
  });
  if (res.status === 429) throw new Error('Strava rate limit — wait a few minutes and resume.');
  if (!res.ok) throw new Error(`Backfill failed (${res.status})`);
  return (await res.json()) as BackfillPage;
}
