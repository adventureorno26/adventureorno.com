// Application-facing shapes. The authoritative schema is supabase/migrations.
// Geography columns are exposed to the client as plain lat/lng doubles; the DB
// keeps a generated geography(Point,4326) column in sync for spatial queries.

export type Role = 'owner' | 'editor' | 'viewer';

// A spot's "kind" is now a category slug (dining, winery, …) or 'note'.
export type EntryKind = string;

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
  rating: number | null; // 1..5 overall place rating
  review: string | null; // overall place review
  is_home: boolean;
  categories: string[]; // manual tags
  activity_categories: string[]; // auto tags from Strava
  created_by: string | null;
  created_at: string;
}

export interface PlaceDay {
  day: string; // date
  activities: number;
  entries: number;
  photos: number;
  pings: number;
  label: string | null; // Strava activity name for that day, if any
}

export interface Visit {
  id: string;
  place_id: string;
  start_date: string; // date
  end_date: string; // date (= start_date for a single-day visit)
  note: string | null;
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
  entry_id: string | null;
  created_at: string;
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  accepted_at: string | null;
  created_at: string;
  expires_at: string;
}

export interface Trip {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

export interface TripStats {
  places: number;
  photos: number;
  miles: number;
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
