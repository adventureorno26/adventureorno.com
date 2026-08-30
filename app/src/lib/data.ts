import { supabase, sqlNull } from './supabase';
import type { Json } from './database.types';
import { applyCategories } from './categories';
import { duplicatePairs } from './duplicatePlaces';
import { asOutcome, type WhoOutcome } from './whoWasThere';
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
    p_review: review ?? undefined,
  });
  if (error) throw error;
  await loadCategories();
  return data as string;
}

// All reads/writes go through RLS; the client never sees rows it isn't allowed
// to. Geography is exposed as lat/lng doubles (geom is a generated column).

const PLACE_COLS =
  // No solo_profile: attribution lives on the visit (migration 0136, docs/STATE.md §0.3).
  'id, name, country, admin1, lat, lng, first_visit, last_visit, cover_photo_id, auto, needs_geocode, name_locked, named_by, name_scope, counts_as_place, visit_count, rating, review, is_home, saved, is_trail, suggested, bucket, website, categories, activity_categories, cover_pos_y, address, city, favorite, holds_children, category, park, created_by, created_at';
const ENTRY_COLS =
  'id, place_id, kind, title, body, rating, url, date, address, lat, lng, created_by, created_at';

/**
 * Every place, each carrying the containers it sits inside.
 *
 * `part_of` is no longer SELECTED — it is built from `place_memberships_all()` (0189)
 * and attached here. The array on a Place is now a derived convenience, so the six
 * screens that read `p.part_of` keep working unchanged while the column underneath it
 * goes away (§0.7, phase 8 step 4).
 *
 * One extra request for ~19 rows, against a full places list that is loaded anyway.
 */
export async function fetchPlaces(): Promise<Place[]> {
  const [{ data, error }, memberships] = await Promise.all([
    supabase.from('places').select(PLACE_COLS),
    fetchPlaceMemberships().catch(() => new Map<string, string[]>()),
  ]);
  if (error) throw error;
  return (data ?? []).map((p) => ({
    ...p,
    part_of: memberships.get(p.id) ?? [],
  })) as Place[];
}

/** Put a place inside another. Writes the record; the mirror follows (§8). */
export async function addToContainer(childId: string, parentId: string): Promise<void> {
  const { error } = await supabase.rpc('add_to_container', {
    p_child: childId,
    p_parent: parentId,
  });
  if (error) throw error;
}

/** Take a place out of a container. */
export async function removeFromContainer(childId: string, parentId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_from_container', {
    p_child: childId,
    p_parent: parentId,
  });
  if (error) throw error;
}

/** The containers ONE place sits inside. */
async function containersOf(placeId: string): Promise<string[]> {
  const all = await fetchPlaceMemberships().catch(() => new Map<string, string[]>());
  return all.get(placeId) ?? [];
}

/** child id → the places it sits inside. The canonical membership rows (0189). */
export async function fetchPlaceMemberships(): Promise<Map<string, string[]>> {
  const { data, error } = await supabase.rpc('place_memberships_all');
  if (error) throw error;
  const out = new Map<string, string[]>();
  for (const r of data ?? []) {
    const list = out.get(r.child_id) ?? [];
    list.push(r.parent_id);
    out.set(r.child_id, list);
  }
  return out;
}

