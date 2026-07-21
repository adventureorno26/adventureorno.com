import { supabase } from './supabase';
import type { Entry, NewEntry, NewPlace, Place, PlaceDay, Visit } from './types';

// All reads/writes go through RLS; the client never sees rows it isn't allowed
// to. Geography is exposed as lat/lng doubles (geom is a generated column).

const PLACE_COLS =
  'id, name, country, admin1, lat, lng, first_visit, last_visit, cover_photo_id, auto, needs_geocode, visit_count, rating, review, is_home, saved, is_trail, trail_id, bucket, website, categories, activity_categories, cover_pos_y, address, solo_profile, favorite, created_by, created_at';
const ENTRY_COLS =
  'id, place_id, kind, title, body, rating, url, date, address, lat, lng, created_by, created_at';

export async function fetchPlaces(): Promise<Place[]> {
  const { data, error } = await supabase.from('places').select(PLACE_COLS);
  if (error) throw error;
  return (data ?? []) as Place[];
}

export async function fetchPlace(id: string): Promise<Place | null> {
  const { data, error } = await supabase
    .from('places')
    .select(PLACE_COLS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as Place) ?? null;
}

export async function createPlace(p: NewPlace): Promise<Place> {
  const { data, error } = await supabase.from('places').insert(p).select(PLACE_COLS).single();
  if (error) throw error;
  return data as Place;
}

export async function updatePlace(
  id: string,
  patch: Partial<NewPlace> & {
    auto?: boolean;
    cover_photo_id?: string | null;
    cover_pos_y?: number;
    rating?: number | null;
    review?: string | null;
    categories?: string[];
    address?: string | null;
    bucket?: boolean;
    website?: string | null;
    is_trail?: boolean;
    trail_id?: string | null;
    saved?: boolean;
    solo_profile?: string | null;
    favorite?: string | null;
  },
): Promise<Place> {
  const { data, error } = await supabase
    .from('places')
    .update(patch)
    .eq('id', id)
    .select(PLACE_COLS)
    .single();
  if (error) throw error;
  return data as Place;
}

export async function deletePlace(id: string): Promise<void> {
  const { error } = await supabase.from('places').delete().eq('id', id);
  if (error) throw error;
}

