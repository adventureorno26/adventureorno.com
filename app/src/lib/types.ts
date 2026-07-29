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
  cover_pos_y: number; // 0-100, vertical focal point for the cover crop
  address: string | null; // full street address / label (from geocoding)
  city: string | null; // city / locality (for trip grouping)
  auto: boolean; // created by the clustering job; badge until first edited
  needs_geocode: boolean;
  visit_count: number;
  rating: number | null; // 1..5 overall place rating
  review: string | null; // overall place review
  is_home: boolean;
  saved: boolean; // must be explicitly saved to show on the map / count in stats
  is_trail: boolean; // a linear trail (W&OD, AT, …); runs/hikes group by trailhead
  part_of: string[]; // ids of places this one is "part of" (trips, trails, …)
  suggested: boolean; // an auto-detected draft awaiting confirmation (e.g. a trip)
  bucket: boolean; // want-to-go wishlist place (not yet visited)
  website: string | null; // optional link for a bucket-list place
  categories: string[]; // manual tags
  activity_categories: string[]; // auto tags from Strava
  solo_profile: string | null; // legacy place-level attribution (superseded by visit-level)
  favorite: string | null; // favorite wine / meal / beer at this place
  holds_children: boolean; // container (trail/trip/city) — no attribution toggle
  category: string | null; // normalized singular category
  park: string | null; // national park / public land this place falls inside
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
  is_trip: boolean; // end_date > start_date (multi-day)
  solo_profile: string | null; // who was on this visit (null = both of us)
  solo_override: boolean; // true = human-set; kept across rebuilds
  created_at: string;
}

export interface Video {
  id: string;
  place_id: string | null;
  poster_key: string | null;
  taken_at: string | null;
  duration_s: number | null;
  created_at: string;
}

export type PhotoSource = 'shortcut' | 'manual';

export interface Photo {
  id: string;
  place_id: string | null;
  lat: number | null; // null = no GPS (stored unassigned → Sorter inbox)
  lng: number | null;
  taken_at: string | null;
  width: number | null;
  height: number | null;
  is_landscape: boolean | null;
  source: PhotoSource;
  uploaded_by: string | null;
  entry_id: string | null;
  created_at: string;
  caption: string | null;
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  accepted_at: string | null;
  created_at: string;
  expires_at: string;
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
  address: string | null; // spot's own street address (for its Directions button)
  lat: number | null; // spot's own coordinates (optional; from geocoding)
  lng: number | null;
  created_by: string | null;
  created_at: string;
}

export interface Activity {
  id: string;
  strava_id: number | null;
  type: string; // Hike / Walk / Run / Ride / ...
  name: string | null;
  distance: number; // meters
  elevation_gain: number | null; // meters (from Strava total_elevation_gain)
  elevation_profile: number[] | null; // ~30 sampled elevations (m) for the chart
  moving_time: number | null; // seconds
  elapsed_time: number | null;
  start_date: string | null;
  lat: number;
  lng: number;
  summary_polyline: string | null;
  place_id: string | null;
  trailhead: string | null; // where this run started on a trail (falls back to name)
  solo_profile: string | null; // who did it (null = both of us)
}

export interface SharedLink {
  id: string;
  label: string;
  url: string;
  created_by: string | null;
  created_at: string;
}

export type BoardKind = 'drink' | 'eat' | 'watch' | 'visit' | 'listen';

export interface BoardItem {
  id: string;
  board: BoardKind;
  title: string;
  url: string | null;
  note: string | null;
  done: boolean;
  done_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MileageRow {
  type: string;
  activity_count: number;
  meters: number;
  miles: number;
}

// Draft shapes for inserts (server fills id / created_at / created_by).
export type NewPlace = Pick<Place, 'name' | 'country' | 'admin1' | 'lat' | 'lng'> &
  Partial<
    Pick<
      Place,
      | 'first_visit'
      | 'last_visit'
      | 'address'
      | 'city'
      | 'bucket'
      | 'website'
      | 'is_trail'
      | 'saved'
      | 'categories'
      | 'part_of'
      | 'needs_geocode'
    >
  >;

export type NewEntry = Pick<Entry, 'place_id' | 'kind' | 'title'> &
  Partial<Pick<Entry, 'body' | 'rating' | 'url' | 'date' | 'address' | 'lat' | 'lng'>>;

// A Trip is a first-class planning + journal container (ADR 0001, Option A). It is
// NOT a Place — it is a trip TO one or more Places, linked by explicit `trip_stops`
// (a Trip only ever contains what you put on it; nothing auto-attaches by date).
export type TripStatus = 'taken' | 'upcoming';
export type TripStopStatus = 'planned' | 'completed' | 'skipped';

export interface Trip {
  id: string;
  name: string;
  start_date: string | null; // date; null = an undated draft
  end_date: string | null; // date
  status: TripStatus;
  source_place_id: string | null; // provenance of a migrated container-Place trip
  created_at: string;
}

// One Place on a Trip. `completed` carries the evidence visit; `planned` has none.
export interface TripStop {
  id: string;
  trip_id: string;
  place_id: string;
  visit_id: string | null;
  status: TripStopStatus;
  sort_order: number;
  note: string | null;
}

// Aggregate stats for a trip (from the trip_stats RPC), from its linked completed
// stops only (never date-range inference).
export interface TripStats {
  places: number;
  visits: number;
  miles: number;
  days: number | null;
}
