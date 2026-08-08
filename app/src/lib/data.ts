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
  'id, name, country, admin1, lat, lng, first_visit, last_visit, cover_photo_id, auto, needs_geocode, name_locked, named_by, name_scope, counts_as_place, visit_count, rating, review, is_home, saved, is_trail, part_of, suggested, bucket, website, categories, activity_categories, cover_pos_y, address, city, solo_profile, favorite, holds_children, category, park, created_by, created_at';
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

/**
 * @deprecated Use {@link createPlaceAtomic}. This direct insert is neither
 * transactional with the visit/rating/review that usually accompany it, nor
 * idempotent, so a retry after a dropped connection creates a duplicate place.
 *
 * COMPLETION-PLAN Phase 2 moved every application call site onto
 * `createPlaceAtomic` (migration 0122 extended the RPC's place contract to cover
 * is_trail, bucket, needs_geocode, website, auto, part_of, review, and the
 * explicit unnamed-draft opt-in). This is retained only as a compatibility export
 * and has no callers; a lint rule keeps it that way.
 */
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

/** Soft-delete: moves the place to the trash (restorable for 30 days). */
export async function deletePlace(id: string): Promise<void> {
  const { error } = await supabase.rpc('soft_delete_place', { p_id: id });
  if (error) throw error;
}
export async function restorePlace(id: string): Promise<void> {
  const { error } = await supabase.rpc('restore_place', { p_id: id });
  if (error) throw error;
}

