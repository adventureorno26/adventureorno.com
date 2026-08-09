// Strava client helpers: mileage aggregates, per-place activities/counts, OAuth
// connect link, and the paginated backfill driver.

import { supabase } from './supabase';
import type { Activity, MileageRow } from './types';

const ACTIVITY_COLS =
  // local_date is the day it ACTUALLY happened. start_date is UTC, so an evening
  // outing after ~20:00 ET lands on the next calendar day (migration 0143).
  'id, strava_id, type, name, distance, elevation_gain, elevation_profile, moving_time, elapsed_time, start_date, local_date, lat, lng, summary_polyline, place_id, trailhead, solo_profile';

/** Set who an activity belongs to (null = both of us). Rebuilds the place's visits. */
export async function setActivitySolo(activityId: string, profileId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_activity_solo', {
    p_activity: activityId,
    p_profile: profileId,
  });
  if (error) throw error;
}

// Stats + map trails only reflect activities on/after this date. Older Strava
// history stays in the DB (visits/day views), it just doesn't count. (Erica's
// standing rule — see memory.)
export const STATS_CUTOFF = '2025-12-21';

/** Mileage by type. Pass a profile id for "just that person"; omit for both. */
export async function fetchMileage(personId?: string | null): Promise<MileageRow[]> {
  const { data, error } = await supabase.rpc('mileage_by_person', {
    p_profile: personId ?? null,
  });
  if (error) throw error;
  return (data ?? []) as MileageRow[];
}

/** Total household miles for ONE year (de-duped shared outings). For Wrapped, so a
 *  selected year shows that year's mileage rather than an all-time total. */
export async function fetchYearMiles(year: number): Promise<number> {
  const { data, error } = await supabase.rpc('wrapped_year_miles', { p_year: year });
  if (error) return 0;
  return Number(data ?? 0);
}

export interface ActivityListRow {
  id: string;
  type: string;
  name: string | null;
  distance: number;
  start_date: string | null;
  place_id: string | null;
  place_name: string | null;
}

/** Every activity of one type for a person (null = Both view), newest first —
 *  for the "tap a run total → see the list of runs" drill-down. */
export async function fetchActivitiesOfType(
  type: string,
  personId?: string | null,
): Promise<ActivityListRow[]> {
  let query = supabase
    .from('activities')
    .select('id, type, name, distance, start_date, place_id, places(name)')
    .eq('type', type)
    .order('start_date', { ascending: false, nullsFirst: false });
  query = personId
    ? query.or(`solo_profile.is.null,solo_profile.eq.${personId}`)
    : query.is('solo_profile', null);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []).map((a) => {
    const row = a as unknown as {
      id: string;
      type: string;
      name: string | null;
      distance: number;
      start_date: string | null;
      place_id: string | null;
      places: { name: string } | { name: string }[] | null;
    };
    const pl = Array.isArray(row.places) ? row.places[0] : row.places;
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      distance: row.distance,
      start_date: row.start_date,
      place_id: row.place_id,
      place_name: pl?.name ?? null,
    };
  });
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
  owner_profile: string | null; // whose route it is (for the "just me" filter)
}

/** Activity route geometries for the map. Both view = on/after the cutoff; a
 *  single person's view = ALL their routes (their full history). */
export async function fetchActivityLines(personId?: string | null): Promise<ActivityLine[]> {
  let query = supabase
    .from('activities')
    .select('id, place_id, type, summary_polyline, owner_profile')
    .not('summary_polyline', 'is', null);
  // Both = joint routes only (solo_profile null, incl. drawn trails). A person =
  // joint + their own.
  query = personId
    ? query.or(`solo_profile.is.null,solo_profile.eq.${personId}`)
    : query.is('solo_profile', null);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []).filter(
    (a): a is ActivityLine => !!(a as ActivityLine).summary_polyline,
  ) as ActivityLine[];
}

/** Total meters by activity type across a set of places (trail + its trailheads). */
export interface WanderStats {
  places_count: number;
  miles: number;
  trips_count: number;
}

/** Headline stats from the visit-level model: places (each counts once), miles,
 *  and trips (per occurrence). Pass a profile id for that person; omit for Both. */
export async function fetchWanderStats(personId?: string | null): Promise<WanderStats> {
  const { data, error } = await supabase.rpc('wander_stats', { p_profile: personId ?? null });
  if (error) throw error;
  const r = (data?.[0] ?? {}) as Partial<WanderStats>;
  return {
    places_count: Number(r.places_count ?? 0),
    miles: Number(r.miles ?? 0),
    trips_count: Number(r.trips_count ?? 0),
  };
}

