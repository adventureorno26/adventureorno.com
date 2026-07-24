import { supabase } from './supabase';
import { applyCategories } from './categories';
import type { Entry, NewEntry, NewPlace, Place, PlaceDay, Visit } from './types';

/** Load categories/tags from the DB into the runtime registry (call once at boot). */
export async function loadCategories(): Promise<void> {
  const { data, error } = await supabase
    .from('place_categories')
    .select('slug, label, icon, color, review, is_auto, is_container, sort_order')
    .order('sort_order');
  if (error || !data) return;
  applyCategories(data as never);
}

/** Create a custom tag; returns its slug. Populates everywhere tags appear. */
export async function addCategory(
  label: string,
  icon: string,
  color: string,
  review?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('add_place_category', {
    p_label: label,
    p_icon: icon,
    p_color: color,
    p_review: review ?? null,
  });
  if (error) throw error;
  await loadCategories();
  return data as string;
}

// All reads/writes go through RLS; the client never sees rows it isn't allowed
// to. Geography is exposed as lat/lng doubles (geom is a generated column).

const PLACE_COLS =
  'id, name, country, admin1, lat, lng, first_visit, last_visit, cover_photo_id, auto, needs_geocode, visit_count, rating, review, is_home, saved, is_trail, part_of, suggested, bucket, website, categories, activity_categories, cover_pos_y, address, city, solo_profile, favorite, holds_children, category, park, created_by, created_at';
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
    city?: string | null;
    bucket?: boolean;
    website?: string | null;
    is_trail?: boolean;
    part_of?: string[];
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

export interface SettingsStats {
  trails_taken: number;
  camping: number;
  dining: number;
  winery: number;
}

/** Headline counts for the Settings page (same pill style as the map). */
/** Counts of spots (entries) and visits — folded into the "Places" total so it
 *  reflects every spot, visit, and place we've logged. */
export async function fetchItemCounts(): Promise<{ entries: number; visits: number }> {
  const [e, v] = await Promise.all([
    supabase.from('entries').select('*', { count: 'exact', head: true }),
    supabase.from('visits').select('*', { count: 'exact', head: true }),
  ]);
  return { entries: e.count ?? 0, visits: v.count ?? 0 };
}

export async function fetchSettingsStats(): Promise<SettingsStats | null> {
  const { data, error } = await supabase.rpc('settings_stats');
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as SettingsStats | null;
}

export interface GeoCoverage {
  us_states: string[];
  us_state_count: number;
  countries: string[];
  country_count: number;
  has_dc: boolean;
}

export interface Peak {
  id: string;
  name: string;
  ele_ft: number | null;
}

export interface TripTimelineItem {
  day: string;
  kind: 'activity' | 'spot';
  title: string;
  sub: string | null;
  place_id: string | null;
}
export interface TripNote {
  id: string;
  day: string;
  note: string;
}

/** Auto day-by-day timeline of everything that happened on a trip. */
export async function fetchTripTimeline(tripId: string): Promise<TripTimelineItem[]> {
  const { data, error } = await supabase.rpc('trip_timeline', { p_trip: tripId });
  if (error) return [];
  return (data ?? []) as TripTimelineItem[];
}
/** Manual per-day plan notes on a trip. */
export async function fetchTripNotes(tripId: string): Promise<TripNote[]> {
  const { data, error } = await supabase
    .from('trip_notes')
    .select('id, day, note')
    .eq('trip_id', tripId)
    .order('day');
  if (error) return [];
  return (data ?? []) as TripNote[];
}
export async function addTripNote(tripId: string, day: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('add_trip_note', {
    p_trip: tripId,
    p_day: day,
    p_note: note,
  });
  if (error) throw error;
}
export async function deleteTripNote(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_trip_note', { p_id: id });
  if (error) throw error;
}

export interface ClimbingStats {
  total_ft: number;
  everests: number;
}
/** Total vertical climbed + Everests, from per-activity elevation gain. */
export async function fetchClimbingStats(personId?: string | null): Promise<ClimbingStats> {
  const { data, error } = await supabase.rpc('climbing_stats', { p_profile: personId ?? null });
  if (error) return { total_ft: 0, everests: 0 };
  const row = (Array.isArray(data) ? data[0] : data) ?? {};
  return { total_ft: Number(row.total_ft ?? 0), everests: Number(row.everests ?? 0) };
}