export async function fetchPlace(id: string): Promise<Place | null> {
  const { data, error } = await supabase
    .from('places')
    .select(PLACE_COLS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // part_of is derived from the membership rows now, so a single place has to be
  // given it too — otherwise refreshing one place empties its containers on screen.
  return { ...data, part_of: await containersOf(id) } as Place;
}

/**
 * @deprecated Use {@link createPlaceAtomic}. This direct insert is neither
 * transactional with the visit/rating/review that usually accompany it, nor
 * idempotent, so a retry after a dropped connection creates a duplicate place.
 *
 * Every application call site moved onto
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
  return { ...data, part_of: await containersOf(id) } as Place;
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
  const [{ data, error }, memberships] = await Promise.all([
    supabase
      .from('places')
      .select(PLACE_COLS)
      .eq('bucket', true)
      .order('created_at', { ascending: false }),
    fetchPlaceMemberships().catch(() => new Map<string, string[]>()),
  ]);
  if (error) throw error;
  return (data ?? []).map((p) => ({ ...p, part_of: memberships.get(p.id) ?? [] })) as Place[];
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
 * visited during it.
 *
 * ⚠️ The description this comment used to carry — "derived from the trip's DATES,
 * nothing is stored" — was the old model, and it was the bug: any visit whose dates
 * fell inside a trip's range was folded into it, at ANY place, so a restaurant in
 * another state appeared inside a Cape Cod week. 0172 rewrote this onto
 * `parent_visit_id`: a trip contains what someone explicitly put in it (§0.1).
 *
 * Prefer {@link fetchCardView}, which returns each visit's contents in the same
 * payload as the count beside it.
 */
/** One visit row on a card: everything the card draws for it, counted server-side. */
export interface CardVisit {
  id: string;
  place_id: string;
  start_date: string;
  end_date: string | null;
  note: string | null;
  /** counts_as_trip: multi-day, OR marked by a person (§0.4). */
  is_trip_qualified: boolean;
  /** False when this visit is grouped inside another — it is not a separate occasion. */
  is_headline: boolean;
  parent_visit_id: string | null;
  /** On a trail card, the section this visit was logged at. Null on the trail itself. */
  segment: string | null;
  people: { id: string; name: string | null }[];
  photos: number;
  videos: number;
  routes: number;
  children: number;
  contents: {
    visit_id: string;
    place_id: string;
    place_name: string;
    start_date: string;
    end_date: string | null;
  }[];
}

/** The whole card, in one answer. Mode is derived from the arguments, never passed. */
export interface CardView {
  version: number;
  mode: 'place' | 'trail' | 'visit';
  can_edit: boolean;
  place: {
    id: string;
    name: string;
    address: string | null;
    admin1: string | null;
    lat: number | null;
    lng: number | null;
    is_trail: boolean;
    cover_photo_id: string | null;
    categories: string[];
  };
  visit: { id: string; start_date: string; end_date: string | null } | null;
  ratings: { name: string | null; profile_id: string; rating: number }[];
  visits: CardVisit[];
  routes: {
    id: string;
    name: string | null;
    type: string;
    distance: number | null;
    /** Who did it, from activity_profiles — not from a nullable solo_profile. */
    people: { id: string; name: string | null }[];
  }[];
  photos: { id: string; day: string | null; caption: string | null }[];
  members: { id: string; name: string; rating: number | null; category: string }[];
  totals: {
    visits: number;
    trips: number;
    photos: number;
    videos: number;
    routes: number;
    miles: number;
    members: number;
  };
}

/**
 * THE card read model (§0.6). One request returns the header, the rows and the totals,
 * and the totals are computed from the very rows returned — so a label cannot disagree
 * with the list beneath it, which is how a card ended up saying "Visits (1)" above a
 * list of two and a trail said 32 while its sections held 30 more.
 *
 * It also replaces a burst of requests: the visits, their photo and video counts, and a
 * separate trip-contents call per trip.
 */
/**
 * Merge two visits to the same place into one occasion.
 *
 * Everything moves — photos, videos, routes, participants, companions, evidence and
 * anything grouped inside — and the dates widen to cover both. It refuses across
 * places; moving a visit somewhere else is {@link moveVisit}, a different decision.
 */
export async function mergeVisits(keepId: string, absorbId: string): Promise<void> {
  const { error } = await supabase.rpc('merge_visits', {
    p_keep: keepId,
    p_absorb: absorbId,
  });
  if (error) throw error;
}

/** Who was on each visit to a place. One request for the whole place — the editor
 *  lists many at once, so per-visit would be a request per row (0186). */
/** Who was on every visit, in one request. The bulk editor loads all visits at once,
 *  so asking per place would be a request per place (0187). */
export async function fetchVisitPeopleAll(): Promise<Map<string, string[]>> {
  const { data, error } = await supabase.rpc('visit_people_all');
  if (error) throw error;
  const out = new Map<string, string[]>();
  for (const r of data ?? []) {
    const list = out.get(r.visit_id) ?? [];
    list.push(r.profile_id);
    out.set(r.visit_id, list);
  }
  return out;
}

export async function fetchPlaceVisitPeople(
  placeId: string,
): Promise<Map<string, { id: string; name: string | null }[]>> {
  const { data, error } = await supabase.rpc('place_visit_people', { p_place: placeId });
  if (error) throw error;
  const out = new Map<string, { id: string; name: string | null }[]>();
  for (const r of data ?? []) {
    const list = out.get(r.visit_id) ?? [];
    list.push({ id: r.profile_id, name: r.display_name });
    out.set(r.visit_id, list);
  }
  return out;
}

export async function fetchCardView(opts: {
  placeId?: string;
  visitId?: string;
}): Promise<CardView> {
  const { data, error } = await supabase.rpc('card_view', {
    p_place: opts.placeId ?? undefined,
    p_visit: opts.visitId ?? undefined,
  });
  if (error) throw error;
  return data as unknown as CardView;
}

/** One entry in the "+ Add an activity" dropdown. The list is DATA, not a hardcoded
 *  array, so adding an option is a row rather than a deploy. */
export interface ActivityOption {
  slug: string;
  label: string;
  /** route = something you did, on this visit. place = somewhere you went, which
   *  becomes a place with its own card and its own visits. */
  kind: 'route' | 'place';
}

export async function fetchActivityOptions(): Promise<ActivityOption[]> {
  const { data, error } = await supabase
    .from('activity_options')
    .select('slug, label, kind, sort')
    .eq('active', true)
    .order('sort');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    slug: r.slug,
    label: r.label,
    kind: r.kind as 'route' | 'place',
  }));
}

