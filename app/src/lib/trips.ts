// Trips: a named date range. Places "belong" to a trip when their first_visit
// falls in the range (computed, not stored). Stats come from the trip_stats RPC.

import { supabase } from './supabase';
import type { Place, Trip, TripStats } from './types';

const TRIP_COLS = 'id, name, start_date, end_date, created_at';
const PLACE_COLS =
  'id, name, country, admin1, lat, lng, first_visit, last_visit, cover_photo_id, auto, needs_geocode, visit_count, created_by, created_at';

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
