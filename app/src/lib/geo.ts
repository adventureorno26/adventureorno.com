// Pure geo helpers.

export interface LngLat {
  lng: number;
  lat: number;
}

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

export const METERS_PER_MILE = 1609.344;

/** Meters → statute miles, rounded to 1 decimal (used by the stats bar). */
export function metersToMiles(meters: number): number {
  return Math.round((meters / METERS_PER_MILE) * 10) / 10;
}
