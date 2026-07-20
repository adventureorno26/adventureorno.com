// Strava client helpers: mileage aggregates, per-place activities/counts, OAuth
// connect link, and the paginated backfill driver.

import { supabase } from './supabase';
import type { Activity, MileageRow } from './types';

const ACTIVITY_COLS =
  'id, strava_id, type, name, distance, moving_time, elapsed_time, start_date, lat, lng, summary_polyline, place_id, trailhead';

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

export async function isStravaConnected(): Promise<boolean> {
  const { data, error } = await supabase.rpc('strava_connected');
  if (error) return false;
  return Boolean(data);
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