export interface TrashItem {
  kind: 'place' | 'photo';
  id: string;
  label: string;
  deleted_at: string;
  place_id: string | null;
}
/** Everything in the trash (last 30 days) the caller may see. */
export async function fetchTrash(): Promise<TrashItem[]> {
  const { data, error } = await supabase.rpc('list_trash');
  if (error) return [];
  return (data ?? []) as TrashItem[];
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
export interface TripContent {
  place_id: string;
  place_name: string;
  visit_id: string;
  start_date: string;
  end_date: string;
}

/**
 * The places you went to during a trip.
 *
 * Cape Cod is a place AND the trip you took there; Linnell Landing is a place you
 * visited during it. The contents are derived from the trip's DATES — nothing is
 * stored, so marking or unmarking a trip changes them immediately and nothing can
 * drift. Every stored version of this (trip_stops, part_of, suggested trips) did.
 */
export async function fetchTripContents(visitId: string): Promise<TripContent[]> {
  const { data, error } = await supabase.rpc('trip_contents', { p_visit: visitId });
  if (error) return [];
  return (data ?? []) as TripContent[];
}

/**
 * Occasions for the current view: a trip week is ONE, however much you did inside
 * it. The places you visited during it still count as places, just not as extra
 * visits.
 */
export async function fetchOccasionCount(profileId?: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('occasion_count', { p_profile: profileId ?? null });
  if (error) return 0;
  return (data as number) ?? 0;
}

export async function fetchItemCounts(): Promise<{ entries: number; visits: number }> {
  const [e, v] = await Promise.all([
    supabase.from('entries').select('*', { count: 'exact', head: true }),
    supabase.from('visits').select('*', { count: 'exact', head: true }),
  ]);
  return { entries: e.count ?? 0, visits: v.count ?? 0 };
}

export async function fetchSettingsStats(personId?: string | null): Promise<SettingsStats | null> {
  const { data, error } = await supabase.rpc('settings_stats', { p_profile: personId ?? null });
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
  place_id: string | null; // the place/trail where it was bagged (for its card)
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
export async function fetchPeaksBagged(personId?: string | null): Promise<Peak[]> {
  const { data, error } = await supabase.rpc('peaks_bagged', { p_profile: personId ?? null });
  if (error) return [];
  return (data ?? []) as Peak[];
}

/** How many US states / world countries we've actually set foot in (not bucket). */
export async function fetchGeoCoverage(personId?: string | null): Promise<GeoCoverage | null> {
  const { data, error } = await supabase.rpc('geo_coverage', { p_profile: personId ?? null });
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

export interface TrackingStatus {
  profile_id: string;
  display_name: string | null;
  last_ping: string | null;
  pings: number;
}

/** Each person's location-tracking health (last ping + total), for Settings. */
export async function fetchTrackingStatus(): Promise<TrackingStatus[]> {
  const { data, error } = await supabase.rpc('tracking_status');
  if (error) return [];
  return (data ?? []).map((r: TrackingStatus) => ({ ...r, pings: Number(r.pings) }));
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

export interface PhotoSuggestion {
  place_id: string;
  name: string;
  meters: number;
  reason: string; // plain-language: 'photo location', 'you were here then', …
  score: number;
}

/** Timeline matcher: propose the place a photo belongs to from its timestamp
 *  (and optional GPS), cross-referenced against pings/activities/visit windows.
 *  Returns ranked candidates — [0] is the best guess. Empty if nothing matched. */
export async function matchPhoto(
  takenAt: string | null,
  lat?: number | null,
  lng?: number | null,
): Promise<PhotoSuggestion[]> {
  if (!takenAt) return [];
  const { data, error } = await supabase.rpc('match_photo', {
    p_taken_at: takenAt,
    p_lat: lat ?? null,
    p_lng: lng ?? null,
  });
  if (error) return [];
  return (data ?? []) as PhotoSuggestion[];
}

export interface Attention {
  unassignedPhotos: number;
  photosNoDate: number;
  unnamedPlaces: number;
  missingCategories: number;
  missingDates: number;
  activitiesNoPlace: number;
  suggestedTrips: number;
}
/** Counts for the "needs attention" dashboard (all RLS-scoped to what you can see). */
export async function fetchAttention(): Promise<Attention> {
  const places = await fetchPlaces().catch(() => [] as Place[]);
  const saved = places.filter((p) => p.saved && !p.bucket && !p.holds_children);
  const unnamedPlaces = saved.filter(
    (p) => !p.name || p.name.trim() === '' || p.name === 'New place',
  ).length;
  const missingCategories = saved.filter(
    (p) =>
      (p.categories?.length ?? 0) === 0 &&
      (p.activity_categories?.length ?? 0) === 0 &&
      !p.is_trail,
  ).length;
  const missingDates = saved.filter((p) => !p.first_visit).length;
  const suggestedTrips = places.filter((p) => p.suggested).length;
  const [unassigned, actNoPlace, noDate] = await Promise.all([
    supabase.from('photos').select('*', { count: 'exact', head: true }).is('place_id', null),
    supabase.from('activities').select('*', { count: 'exact', head: true }).is('place_id', null),
    supabase.from('photos').select('*', { count: 'exact', head: true }).is('taken_at', null),
  ]);
  return {
    unassignedPhotos: unassigned.count ?? 0,
    photosNoDate: noDate.count ?? 0,
    unnamedPlaces,
    missingCategories,
    missingDates,
    activitiesNoPlace: actNoPlace.count ?? 0,
    suggestedTrips,
  };
}

export interface TimelineDay {
  date: string; // YYYY-MM-DD
  photos: number;
  activities: { name: string; type: string; place_id: string | null; miles: number }[];
  placeIds: string[];
}
/** Chronological roll-up of photos + activities by day (newest first) for the
 *  timeline view. RLS-scoped, non-deleted. */
export async function fetchTimeline(): Promise<TimelineDay[]> {
  const [ph, ac] = await Promise.all([
    supabase.from('photos').select('taken_at, place_id').not('taken_at', 'is', null),
    supabase
      .from('activities')
      .select('start_date, name, type, place_id, distance')
      .not('start_date', 'is', null),
  ]);
  const days = new Map<string, TimelineDay>();
  const get = (d: string): TimelineDay => {
    let x = days.get(d);
    if (!x) {
      x = { date: d, photos: 0, activities: [], placeIds: [] };
      days.set(d, x);
    }
    return x;
  };
  for (const p of (ph.data ?? []) as { taken_at: string; place_id: string | null }[]) {
    const d = get(p.taken_at.slice(0, 10));
    d.photos++;
    if (p.place_id && !d.placeIds.includes(p.place_id)) d.placeIds.push(p.place_id);
  }
  for (const a of (ac.data ?? []) as {
    start_date: string;
    name: string | null;
    type: string;
    place_id: string | null;
    distance: number;
  }[]) {
    const d = get(a.start_date.slice(0, 10));
    d.activities.push({
      name: a.name ?? a.type,
      type: a.type,
      place_id: a.place_id,
      miles: Math.round((a.distance / 1609.34) * 10) / 10,
    });
    if (a.place_id && !d.placeIds.includes(a.place_id)) d.placeIds.push(a.place_id);
  }
  return [...days.values()].sort((x, y) => y.date.localeCompare(x.date));
}

export type DataHealth = Record<string, number>;
/** Whole-dataset counts + integrity signals for the data-health center. */
export async function fetchDataHealth(): Promise<DataHealth | null> {
  const { data, error } = await supabase.rpc('data_health');
  if (error || !data) return null;
  return data as DataHealth;
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
  'id, place_id, start_date, end_date, note, is_trip, status, solo_profile, solo_override, created_at';

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
    const hit = rows.find(
      (r) => r.geojson?.type === 'Polygon' || r.geojson?.type === 'MultiPolygon',
    );
    return hit?.geojson ? JSON.stringify(hit.geojson) : null;
  } catch {
    return null;
  }
}

export interface PoiDetails {
  name: string | null;
  website: string | null;
  wikipedia: string | null; // "en:Article Title" form from OSM
  category: string | null; // OSM class/type, e.g. "tourism/museum"
}
/** Look up a place's official details from OpenStreetMap (Nominatim reverse with
 *  extra tags). Suggestions only — the caller confirms before applying. */
export async function fetchPoiDetails(lat: number, lng: number): Promise<PoiDetails | null> {
  try {
    const url =
      'https://nominatim.openstreetmap.org/reverse?' +
      new URLSearchParams({
        lat: String(lat),
        lon: String(lng),
        format: 'json',
        extratags: '1',
        namedetails: '1',
        zoom: '18',
      });
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      name?: string;
      namedetails?: { name?: string };
      class?: string;
      type?: string;
      extratags?: Record<string, string>;
    };
    const ex = d.extratags ?? {};
    return {
      name: d.namedetails?.name || d.name || null,
      website: ex.website || ex['contact:website'] || ex.url || null,
      wikipedia: ex.wikipedia || null,
      category: d.class && d.type ? `${d.class}/${d.type}` : null,
    };
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
/**
 * Per-place visit counts FOR THE ACTIVE VIEW (map badge).
 *
 * The badge used to read `places.visit_count`, which is global, so it showed the
 * same number in Just me / Just Josh / Both — Potomac Station advertised 67 visits
 * in Erica's view although every one of them is Josh's. This RPC applies exactly
 * the same filter as `place_ids_for_view`, so the badge can never disagree with
 * which pins are on the map.
 *
 * `null` = the Both view (visits attributed to both); a profile id = that person's
 * visits plus the Both ones.
 */
export async function fetchPlaceVisitCounts(
  profileId: string | null,
): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('place_visit_counts', { p_profile: profileId });
  if (error) throw error;
  const out = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ place_id: string; visits: number }>) {
    out.set(row.place_id, row.visits);
  }
  return out;
}

export async function fetchPlaceIdsForView(profileId: string | null): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('place_ids_for_view', {
    p_profile: profileId ?? null,
  });
  if (error) throw error;
  return new Set(
    (data ?? []).map((r: { place_ids_for_view: string } | string) =>
      typeof r === 'string' ? r : r.place_ids_for_view,
    ),
  );
}