/** Summits reached — matched from hike GPS tracks against OSM peaks. */
export async function fetchPeaksBagged(): Promise<Peak[]> {
  const { data, error } = await supabase.rpc('peaks_bagged');
  if (error) return [];
  return (data ?? []) as Peak[];
}

/** How many US states / world countries we've actually set foot in (not bucket). */
export async function fetchGeoCoverage(): Promise<GeoCoverage | null> {
  const { data, error } = await supabase.rpc('geo_coverage');
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    us_states: row.us_states ?? [],
    us_state_count: Number(row.us_state_count ?? 0),
    countries: row.countries ?? [],
    country_count: Number(row.country_count ?? 0),
    has_dc: Boolean(row.has_dc),
  };
}

export interface MapPerson {
  id: string;
  display_name: string | null;
  role: string;
}

/** Set (or clear, with null) the current user's own star rating for a place. */
export async function setMyRating(placeId: string, rating: number | null): Promise<void> {
  const { error } = await supabase.rpc('set_my_rating', {
    p_place: placeId,
    p_rating: rating,
  });
  if (error) throw error;
}

export interface WishInfo {
  wanters: string[];
  n: number;
  everyone: boolean;
}

/** Toggle the current user's "want to go" on a place. */
export async function toggleWish(placeId: string): Promise<void> {
  const { error } = await supabase.rpc('toggle_wish', { p_place: placeId });
  if (error) throw error;
}

/** Who wants each bucket place, keyed by place id. */
export async function fetchWishes(): Promise<Record<string, WishInfo>> {
  const { data, error } = await supabase.rpc('wishes_overview');
  if (error) return {};
  const out: Record<string, WishInfo> = {};
  for (const r of (data ?? []) as {
    place_id: string;
    wanters: string[];
    n: number;
    everyone: boolean;
  }[]) {
    out[r.place_id] = { wanters: r.wanters ?? [], n: Number(r.n), everyone: Boolean(r.everyone) };
  }
  return out;
}

/** Date-night spinner: a random place you both want (optionally within km of a point). */
export async function dateNightPick(
  lat?: number,
  lng?: number,
  radiusKm?: number,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('date_night_pick', {
    p_lat: lat ?? null,
    p_lng: lng ?? null,
    p_radius_km: radiusKm ?? null,
  });
  if (error) return null;
  return (data as string | null) ?? null;
}

/** Each person's rating for a place, keyed by profile id. */
export async function fetchPlaceRatings(placeId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('place_ratings_for', { p_place: placeId });
  if (error) return {};
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { profile_id: string; rating: number }[]) {
    out[r.profile_id] = Number(r.rating);
  }
  return out;
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

const VISIT_COLS =
  'id, place_id, start_date, end_date, note, is_trip, solo_profile, solo_override, created_at';

/** Manually set who a visit belongs to (null = both). Sticks across rebuilds. */
export async function setVisitSolo(visitId: string, profileId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_visit_solo', {
    p_visit: visitId,
    p_profile: profileId,
  });
  if (error) throw error;
}

/** Set who a whole (leaf) place belongs to — sets all its visits. null = both. */
export async function setPlaceSolo(placeId: string, profileId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_place_solo', {
    p_place: placeId,
    p_profile: profileId,
  });
  if (error) throw error;
}

/** Fetch a city/region's boundary polygon from OpenStreetMap Nominatim.
 *  Returns a GeoJSON string, or null if no polygon was found. */
export async function fetchCityBoundary(query: string): Promise<string | null> {
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({ q: query, format: 'json', polygon_geojson: '1', limit: '3' });
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ geojson?: { type?: string } }>;
    const hit = rows.find((r) => r.geojson?.type === 'Polygon' || r.geojson?.type === 'MultiPolygon');
    return hit?.geojson ? JSON.stringify(hit.geojson) : null;
  } catch {
    return null;
  }
}

/** Mark a place as a city/region container with a boundary polygon (GeoJSON). */
export async function setCityBoundary(
  placeId: string,
  geojson: string,
  kind: 'city' | 'region',
): Promise<void> {
  const { error } = await supabase.rpc('set_city_boundary', {
    p_place: placeId,
    p_geojson: geojson,
    p_kind: kind,
  });
  if (error) throw error;
}

/** Remove a city/region designation. */
export async function clearCity(placeId: string): Promise<void> {
  const { error } = await supabase.rpc('clear_city', { p_place: placeId });
  if (error) throw error;
}

