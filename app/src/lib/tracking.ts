// In-app location tracking. While the toggle is on and the app is open, the
// browser's geolocation feeds throttled pings into location_pings (attributed to
// the signed-in person). Powers the map fog/heat and photo-to-place matching.
//
// iPhone note: a web app can only track while it's OPEN — there's no background
// tracking on iOS Safari. This is "track while we're using it", not always-on.

import { supabase } from './supabase';
import { haversineMeters } from './geo';

const PREF_KEY = 'aon_tracking';

export function trackingPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
}
export function setTrackingPref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

export function trackingSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

let watchId: number | null = null;
let last: { t: number; lat: number; lng: number } | null = null;

async function insertPing(profileId: string, lat: number, lng: number): Promise<void> {
  await supabase
    .from('location_pings')
    .insert({
      profile_id: profileId,
      lat,
      lng,
      recorded_at: new Date().toISOString(),
      source: 'app',
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

/** Start watching position for this person. No-op if already running/unsupported.
 *  Throttled: a new ping only when ~90s have passed or you've moved ~150m. */
export function startTracking(profileId: string): void {
  if (watchId != null || !trackingSupported()) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      const now = Date.now();
      if (
        last &&
        now - last.t < 90_000 &&
        haversineMeters({ lat: last.lat, lng: last.lng }, { lat, lng }) < 150
      ) {
        return;
      }
      last = { t: now, lat, lng };
      void insertPing(profileId, lat, lng);
    },
    () => undefined,
    { enableHighAccuracy: false, maximumAge: 60_000, timeout: 30_000 },
  );
}

export function stopTracking(): void {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    last = null;
  }
}

export function isTracking(): boolean {
  return watchId != null;
}