/** Log something we DID on this visit — a run, a walk, a hike, a ride.
 *  Idempotent on the client key, so a retried save cannot log it twice. */
export async function addActivityToVisit(args: {
  visitId: string;
  option: string;
  name?: string | null;
  distanceMeters?: number | null;
  clientKey?: string;
  /** Which day of the visit. Omitted = its first day. Outside it is an error. */
  day?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('add_activity_to_visit', {
    p_visit: args.visitId,
    p_option: args.option,
    p_name: args.name ?? undefined,
    p_distance_m: args.distanceMeters ?? undefined,
    p_client_key: args.clientKey ?? undefined,
    p_day: args.day ?? undefined,
  });
  if (error) throw error;
}

/** Add somewhere we WENT during this visit — a winery, a restaurant, a bar.
 *  "A restaurant is a place. A winery is a place. the dates are visits to those
 *  places." So this creates the place, groups it under this one, and gives it its
 *  own visit. Coordinates default to the parent place's. */
export async function addPlaceToVisit(args: {
  visitId: string;
  option: string;
  name: string;
  clientKey?: string;
  /** The day you went. A dinner is ONE day, not the whole trip — inheriting the
   *  parent's range made it multi-day, and a multi-day visit is a trip (§0.4). */
  day?: string | null;
}): Promise<{ id: string; name: string }> {
  const { data, error } = await supabase.rpc('add_place_to_visit', {
    p_visit: args.visitId,
    p_option: args.option,
    p_name: args.name,
    p_client_key: args.clientKey ?? undefined,
    p_day: args.day ?? undefined,
  });
  if (error) throw error;
  return data as unknown as { id: string; name: string };
}

/** Add a new option to the dropdown. `kind` is the model decision: something you
 *  did, or somewhere you went. */
export async function addActivityOption(
  label: string,
  kind: 'route' | 'place',
): Promise<ActivityOption> {
  const { data, error } = await supabase.rpc('add_activity_option', {
    p_label: label,
    p_kind: kind,
  });
  if (error) throw error;
  return data as unknown as ActivityOption;
}

export async function fetchTripContents(visitId: string): Promise<TripContent[]> {
  const { data, error } = await supabase.rpc('trip_contents', { p_visit: visitId });
  if (error) return [];
  return (data ?? []) as TripContent[];
}

// `fetchOccasionCount` was removed here (0280). It wrapped `occasion_count(p_profile)` —
// a reader whose null means "only the visits we were BOTH on" — and NOTHING had called it
// for as long as the audit could see. A p_profile wrapper sitting unused is the next
// screen's 17-versus-56: it typechecks, it reads plausibly, and its argument means the
// opposite of the identically-shaped argument next door. The database function stays;
// dropping one is a separate and riskier change.

export async function fetchItemCounts(): Promise<{ entries: number; visits: number }> {
  const [e, v] = await Promise.all([
    supabase.from('entries').select('*', { count: 'exact', head: true }),
    supabase.from('visits').select('*', { count: 'exact', head: true }),
  ]);
  return { entries: e.count ?? 0, visits: v.count ?? 0 };
}

/** The four category pills on Settings ▸ Stats, for a scope (§0.2, migration 0280).
 *
 *  This used to be `settings_stats(p_profile)`, where a null meant "only the places we were
 *  BOTH on" — while /insights asked the same question of the newer reader, where an empty
 *  list means no filter at all. Same word, opposite meanings, and 17 Trips beside 56. */
export async function fetchSettingsStatsForPeople(
  personIds: string[],
  mode: 'all' = 'all',
): Promise<SettingsStats | null> {
  const { data, error } = await supabase.rpc('settings_stats_for_people', {
    p_people: personIds,
    p_mode: mode,
  });
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

// The trip-as-a-table helpers — fetchTripTimeline, fetchTripNotes, addTripNote,
// deleteTripNote and their types — were removed in §0.8 phase 8 step 1 (migration
// 0182), along with the `trip_notes`/`trip_people` tables they wrote. Both tables were
// empty and nothing called any of it. A trip is a qualifying VISIT (§0.1); its contents
// come from `card_view`, and a note lives on the visit.

export interface ClimbingStats {
  total_ft: number;
  everests: number;
}
/** Total vertical climbed + Everests, for a scope. One outing counted once (§0.2). */
export async function fetchClimbingStatsForPeople(
  personIds: string[],
  mode: 'all' = 'all',
): Promise<ClimbingStats> {
  const { data, error } = await supabase.rpc('climbing_stats_for_people', {
    p_people: personIds,
    p_mode: mode,
  });
  if (error) return { total_ft: 0, everests: 0 };
  const row = (Array.isArray(data) ? data[0] : data) ?? {};
  return { total_ft: Number(row.total_ft ?? 0), everests: Number(row.everests ?? 0) };
}

/** Summits reached — matched from hike GPS tracks against OSM peaks, scoped by the
 *  OUTING each was bagged on. The old reader scoped by `peak_bags.profile_id`, and the
 *  six production rows that carry none were handed to everybody. */
export async function fetchPeaksBaggedForPeople(
  personIds: string[],
  mode: 'all' = 'all',
): Promise<Peak[]> {
  const { data, error } = await supabase.rpc('peaks_bagged_for_people', {
    p_people: personIds,
    p_mode: mode,
  });
  if (error) return [];
  return (data ?? []) as Peak[];
}

/** How many US states / world countries we've actually set foot in (not bucket).
 *
 *  Scoped by the places you were ON A VISIT to — the set `place_ids_for_people` gives the
 *  map's markers. The old reader scoped by `place_people()`, which answers who TOUCHED the
 *  record (created it, uploaded a photo, has an activity there), so Settings could report a
 *  state the map showed no pin in. */
export async function fetchGeoCoverageForPeople(
  personIds: string[],
  mode: 'all' = 'all',
): Promise<GeoCoverage | null> {
  const { data, error } = await supabase.rpc('geo_coverage_for_people', {
    p_people: personIds,
    p_mode: mode,
  });
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
    p_rating: sqlNull(rating), // null clears the rating
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
    p_lat: lat ?? undefined,
    p_lng: lng ?? undefined,
    p_radius_km: radiusKm ?? undefined,
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
    p_lat: lat ?? undefined,
    p_lng: lng ?? undefined,
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
  /** Places that might be the same place. Repair lived only at /duplicates, reachable from
   *  Settings, so the repair queue never mentioned it and the only way to find out whether
   *  anything needed merging was to go and look. */
  duplicatePlaces: number;
  /** 0219: the Review inbox folded in. Erica, 2026-08-18: "Needs Attention and Review
   *  Inbox are redundant. Put anything unique in Review Inbox into needs attentions."
   *  Two screens listing what is waiting is one screen too many — and the cards were the
   *  half she could not find. */
  reviewCards: number;
  tagsToConfirm: number;
  /** Photographs somebody says you are in (0247/0248). Counted apart from the outing tags
   *  because they are a different question — being in a photograph is not being on a run. */
  photoTagsToConfirm: number;
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
  // Counted with the SAME function /duplicates lists with, over the places already loaded
  // above — so the number on the dashboard and the rows on the repair screen cannot
  // disagree. A failed dismissal read counts every pair, which over-reports rather than
  // hiding work: the harm of a row that turns out to be settled is a wasted click.
  const duplicatePlaces = duplicatePairs(
    places,
    await fetchDismissedDupes().catch(() => new Set<string>()),
  ).length;
  const [unassigned, actNoPlace, noDate] = await Promise.all([
    supabase.from('photos').select('*', { count: 'exact', head: true }).is('place_id', null),
    supabase.from('activities').select('*', { count: 'exact', head: true }).is('place_id', null),
    supabase.from('photos').select('*', { count: 'exact', head: true }).is('taken_at', null),
  ]);
  // The review cards, counted here so ONE screen answers "what is waiting for me".
  // Failures are swallowed to zero on purpose: a dashboard that cannot render because one
  // count is unavailable is worse than a dashboard that is briefly short by one row.
  // Promise.resolve() around each: the Supabase builder is a THENABLE, not a Promise, so
  // it has .then but no .catch — chaining .catch straight onto it does not compile.
  const [cards, tags, photoTags] = await Promise.all([
    Promise.resolve(supabase.rpc('inbox_counts'))
      .then((r) => (r.data as unknown as { cards?: number } | null)?.cards ?? 0)
      .catch(() => 0),
    Promise.resolve(supabase.rpc('my_tags_to_confirm', {}))
      .then((r) => (Array.isArray(r.data) ? r.data.length : 0))
      .catch(() => 0),
    Promise.resolve(supabase.rpc('my_memory_tags_to_confirm'))
      .then((r) => (Array.isArray(r.data) ? r.data.length : 0))
      .catch(() => 0),
  ]);
  return {
    reviewCards: cards,
    tagsToConfirm: tags,
    photoTagsToConfirm: photoTags,
    unassignedPhotos: unassigned.count ?? 0,
    photosNoDate: noDate.count ?? 0,
    unnamedPlaces,
    missingCategories,
    missingDates,
    activitiesNoPlace: actNoPlace.count ?? 0,
    suggestedTrips,
    duplicatePlaces,
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
  // No is_trip: §0.4 says a trip is multi-day OR marked, and `trip_marked` is the
  // marking. The column is a mirror of trip_marked kept in step by a trigger, and it
  // is on its way out — nothing should start reading it again in the meantime.
  'id, place_id, start_date, end_date, note, trip_marked, status, solo_override, created_at';

/** Manually set who a visit belongs to (null = both). Sticks across rebuilds.
 *
 *  RETURNS WHAT HAPPENED (0243), because since 0240 naming somebody else is a QUESTION and
 *  not a fact: `{ stated, asked, removed }`. A caller that drops it will show the person a
 *  change that has not happened yet. */
export async function setVisitSolo(visitId: string, profileId: string | null): Promise<WhoOutcome> {
  const { data, error } = await supabase.rpc('set_visit_solo', {
    p_visit: visitId,
    p_profile: sqlNull(profileId), // null = both
  });
  if (error) throw error;
  return asOutcome(data);
}

/** Set who a whole (leaf) place belongs to — sets all its visits. null = both.
 *  Naming somebody else raises ONE question about the place (0240/0242). */
export async function setPlaceSolo(placeId: string, profileId: string | null): Promise<WhoOutcome> {
  const { data, error } = await supabase.rpc('set_place_solo', {
    p_place: placeId,
    p_profile: sqlNull(profileId), // null = both
  });
  if (error) throw error;
  return asOutcome(data);
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
/** Look up the NAMED PLACE at a point from OpenStreetMap (Nominatim reverse).
 *  Suggestions only — the caller decides whether to apply them.
 *
 *  `layer=poi` is the whole difference between this being useful and being wrong.
 *  Without it, reverse geocoding answers with the area you are INSIDE: a pin dropped
 *  on a highway in Kansas came back "Coffey County", which is not a place anyone
 *  wants named on their card. With it, Nominatim answers with the point of interest
 *  or nothing at all — measured 2026-08-30: Katz's Delicatessen returns
 *  "Katz's Delicatessen" + its website, and the Kansas highway returns "Unable to
 *  geocode", i.e. null. The caller (lib/draftPrefill) still discards roads, suburbs
 *  and boundaries, because `layer=poi` also admits bus stops and rail platforms.
 *
 *  Nominatim is a free, rate-limited service used courteously: one request per
 *  opened card, no polling, no retry loop. */
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
        layer: 'poi',
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
      // "Unable to geocode" — a 200 with nothing in it, which is the honest answer
      // for a point with no point of interest anywhere near it.
      error?: string;
    };
    if (d.error) return null;
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

// `fetchPlaceVisitCounts(profileId)` was removed here (0280) — the map has read
// `place_visit_counts_for_people` since 0260 and nothing else called it.

/**
 * Visits per place, BY ANYBODY (0190).
 *
 * Not the same question as the map badge, which answers "in this scope". Two screens are
 * not asking from inside a scope at all:
 * which of two duplicate places should survive a merge, and whether we have been
 * somewhere more than once. Both read `places.visit_count` for want of anything else,
 * and that column is a mirror nobody refreshes when a VISIT changes — production had
 * the Appalachian Trail on 39 against 32 real visits, because merging two visits into
 * one takes the count down and leaves the column alone.
 */
export async function fetchPlaceVisitTotals(): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('place_visit_totals');
  if (error) throw error;
  const out = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ place_id: string; visits: number }>) {
    out.set(row.place_id, row.visits);
  }
  return out;
}

/** THE PEOPLE FILTER, as the map now asks it (0260).
 *
 *  An EMPTY list means "Anyone" — no filter at all — where the old
 *  `place_ids_for_view(null)` meant SHARED, i.e. only what both of them were on. "Together"
 *  is now `all` with both selected: the same set, one tap, no longer the default. */
export async function fetchPlaceIdsForPeople(
  personIds: string[],
  mode: 'all' = 'all',
): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('place_ids_for_people', {
    p_people: personIds,
    p_mode: mode,
  });
  if (error) throw error;
  return new Set(
    (data ?? []).map((r: { place_ids_for_people: string } | string) =>
      typeof r === 'string' ? r : r.place_ids_for_people,
    ),
  );
}