/** Leaf place ids that fall inside a city/region's boundary (spatial members). */
export async function fetchSpatialMembers(containerId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('spatial_members', { p_container: containerId });
  if (error) throw error;
  return (data ?? []).map((r: { spatial_members: string } | string) =>
    typeof r === 'string' ? r : r.spatial_members,
  );
}

/** Place ids that should show for a person view (null = Both, post-cutoff only). */
export async function fetchPlaceIdsForView(profileId: string | null): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('place_ids_for_view', { p_profile: profileId ?? null });
  if (error) throw error;
  return new Set((data ?? []).map((r: { place_ids_for_view: string } | string) =>
    typeof r === 'string' ? r : r.place_ids_for_view,
  ));
}

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

/** Reassign a visit to a different place (e.g. move a generic city visit to a
 *  specific spot with its own address). */
export async function moveVisit(id: string, newPlaceId: string): Promise<void> {
  const { error } = await supabase.from('visits').update({ place_id: newPlaceId }).eq('id', id);
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

/** Fog of war: the revealed area (crisp 10km + soft 25km) as GeoJSON geometries. */
export async function fetchFog(): Promise<{
  crisp: GeoJSON.MultiPolygon | null;
  soft: GeoJSON.MultiPolygon | null;
}> {
  const { data } = await supabase.rpc('revealed_area_geojson');
  const d = data as { crisp?: GeoJSON.MultiPolygon; soft?: GeoJSON.MultiPolygon } | null;
  return { crisp: d?.crisp ?? null, soft: d?.soft ?? null };
}

/** Gridded ping density (one RPC, ~0.005° cells with a count) for the heatmap. */
export async function fetchPings(): Promise<{ lng: number; lat: number; weight: number }[]> {
  const { data } = await supabase.rpc('pings_overview');
  return (data ?? []) as { lng: number; lat: number; weight: number }[];
}

export type MapProjection = 'globe' | 'mercator';

/** The map projection flag (settings.map_projection). Defaults to globe. */
export async function fetchMapProjection(): Promise<MapProjection> {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'map_projection')
    .maybeSingle();
  const t = (data?.value as { type?: string } | null)?.type;
  return t === 'mercator' ? 'mercator' : 'globe';
}

/** Owner-only (RLS). Switch the map projection without a deploy. */
export async function setMapProjection(type: MapProjection): Promise<void> {
  const { error } = await supabase
    .from('settings')
    .update({ value: { type }, updated_at: new Date().toISOString() })
    .eq('key', 'map_projection');
  if (error) throw error;
}

export interface AiSuggestion {
  configured: boolean;
  title: string | null;
  category: string | null;
  confidence: number | null;
}

/** Ask the ai-suggest Edge Function for a better title + tag for a place.
 *  Returns { configured:false } when no AI key is set (so the UI hides itself). */
export async function aiSuggest(input: {
  name?: string;
  category?: string | null;
  lat?: number;
  lng?: number;
  address?: string | null;
  activityType?: string | null;
}): Promise<AiSuggestion> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-suggest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`AI suggest failed (${res.status})`);
  return (await res.json()) as AiSuggestion;
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

/** Run trip auto-detection (drafts suggested trips from photos + Strava). */
export async function detectTrips(): Promise<{
  suggested: number;
  trips: { name: string; start: string; end: string; attached: number }[];
}> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/detect-trips`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) throw new Error(`Trip detection failed (${res.status})`);
  return (await res.json()) as {
    suggested: number;
    trips: { name: string; start: string; end: string; attached: number }[];
  };
}

/** Confirm a suggested trip (keep it) or reject it (unlink members + delete). */
export async function resolveSuggestedTrip(id: string, keep: boolean): Promise<void> {
  if (keep) {
    const { error } = await supabase
      .from('places')
      .update({ suggested: false, saved: true })
      .eq('id', id);
    if (error) throw error;
    return;
  }
  // Reject: remove this trip from every member's part_of, then delete the draft.
  const { data: members } = await supabase
    .from('places')
    .select('id, part_of')
    .contains('part_of', [id]);
  for (const m of members ?? []) {
    const next = ((m.part_of as string[] | null) ?? []).filter((x) => x !== id);
    await supabase.from('places').update({ part_of: next }).eq('id', m.id);
  }
  const { error } = await supabase.from('places').delete().eq('id', id);
  if (error) throw error;
}