/** Every visit across all places (for the bulk editor's per-visit dropdowns). */
export async function fetchAllVisits(): Promise<Visit[]> {
  const { data, error } = await supabase
    .from('visits')
    .select(VISIT_COLS)
    .order('start_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Visit[];
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

/** Per-visit photo/video counts for a place (keyed by visit id). */
export async function fetchPlaceVisitStats(
  placeId: string,
): Promise<Record<string, { photos: number; videos: number }>> {
  const { data, error } = await supabase.rpc('place_visit_stats', { p_place: placeId });
  if (error || !data) return {};
  const out: Record<string, { photos: number; videos: number }> = {};
  for (const r of data as { visit_id: string; photos: number; videos: number }[]) {
    out[r.visit_id] = { photos: r.photos, videos: r.videos };
  }
  return out;
}

/**
 * @deprecated Use {@link addExperience} / {@link createPlaceAtomic}. A bare visit
 * insert is not idempotent, so a retry after a dropped connection logs the visit
 * twice, and it cannot be transactional with the place/attribution/rating that
 * normally accompany it.
 *
 * Zero callers as of COMPLETION-PLAN Phase 2 — `PlacePanel.addSpot` was the last
 * one and now uses the canonical path. Retained only as a compatibility export;
 * a lint rule keeps it unused.
 */
export async function addVisit(placeId: string, start: string, end: string): Promise<Visit> {
  const { data, error } = await supabase
    .from('visits')
    .insert({ place_id: placeId, start_date: start, end_date: end })
    .select(VISIT_COLS)
    .single();
  if (error) throw error;
  return data as Visit;
}

/**
 * Change a visit's date range — "stretch a visit into a trip by adding more days".
 *
 * Goes through the `set_visit_dates` RPC rather than a direct update because the
 * RPC also sets `manual = true`. That matters: `rebuild_place_visits` DELETES and
 * recreates every non-manual visit, and all live visits are manual=false, so a
 * plain update would be silently wiped the next time anything touched the place.
 *
 * Editors and the owner can both do this (same rule as visits_write). Attribution
 * — Just me / Just Josh / Both — records who was there and never gates editing.
 */
export async function setVisitDates(id: string, start: string, end: string): Promise<Visit> {
  const { data, error } = await supabase.rpc('set_visit_dates', {
    p_visit: id,
    p_start: start,
    p_end: end,
  });
  if (error) throw error;
  return data as unknown as Visit;
}

/**
 * Name a place, and own that name.
 *
 * There is no automatic naming any more (migration 0130 unscheduled the geocoder and
 * the dupe-merger). A name is always chosen by a person, and belongs to them:
 *   scope = your profile id -> named in YOUR space; only you can change it
 *   scope = null            -> named in the shared Both space; either of you can
 * Always go through this rather than PATCHing `name`, so the ownership is recorded.
 */
export async function setPlaceName(
  placeId: string,
  name: string,
  scope: string | null = null,
): Promise<Place> {
  const { data, error } = await supabase.rpc('set_place_name', {
    p_place: placeId,
    p_name: name,
    p_scope: scope,
  });
  if (error) throw error;
  return data as unknown as Place;
}

/**
 * Whether `me` may rename this place — the same rule the DB enforces, evaluated
 * locally so the UI can disable the control instead of failing on save.
 */
export function canRenamePlace(place: Place, me: string | null | undefined): boolean {
  if (!place.name_locked) return true; // nobody has claimed it yet
  if (place.name_scope === null) return true; // shared space: either of us
  return !!me && place.name_scope === me; // someone's own space: only them
}

/**
 * Mark a visit as a trip, or unmark it.
 *
 * A trip IS a visit you marked — nothing derives it. Until migration 0133 `is_trip`
 * was a generated column (`end_date > start_date`), so any multi-day stay was
 * silently promoted to a trip: 50 of 485 visits were flagged that nobody marked.
 */
export async function setVisitIsTrip(visitId: string, isTrip: boolean): Promise<Visit> {
  const { data, error } = await supabase.rpc('set_visit_is_trip', {
    p_visit: visitId,
    p_is_trip: isTrip,
  });
  if (error) throw error;
  return data as unknown as Visit;
}

export interface ActivityReaction {
  emoji: string;
  n: number;
  who: string[];
  mine: boolean;
}

/** Grouped reactions on an activity (migration 0135) — mirrors photo reactions. */
export async function fetchActivityReactions(activityId: string): Promise<ActivityReaction[]> {
  const { data, error } = await supabase.rpc('activity_reactions_for', { p_activity: activityId });
  if (error) return [];
  return (data ?? []) as ActivityReaction[];
}

/** Toggle the current user's reaction on an activity. */
export async function toggleActivityReaction(activityId: string, emoji: string): Promise<void> {
  const { error } = await supabase.rpc('toggle_activity_reaction', {
    p_activity: activityId,
    p_emoji: emoji,
  });
  if (error) throw error;
}

export async function deleteVisit(id: string): Promise<void> {
  const { error } = await supabase.from('visits').delete().eq('id', id);
  if (error) throw error;
}

/** Recreate a deleted visit with its FULL original record — dates, note, attribution,
 *  override flag, and multi-day/trip flag — as a manual visit (used by visit Undo, so
 *  Undo restores everything, not just the date). */
export async function restoreVisit(v: Visit): Promise<Visit> {
  const { data, error } = await supabase
    .from('visits')
    .insert({
      place_id: v.place_id,
      start_date: v.start_date,
      end_date: v.end_date,
      note: v.note,
      // is_trip is set by a PERSON (migration 0133), so an undo must restore it
      // explicitly — it is no longer implied by the dates.
      is_trip: v.is_trip,
      solo_profile: v.solo_profile,
      solo_override: v.solo_override,
      manual: true,
    })
    .select(VISIT_COLS)
    .single();
  if (error) throw error;
  return data as Visit;
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

// --- Unified experience creation (Prompt 2B) -------------------------------
// One transactional + idempotent creation path shared by every "log an
// experience" surface (AddWizard, NewPlaceDraft, MapView, PlacePanel/addSpot,
// DayView, imports). The server RPC create_experience() writes the whole
// place+visit+attribution+people graph atomically; passing a stable `key`
// makes a retry after a partial failure return the same records instead of
// duplicating them. Generate the key once per user save action and reuse it on
// retry.

/** A place to log against: an existing place by id, or a brand-new place. */
export type ExperiencePlaceInput =
  | { id: string }
  | {
      name: string;
      lat: number;
      lng: number;
      country?: string | null;
      admin1?: string | null;
      city?: string | null;
      address?: string | null;
      categories?: string[];
      saved?: boolean;
      // Extended contract (migration 0122) so every creation surface can use this
      // one atomic + idempotent path instead of a direct insert.
      is_trail?: boolean;
      bucket?: boolean;
      needs_geocode?: boolean;
      website?: string | null;
      review?: string | null;
      auto?: boolean;
      /** Parent place ids. The DB trigger materialises place_membership rows. */
      part_of?: string[];
      /**
       * Opt in to creating a place with an empty name — only the map's "drop a
       * placeholder and name it on the card" draft flow. The server keeps the
       * "a new place requires a name" guard on for everyone else.
       */
      allow_unnamed?: boolean;
      /**
       * Attach the place to a Trip as a stop, in the SAME transaction (migration
       * 0124). `status` defaults to 'planned'; 'completed' is only valid when this
       * call also creates a visit, because a completed stop must carry its
       * evidence visit.
       */
      trip?: {
        id: string;
        status?: 'planned' | 'completed' | 'skipped';
        sort_order?: number;
        note?: string | null;
      };
    };

/** The optional visit to attach. Omit `date` to only create/reuse the place. */
export type ExperienceVisitInput = {
  date?: string;
  end_date?: string;
  note?: string | null;
  rating?: number | null;
  /** 'me' | 'josh' | 'both' | a raw profile uuid. Omit to leave unset. */
  who?: string;
  person_ids?: string[];
};

export type ExperienceResult = {
  place_id: string;
  visit_id: string | null;
  idempotent: boolean;
};

/** Mint an idempotency key for one save action (reuse the same value on retry). */
export function newExperienceKey(): string {
  return crypto.randomUUID();
}

export async function addExperience(
  key: string,
  place: ExperiencePlaceInput,
  visit: ExperienceVisitInput = {},
): Promise<ExperienceResult> {
  const { data, error } = await supabase.rpc('create_experience', {
    p_key: key,
    p_place: place,
    p_visit: visit,
  });
  if (error) throw error;
  return data as ExperienceResult;
}

/**
 * Atomic + idempotent replacement for `createPlace`, returning the full Place the
 * way the old direct-insert path did so call sites can render immediately.
 *
 * Prefer this over `createPlace` everywhere (COMPLETION-PLAN Phase 2). The direct
 * insert is neither transactional with its visit nor idempotent, so a retry after
 * a dropped connection silently created a duplicate place.
 *
 * Pass `key` explicitly when the caller can retry the same user action, so the
 * retry returns the original record instead of creating a second one.
 */
export async function createPlaceAtomic(
  place: Exclude<ExperiencePlaceInput, { id: string }>,
  visit: ExperienceVisitInput = {},
  key: string = newExperienceKey(),
): Promise<Place> {
  const { place_id } = await addExperience(key, place, visit);
  const created = await fetchPlace(place_id);
  if (!created) {
    // The RPC committed but the row is not readable back — surface it rather than
    // returning a hollow object the UI would render as an empty card.
    throw new Error('The place was created but could not be read back.');
  }
  return created;
}

// --- Non-login people (children) — Prompt 2B -------------------------------
export type Person = {
  id: string;
  display_name: string;
  kind: string;
  birthdate: string | null;
};

export async function fetchPeople(): Promise<Person[]> {
  const { data, error } = await supabase
    .from('people')
    .select('id, display_name, kind, birthdate')
    .is('deleted_at', null)
    .order('display_name');
  if (error) throw error;
  return (data ?? []) as Person[];
}

export async function createPerson(display_name: string, kind = 'child'): Promise<Person> {
  const { data, error } = await supabase
    .from('people')
    .insert({ display_name: display_name.trim(), kind })
    .select('id, display_name, kind, birthdate')
    .single();
  if (error) throw error;
  return data as Person;
}

/** Replace the set of non-login people attached to a visit. */
export async function setVisitPeople(visitId: string, personIds: string[]): Promise<void> {
  const del = await supabase.from('visit_people').delete().eq('visit_id', visitId);
  if (del.error) throw del.error;
  if (personIds.length) {
    const { error } = await supabase
      .from('visit_people')
      .insert(personIds.map((person_id) => ({ visit_id: visitId, person_id })));
    if (error) throw error;
  }
}

export async function fetchVisitPeople(visitId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('visit_people')
    .select('person_id')
    .eq('visit_id', visitId);
  if (error) throw error;
  return (data ?? []).map((r) => (r as { person_id: string }).person_id);
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

/** Pairs the user marked "keep separate" — normalized keys `${minId}|${maxId}`. */
export async function fetchDismissedDupes(): Promise<Set<string>> {
  const s = new Set<string>();
  const { data, error } = await supabase.from('dup_dismissed').select('place_a, place_b');
  if (error || !data) return s;
  for (const r of data as { place_a: string; place_b: string }[])
    s.add(`${r.place_a}|${r.place_b}`);
  return s;
}
/** Remember that two places are NOT duplicates (stops the suggestion). */
export async function dismissDuplicate(a: string, b: string): Promise<void> {
  const { error } = await supabase.rpc('dismiss_duplicate', { p_a: a, p_b: b });
  if (error) throw error;
}
/** Order-independent key matching how dismissals are stored (least|greatest). */
export const dupeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

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
