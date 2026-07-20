// Passive walk tracking: turn raw location pings into walking/hiking route
// segments, excluding driving and flying. We split the ordered ping stream
// wherever the implied speed is too high (a drive/flight) or there's a long
// time gap, then keep the slow, continuous stretches.

import { supabase } from './supabase';

export interface Ping {
  lat: number;
  lng: number;
  recorded_at: string;
}

const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
function metersBetween(a: Ping, b: Ping): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Speed ceiling for "on foot": 4.5 m/s ≈ 16 km/h ≈ 10 mph (a fast run). Anything
// faster is treated as driving/flying and breaks the segment.
const MAX_FOOT_SPEED = 4.5;
const MAX_GAP_SECONDS = 300; // >5 min between pings → separate outings
const MIN_SEG_POINTS = 4;
const MIN_SEG_METERS = 120;

/** Ordered pings → array of walking-speed LineStrings ([lng,lat][]). */
export function walkSegments(pings: Ping[]): [number, number][][] {
  const segments: [number, number][][] = [];
  let cur: Ping[] = [];
  const flush = () => {
    if (cur.length >= MIN_SEG_POINTS) {
      let len = 0;
      for (let i = 1; i < cur.length; i++) len += metersBetween(cur[i - 1], cur[i]);
      if (len >= MIN_SEG_METERS) segments.push(cur.map((p) => [p.lng, p.lat]));
    }
    cur = [];
  };
  for (let i = 0; i < pings.length; i++) {
    const p = pings[i];
    if (cur.length === 0) {
      cur = [p];
      continue;
    }
    const prev = cur[cur.length - 1];
    const dt = (new Date(p.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 1000;
    const dist = metersBetween(prev, p);
    const speed = dt > 0 ? dist / dt : Infinity;
    if (dt <= 0 || dt > MAX_GAP_SECONDS || speed > MAX_FOOT_SPEED) {
      // drive/flight/gap → end this walk, maybe start a new one at p
      flush();
      cur = [p];
    } else {
      cur.push(p);
    }
  }
  flush();
  return segments;
}

/** Ordered pings for a place (for passive walk overlays). */
export async function fetchPlacePings(placeId: string): Promise<Ping[]> {
  const { data, error } = await supabase
    .from('location_pings')
    .select('lat, lng, recorded_at')
    .eq('place_id', placeId)
    .order('recorded_at', { ascending: true })
    .limit(6000);
  if (error) throw error;
  return (data ?? []) as Ping[];
}
