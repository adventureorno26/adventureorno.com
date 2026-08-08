// Trips — canonical model (ADR 0001, Option A). A Trip is a first-class `trips` row;
// its Places are EXPLICIT `trip_stops` (nothing attaches by date). A Trip is a trip
// TO one or more Places. Reads are member-gated + draft-private on the server.

import { supabase } from './supabase';
import type { Place, Trip, TripStats, TripStop, TripStopStatus, TripStatus } from './types';
import { createPlaceAtomic } from './data';
import { forwardGeocode } from './maptiler';

const TRIP_COLS = 'id, name, start_date, end_date, status, source_place_id, created_at';
const STOP_COLS = 'id, trip_id, place_id, visit_id, status, sort_order, note';
const PLACE_COLS =
  'id, name, country, admin1, lat, lng, first_visit, last_visit, cover_photo_id, auto, needs_geocode, visit_count, saved, is_trail, part_of, suggested, category, holds_children, cover_pos_y, address, created_by, created_at';

/** All trips, newest first. Grouped by month/year in the UI. */
export async function fetchTrips(): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select(TRIP_COLS)
    .order('start_date', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Trip[];
}

/** Auto-detected trip DRAFTS awaiting your review. These are NOT trips — they only
 *  become trips if you confirm one. */
export async function fetchSuggestedTripDrafts(): Promise<Place[]> {
  const { data, error } = await supabase
    .from('places')
    .select(PLACE_COLS)
    .eq('category', 'trip')
    .eq('suggested', true)
    .is('deleted_at', null)
    .order('first_visit', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Place[];
}

/** Confirm a suggested draft into a canonical Trip. Returns the new trip id (or null
 *  if it couldn't be migrated, e.g. it has no dates). */
export async function confirmSuggestedTrip(placeId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('confirm_suggested_trip', { p_place: placeId });
  if (error) throw error;
  return (data as unknown as string) ?? null;
}

/** One place by id (used to load a suggested draft for review). */
export async function fetchPlaceById(id: string): Promise<Place | null> {
  const { data } = await supabase.from('places').select(PLACE_COLS).eq('id', id).maybeSingle();
  return (data as unknown as Place) ?? null;
}

/** The member places of a container draft (leaf places whose part_of includes it). */
export async function fetchDraftMembers(draftId: string): Promise<Place[]> {
  const { data, error } = await supabase
    .from('places')
    .select(PLACE_COLS)
    .contains('part_of', [draftId])
    .is('deleted_at', null)
    .order('first_visit', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return ((data ?? []) as unknown as Place[]).filter(
    (p) => p.category !== 'trip' && !p.holds_children,
  );
}

/** Remove a member from a draft (keeps part_of + place_membership in sync). */
export async function removeDraftMember(childId: string, draftId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_from_container', {
    p_child: childId,
    p_parent: draftId,
  });
  if (error) throw error;
}

/** The canonical Trip a migrated container-Place became (via source_place_id), if
 *  any — used to redirect old /place/:containerId links to /trip/:id. */
export async function fetchTripBySourcePlace(placeId: string): Promise<Trip | null> {
  const { data } = await supabase
    .from('trips')
    .select(TRIP_COLS)
    .eq('source_place_id', placeId)
    .maybeSingle();
  return (data as Trip) ?? null;
}

/** Trips whose stops include this Place — powers "Trips to this place" on a place
 *  card. A Place can appear on a trip via several stops; dedupe to one row per trip. */
export async function fetchTripsForPlace(placeId: string): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trip_stops')
    .select(`trips!inner(${TRIP_COLS})`)
    .eq('place_id', placeId);
  if (error) throw error;
  const byId = new Map<string, Trip>();
  for (const row of (data ?? []) as unknown as Array<{ trips: Trip }>) {
    if (row.trips) byId.set(row.trips.id, row.trips);
  }
  return [...byId.values()].sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''));
}

export async function createTrip(
  name: string,
  start: string | null,
  end: string | null,
  status: TripStatus = 'taken',
): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .insert({ name, start_date: start, end_date: end, status })
    .select(TRIP_COLS)
    .single();
  if (error) throw error;
  return data as Trip;
}

/** Move a trip between Trips Taken and Upcoming Trips. */
export async function setTripStatus(id: string, status: TripStatus): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .update({ status })
    .eq('id', id)
    .select(TRIP_COLS)
    .single();
  if (error) throw error;
  return data as Trip;
}

