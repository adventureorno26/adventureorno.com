// Application-facing shapes. The authoritative schema is supabase/migrations.
// Geography columns are exposed to the client as plain lat/lng doubles; the DB
// keeps a generated geography(Point,4326) column in sync for spatial queries.

export type Role = 'owner' | 'editor';

export type EntryKind = 'restaurant' | 'activity' | 'stay' | 'note';

export const ENTRY_KINDS: EntryKind[] = ['restaurant', 'activity', 'stay', 'note'];

export interface Profile {
  id: string;
  role: Role;
  display_name: string | null;
  created_at: string;
}

export interface Place {
  id: string;
  name: string;
  country: string | null;
  admin1: string | null; // state / province
  lat: number;
  lng: number;
  first_visit: string | null; // date
  last_visit: string | null; // date
  cover_photo_id: string | null;
  auto: boolean; // created by the clustering job; badge until first edited
  needs_geocode: boolean;
  visit_count: number;
  created_by: string | null;
  created_at: string;
}

export type PhotoSource = 'shortcut' | 'manual';

export interface Photo {
  id: string;
  place_id: string | null;
  lat: number;
  lng: number;
  taken_at: string | null;
  width: number | null;
  height: number | null;
  is_landscape: boolean | null;
  source: PhotoSource;
  uploaded_by: string | null;
  created_at: string;
}

export interface Entry {
  id: string;
  place_id: string;
  kind: EntryKind;
  title: string;
  body: string | null; // markdown
  rating: number | null; // 1..5
  url: string | null;
  date: string | null; // date
  created_by: string | null;
  created_at: string;
}

export interface Activity {
  id: string;
  strava_id: number | null;
  type: string; // Hike / Walk / Run / Ride / ...
  name: string | null;
  distance: number; // meters
  moving_time: number | null; // seconds
  elapsed_time: number | null;
  start_date: string | null;
  lat: number;
  lng: number;
  summary_polyline: string | null;
  place_id: string | null;
}

export interface MileageRow {
  type: string;
  activity_count: number;
  meters: number;
  miles: number;
}

// Draft shapes for inserts (server fills id / created_at / created_by).
export type NewPlace = Pick<Place, 'name' | 'country' | 'admin1' | 'lat' | 'lng'> &
  Partial<Pick<Place, 'first_visit' | 'last_visit'>>;

export type NewEntry = Pick<Entry, 'place_id' | 'kind' | 'title'> &
  Partial<Pick<Entry, 'body' | 'rating' | 'url' | 'date'>>;
