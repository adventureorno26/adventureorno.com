// Pure geo helpers. The home-exclusion zone is enforced authoritatively at
// ingest (server-side) using the `settings` table, but the client mirrors the
// math to warn before a manual "add place" lands inside the zone.

export interface LngLat {
  lng: number;
  lat: number;
}

export interface HomeZone {
  lat: number;
  lng: number;
  radiusMeters: number;
}

// Home-exclusion zone: 3 statute miles around the house in Leesburg, VA. This
// is a client-side fallback default only — the server reads the live value from
// the `settings` table (kept in sync there). Manual place-adds are NOT blocked
// by this on the client anymore; it only informs the automated-ingest gate.
export const DEFAULT_HOME_ZONE: HomeZone = {
  lat: 39.110924,
  lng: -77.509204,
  radiusMeters: 4828, // 3 miles
};

const EARTH_RADIUS_M = 6371008.8; // mean Earth radius (IUGG)

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two points in meters (Haversine). */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when the point falls inside (or on) the home-exclusion zone. */
export function isInHomeZone(point: LngLat, zone: HomeZone = DEFAULT_HOME_ZONE): boolean {
  return haversineMeters(point, { lng: zone.lng, lat: zone.lat }) <= zone.radiusMeters;
}

export const METERS_PER_MILE = 1609.344;

/** Meters → statute miles, rounded to 1 decimal (used by the stats bar). */
export function metersToMiles(meters: number): number {
  return Math.round((meters / METERS_PER_MILE) * 10) / 10;
}