// A race is its own place (category='race'); each running is an activity under
// it. "Count each race once, count every running." Buckets: 5K/10K/10 Mile/Half/
// Full/Other. race_stats counts runnings; races_list is one row per named race.
export interface RaceStat {
  bucket: string;
  n: number;
  miles: number;
  ord: number;
}
export interface RaceRow {
  id: string;
  name: string;
  times: number;
  miles: number;
  bucket: string;
}

/** Move a run under a race place (found or created by name). Returns the race id. */
export async function assignActivityToRace(
  activityId: string,
  raceName: string,
  racePlaceId?: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('assign_activity_to_race', {
    p_activity: activityId,
    p_race_name: raceName,
    p_race_place: racePlaceId ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Runnings per distance bucket for a person (null = Both). */
export async function fetchRaceStats(personId?: string | null): Promise<RaceStat[]> {
  const { data, error } = await supabase.rpc('race_stats', { p_profile: personId ?? null });
  if (error) throw error;
  return (data ?? []) as RaceStat[];
}

/** One row per named race: how many times run, miles, and distance bucket. */
export async function fetchRacesList(personId?: string | null): Promise<RaceRow[]> {
  const { data, error } = await supabase.rpc('races_list', { p_profile: personId ?? null });
  if (error) throw error;
  return (data ?? []) as RaceRow[];
}

export interface SearchActivity {
  id: string;
  name: string | null;
  type: string;
  place_id: string | null;
  start_date: string | null;
  /** The day it happened locally (0143) — start_date is UTC. */
  local_date: string | null;
  place_name: string | null;
}

/** All activities (name + type + place) for the ⌘K search, so a run/hike is
 *  findable by its name and jumps to its day. */
export async function fetchSearchActivities(): Promise<SearchActivity[]> {
  const { data, error } = await supabase
    .from('activities')
    .select('id, name, type, place_id, start_date, local_date, places(name)')
    .order('start_date', { ascending: false, nullsFirst: false });
  if (error) return [];
  return (data ?? []).map((a) => {
    const row = a as unknown as {
      id: string;
      name: string | null;
      type: string;
      place_id: string | null;
      start_date: string | null;
      local_date: string | null;
      places: { name: string } | { name: string }[] | null;
    };
    const pl = Array.isArray(row.places) ? row.places[0] : row.places;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      place_id: row.place_id,
      start_date: row.start_date,
      local_date: row.local_date,
      place_name: pl?.name ?? null,
    };
  });
}

/** All race names (regardless of who ran them) — for the "log another running"
 *  datalist, so an existing race is one click to reuse. */
export async function fetchRaceNames(): Promise<string[]> {
  const { data, error } = await supabase
    .from('places')
    .select('name')
    .eq('category', 'race')
    .order('name');
  if (error) return [];
  return (data ?? []).map((r: { name: string }) => r.name);
}

export async function fetchMileageForPlaces(placeIds: string[]): Promise<Record<string, number>> {
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

/**
 * Activities for a place INCLUDING everything on its segments.
 *
 * A trail is a rollup: the W&OD is one place holding "Washington & Old Dominion
 * Trail", "W&OD Bridle Trail" and "Purcellville Trailhead - W&OD" as segments, and
 * the 55 runs are spread across all four rows. `fetchActivitiesForPlace` only ever
 * matched `place_id = the trail itself`, so the trail card showed 6 of them and
 * looked empty. The Appalachian Trail was worse: 11 of 37.
 *
 * Segment membership is the explicit `place_membership` link (trails and trips join
 * by link, cities by boundary), so one extra query resolves the children.
 */
export async function fetchActivitiesForPlaceTree(placeId: string): Promise<Activity[]> {
  const { data: kids, error: kidsErr } = await supabase
    .from('place_membership')
    .select('child_id')
    .eq('parent_id', placeId);
  if (kidsErr) throw kidsErr;

  const ids = [placeId, ...(kids ?? []).map((k) => (k as { child_id: string }).child_id)];
  if (ids.length === 1) return fetchActivitiesForPlace(placeId);

  const { data, error } = await supabase
    .from('activities')
    .select(ACTIVITY_COLS)
    .in('place_id', ids)
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

/** Begin a Strava link: mint a random single-use state (bound to the signed-in
 *  editing account, server-side) and build the authorize URL with it. The client
 *  ID is public; the secret stays server-side. Using a minted state instead of the
 *  raw user id prevents OAuth CSRF / account injection (see migration 0115). */
export async function beginStravaLink(clientId: string): Promise<string> {
  const { data, error } = await supabase.rpc('strava_oauth_start');
  if (error || !data) throw error ?? new Error('Could not start Strava link');
  const redirect = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-auth`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state: data as string,
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

export interface BackfillPage {
  processed: number;
  stored: number;
  skipped: number;
  page: number;
  hasMore: boolean;
  /** Athlete ids whose page couldn't be fetched this run (surfaced, never silent). */
  failed?: number[];
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