/** Want-to-go places (the Bucket List page), newest first. */
export async function fetchBucketPlaces(): Promise<Place[]> {
  const { data, error } = await supabase
    .from('places')
    .select(PLACE_COLS)
    .eq('bucket', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Place[];
}

/** Promote a wishlist place into a normal visited place (flip bucket off). */
export async function promoteBucketPlace(id: string): Promise<Place> {
  return updatePlace(id, { bucket: false });
}

/** Fold a place into an existing trail as a trailhead (moves its activities). */
export async function addPlaceToTrail(
  placeId: string,
  trailId: string,
  trailhead: string,
): Promise<void> {
  const { error } = await supabase.rpc('add_place_to_trail', {
    p_place: placeId,
    p_trail: trailId,
    p_trailhead: trailhead,
  });
  if (error) throw error;
}

export interface SettingsStats {
  trails_taken: number;
  camping: number;
  dining: number;
  winery: number;
}

/** Headline counts for the Settings page (same pill style as the map). */
export async function fetchSettingsStats(): Promise<SettingsStats | null> {
  const { data, error } = await supabase.rpc('settings_stats');
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as SettingsStats | null;
}

export interface MapPerson {
  id: string;
  display_name: string | null;
  role: string;
}

/** The two people who can own places/activities (for the "just me" filter). */
export async function fetchMapPeople(): Promise<MapPerson[]> {
  const { data, error } = await supabase.rpc('map_people');
  if (error) return [];
  return (data ?? []) as MapPerson[];
}

/** place_id → set of profile ids who contributed (added it, hiked it, or have a
 *  photo there). Drives the "Just me / Just Josh / Both" place filter. */
export async function fetchPlacePeople(): Promise<Map<string, Set<string>>> {
  const { data, error } = await supabase.rpc('place_people');
  const out = new Map<string, Set<string>>();
  if (error) return out;
  for (const row of (data ?? []) as { place_id: string; profile_id: string }[]) {
    if (!out.has(row.place_id)) out.set(row.place_id, new Set());
    out.get(row.place_id)!.add(row.profile_id);
  }
  return out;
}

/** Lightweight fetch of every spot/review across all places, for global search. */
export async function fetchAllEntries(): Promise<
  Pick<Entry, 'id' | 'place_id' | 'title' | 'body' | 'kind'>[]
> {
  const { data, error } = await supabase.from('entries').select('id, place_id, title, body, kind');
  if (error) return [];
  return (data ?? []) as Pick<Entry, 'id' | 'place_id' | 'title' | 'body' | 'kind'>[];
}

export async function fetchEntries(placeId: string): Promise<Entry[]> {
  const { data, error } = await supabase
    .from('entries')
    .select(ENTRY_COLS)
    .eq('place_id', placeId)
    .order('date', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Entry[];
}

/** Entries for a place on a specific date (the day view). */
export async function fetchEntriesForDay(placeId: string, day: string): Promise<Entry[]> {
  const { data, error } = await supabase
    .from('entries')
    .select(ENTRY_COLS)
    .eq('place_id', placeId)
    .eq('date', day);
  if (error) throw error;
  return (data ?? []) as Entry[];
}

/** Distinct dates you were at a place, with per-day counts (Visits list). */
export async function fetchPlaceDays(placeId: string): Promise<PlaceDay[]> {
  const { data, error } = await supabase.rpc('place_days', { p_place: placeId });
  if (error) throw error;
  return (data ?? []) as PlaceDay[];
}

const VISIT_COLS = 'id, place_id, start_date, end_date, note, created_at';

export async function fetchVisits(placeId: string): Promise<Visit[]> {
  const { data, error } = await supabase
    .from('visits')
    .select(VISIT_COLS)
    .eq('place_id', placeId)
    .order('start_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Visit[];
}

export async function addVisit(placeId: string, start: string, end: string): Promise<Visit> {
  const { data, error } = await supabase
    .from('visits')
    .insert({ place_id: placeId, start_date: start, end_date: end })
    .select(VISIT_COLS)
    .single();
  if (error) throw error;
  return data as Visit;
}

export async function deleteVisit(id: string): Promise<void> {
  const { error } = await supabase.from('visits').delete().eq('id', id);
  if (error) throw error;
}

export async function createEntry(e: NewEntry): Promise<Entry> {
  const { data, error } = await supabase.from('entries').insert(e).select(ENTRY_COLS).single();
  if (error) throw error;
  return data as Entry;
}

export async function updateEntry(id: string, patch: Partial<NewEntry>): Promise<Entry> {
  const { data, error } = await supabase
    .from('entries')
    .update(patch)
    .eq('id', id)
    .select(ENTRY_COLS)
    .single();
  if (error) throw error;
  return data as Entry;
}

export async function deleteEntry(id: string): Promise<void> {
  const { error } = await supabase.from('entries').delete().eq('id', id);
  if (error) throw error;
}

// --- Phase 3: clustering-support operations --------------------------------

/** Merge one place into another (children + visit history combine; loser is
 *  deleted). Server-side SECURITY DEFINER RPC (see 0003_clustering.sql). */
export async function mergePlaces(loserId: string, winnerId: string): Promise<void> {
  const { error } = await supabase.rpc('merge_places', {
    p_loser: loserId,
    p_winner: winnerId,
  });
  if (error) throw error;
}

export interface HomeZone {
  lat: number;
  lng: number;
  radius_m: number;
}

export async function fetchHomeZone(): Promise<HomeZone> {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'home_zone')
    .single();
  if (error) throw error;
  return data.value as HomeZone;
}

/** Owner-only (RLS enforces). Updates the home-exclusion zone in `settings`. */
export async function updateHomeZone(zone: HomeZone): Promise<void> {
  const { error } = await supabase
    .from('settings')
    .update({ value: zone, updated_at: new Date().toISOString() })
    .eq('key', 'home_zone');
  if (error) throw error;
}

/** Ask the geocode-new-places Edge Function to name any pending auto places. */
export async function triggerGeocode(): Promise<{ named: number; considered: number }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/geocode-new-places`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) throw new Error(`Geocode failed (${res.status})`);
  return (await res.json()) as { named: number; considered: number };
}
