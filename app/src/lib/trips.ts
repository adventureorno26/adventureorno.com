// Trips: a named date range. Places "belong" to a trip when their first_visit
// falls in the range (computed, not stored). Stats come from the trip_stats RPC.

import { supabase } from './supabase';
import type { Place, Trip, TripStats } from './types';
import { createPlace, updatePlace, addVisit } from './data';
import { forwardGeocode } from './maptiler';
import { isInHomeZone } from './geo';

const TRIP_COLS = 'id, name, start_date, end_date, created_at';
const PLACE_COLS =
  'id, name, country, admin1, lat, lng, first_visit, last_visit, cover_photo_id, auto, needs_geocode, visit_count, cover_pos_y, address, created_by, created_at';

export async function fetchTrips(): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select(TRIP_COLS)
    .order('start_date', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Trip[];
}

export async function createTrip(name: string, start: string, end: string): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .insert({ name, start_date: start, end_date: end })
    .select(TRIP_COLS)
    .single();
  if (error) throw error;
  return data as Trip;
}

export async function deleteTrip(id: string): Promise<void> {
  const { error } = await supabase.from('trips').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchTripStats(tripId: string): Promise<TripStats> {
  const { data, error } = await supabase.rpc('trip_stats', { p_trip: tripId });
  if (error) throw error;
  return data as TripStats;
}

/** Add a place to a trip by name: geocode it, drop a real map pin, and date it
 *  into the trip range (so it belongs to the trip and shows on the map). */
export async function addPlaceToTrip(trip: Trip, query: string): Promise<Place> {
  const start = trip.start_date;
  const end = trip.end_date ?? trip.start_date;
  if (!start || !end) throw new Error('This trip has no dates set.');
  const geo = await forwardGeocode(query.trim());
  if (!geo) throw new Error(`Couldn't find "${query}". Try a more specific name.`);
  if (isInHomeZone({ lng: geo.lng, lat: geo.lat })) {
    throw new Error('That location is inside the 15-mile home zone and is not tracked.');
  }
  const place = await createPlace({
    name: geo.name,
    country: geo.country,
    admin1: geo.admin1,
    address: geo.address,
    lat: geo.lat,
    lng: geo.lng,
  });
  // Date it into the trip so it belongs + shows a visit on its card.
  await updatePlace(place.id, { first_visit: start, last_visit: end });
  await addVisit(place.id, start, end).catch(() => undefined);
  return { ...place, first_visit: start, last_visit: end };
}

/** Places auto-attached to a trip: first_visit within the trip's date range. */
export async function fetchTripPlaces(trip: Trip): Promise<Place[]> {
  if (!trip.start_date || !trip.end_date) return [];
  const { data, error } = await supabase
    .from('places')
    .select(PLACE_COLS)
    .gte('first_visit', trip.start_date)
    .lte('first_visit', trip.end_date)
    .order('first_visit');
  if (error) throw error;
  return (data ?? []) as Place[];
}