export async function renameTrip(id: string, name: string): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .update({ name })
    .eq('id', id)
    .select(TRIP_COLS)
    .single();
  if (error) throw error;
  return data as Trip;
}

/** Change a trip's date range. */
export async function updateTripDates(id: string, start: string, end: string): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .update({ start_date: start, end_date: end })
    .eq('id', id)
    .select(TRIP_COLS)
    .single();
  if (error) throw error;
  return data as Trip;
}

export async function deleteTrip(id: string): Promise<void> {
  const { error } = await supabase.from('trips').delete().eq('id', id);
  if (error) throw error;
}

/** Merge several trips into the earliest-starting one: move every stop onto it and
 *  delete the rest. Explicit stops move with the trip, so nothing is lost. */
export async function mergeTrips(ids: string[]): Promise<void> {
  if (ids.length < 2) return;
  const { data, error } = await supabase.from('trips').select(TRIP_COLS).in('id', ids);
  if (error) throw error;
  const rows = (data ?? []) as Trip[];
  if (rows.length < 2) return;
  const keep = rows.reduce((a, b) => ((a.start_date ?? '') <= (b.start_date ?? '') ? a : b));
  const drop = ids.filter((id) => id !== keep.id);
  const { error: mvErr } = await supabase
    .from('trip_stops')
    .update({ trip_id: keep.id })
    .in('trip_id', drop);
  if (mvErr) throw mvErr;
  const { error: delErr } = await supabase.from('trips').delete().in('id', drop);
  if (delErr) throw delErr;
}

export async function fetchTripStats(tripId: string): Promise<TripStats> {
  const { data, error } = await supabase.rpc('trip_stats', { p_trip: tripId });
  if (error) throw error;
  return data as unknown as TripStats;
}

/** The explicit stops on a trip, in order. */
export async function fetchTripStops(tripId: string): Promise<TripStop[]> {
  const { data, error } = await supabase
    .from('trip_stops')
    .select(STOP_COLS)
    .eq('trip_id', tripId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as TripStop[];
}

/** The trip's Places (draft-private, server-filtered via trip_place_ids). */
export async function fetchTripPlaces(trip: Trip): Promise<Place[]> {
  const { data: idRows, error: idErr } = await supabase.rpc('trip_place_ids', { p_trip: trip.id });
  if (idErr) throw idErr;
  const ids = (idRows ?? []) as unknown as string[];
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('places').select(PLACE_COLS).in('id', ids);
  if (error) throw error;
  return (data ?? []) as unknown as Place[];
}

/** Add a Place to a trip as a planned stop (idempotent per trip+place). */
/**
 * @deprecated Pass `trip: { id }` to {@link createPlaceAtomic} instead (migration
 * 0124), so the place and its stop commit together and a retry cannot duplicate
 * either. A standalone stop insert is a second, separately-failing request.
 *
 * Zero callers as of COMPLETION-PLAN Phase 2. Retained only as a compatibility
 * export; a lint rule keeps it unused.
 */
export async function addStop(
  tripId: string,
  placeId: string,
  status: TripStopStatus = 'planned',
): Promise<void> {
  const { error } = await supabase
    .from('trip_stops')
    .insert({ trip_id: tripId, place_id: placeId, status });
  if (error && error.code !== '23505') throw error; // ignore duplicate planned stop
}

/** Remove a stop from a trip. */
export async function removeStop(stopId: string): Promise<void> {
  const { error } = await supabase.from('trip_stops').delete().eq('id', stopId);
  if (error) throw error;
}

/**
 * Add a place to a trip by name: geocode it, then create the Place AND its trip
 * stop in one atomic, idempotent call (migration 0124).
 *
 * This used to be two requests — createPlaceAtomic then addStop. If the second
 * failed, the trip gained nothing while a stray place was left behind, and the
 * retry minted a fresh idempotency key so it created a SECOND place instead of
 * completing the first attempt. One key, one transaction fixes both.
 */
export async function addPlaceToTrip(trip: Trip, query: string): Promise<Place> {
  const geo = await forwardGeocode(query.trim());
  if (!geo) throw new Error(`Couldn't find "${query}". Try a more specific name.`);
  return createPlaceAtomic({
    name: geo.name,
    country: geo.country,
    admin1: geo.admin1,
    address: geo.address,
    lat: geo.lat,
    lng: geo.lng,
    saved: true,
    trip: { id: trip.id, status: 'planned' },
  });
}