export async function fetchPlaceVisitCountsForPeople(
  personIds: string[],
  mode: 'all' = 'all',
): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('place_visit_counts_for_people', {
    p_people: personIds,
    p_mode: mode,
  });
  if (error) throw error;
  const out = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ place_id: string; visits: number }>)
    out.set(r.place_id, r.visits);
  return out;
}

// `fetchPlaceIdsForView(profileId)` was removed here (0280) — superseded by
// `fetchPlaceIdsForPeople` in 0260 and uncalled since.

/** Every visit across all places (for the bulk editor's per-visit dropdowns). */
export async function fetchAllVisits(): Promise<Visit[]> {
  const { data, error } = await supabase
    .from('visits')
    .select(VISIT_COLS)
    .order('start_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Visit[];
}

/** Visits for several places at once — a container's card needs its sections'
 *  dates, and one request beats one per section. */
export async function fetchVisitsForPlaces(placeIds: string[]): Promise<Visit[]> {
  if (placeIds.length === 0) return [];
  const { data, error } = await supabase
    .from('visits')
    .select(VISIT_COLS)
    .in('place_id', placeIds)
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
 * Zero callers — `PlacePanel.addSpot` was the last
 * one and now uses the canonical path. Retained only as a compatibility export;
 * a lint rule keeps it unused.
 */
export async function addVisit(
  placeId: string,
  start: string,
  end: string,
  clientKey?: string,
): Promise<Visit> {
  // Through `create_visit`: it validates the range, and with a client key a retry
  // after a dropped connection returns the SAME visit instead of logging a second.
  const { data, error } = await supabase.rpc('create_visit', {
    p_place: placeId,
    p_start: start,
    p_end: end,
    p_client_key: clientKey ?? undefined,
  });
  if (error) throw error;
  return data as unknown as Visit;
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
    p_scope: scope ?? undefined,
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

/** Everything needed to put a deleted visit back — produced by {@link deleteVisit},
 *  consumed by {@link restoreVisit}. Opaque on purpose: the server decides what an
 *  undo has to carry, and it is more than the visit row (participants, companions,
 *  evidence, what the visit contained and what contained it). */
export type VisitSnapshot = Json;

/**
 * Delete a visit and get back everything needed to undo it.
 *
 * Goes through `delete_visit` rather than deleting the row, because the row is not the
 * whole story. `visits.parent_visit_id` is ON DELETE SET NULL, so deleting a trip used
 * to quietly free every visit grouped inside it — no error, no record, and an Undo that
 * restored the trip but not what was in it. The RPC REFUSES that by default; pass
 * `'detach'` only after the person has been told what it will do.
 */
export async function deleteVisit(
  id: string,
  children: 'refuse' | 'detach' = 'refuse',
): Promise<VisitSnapshot> {
  const { data, error } = await supabase.rpc('delete_visit', {
    p_visit: id,
    p_children: children,
  });
  if (error) throw error;
  return data as VisitSnapshot;
}

/** True when a delete was refused because the visit still holds others. The caller can
 *  then offer to detach them instead of failing with a raw database message. */
export function isTripNotEmpty(e: unknown): boolean {
  return e instanceof Error && /still contains/.test(e.message);
}

/** Put back what {@link deleteVisit} removed — dates, note, attribution, participants,
 *  companions, evidence, and the grouping in both directions. The original id is reused
 *  when it is still free, so anything holding a reference still resolves. */
export async function restoreVisit(snapshot: VisitSnapshot): Promise<Visit> {
  const { data, error } = await supabase.rpc('restore_visit', { p_snapshot: snapshot });
  if (error) throw error;
  return data as unknown as Visit;
}

/** Reassign a visit to a different place (e.g. move a generic city visit to a
 *  specific spot with its own address).
 *
 *  Through `move_visit_to_place`, not a bare UPDATE: moving a visit has to carry its
 *  photos and activities with it and record the approval, which an UPDATE of one column
 *  silently skips. */
export async function moveVisit(id: string, newPlaceId: string): Promise<void> {
  const { error } = await supabase.rpc('move_visit_to_place', {
    p_visit: id,
    p_place: newPlaceId,
  });
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
 * Prefer this over `createPlace` everywhere. The direct
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
  // One RPC, one transaction. This used to DELETE then INSERT as two separate
  // requests, so a dropped connection between them left the visit with nobody on it.
  const { error } = await supabase.rpc('set_visit_people', {
    p_visit: visitId,
    p_people: personIds,
  });
  if (error) throw error;
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
// The duplicate rule and its key live in ./duplicatePlaces, because /attention and
// /duplicates both need them and a count that disagrees with the list it links to is the
// most annoying version of this codebase's recurring defect. Re-exported so every existing
// caller is unchanged.
export { dupeKey } from './duplicatePlaces';

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
  // Reject: take this trip off every member, then delete the draft. Through
  // remove_from_container rather than rewriting the array by hand — the same reason
  // 0178 exists.
  const members = await fetchPlaceMemberships();
  for (const [childId, parents] of members) {
    if (parents.includes(id)) await removeFromContainer(childId, id);
  }
  const { error } = await supabase.from('places').delete().eq('id', id);
  if (error) throw error;
}
