import { supabase } from './supabase';
import type { Entry, NewEntry, NewPlace, Place, PlaceDay } from './types';

// All reads/writes go through RLS; the client never sees rows it isn't allowed
// to. Geography is exposed as lat/lng doubles (geom is a generated column).

const PLACE_COLS =
  'id, name, country, admin1, lat, lng, first_visit, last_visit, cover_photo_id, auto, needs_geocode, visit_count, rating, review, is_home, categories, activity_categories, created_by, created_at';
const ENTRY_COLS = 'id, place_id, kind, title, body, rating, url, date, created_by, created_at';

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
    rating?: number | null;
    review?: string | null;
    categories?: string[];
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
