// SERVER-SIDE REVERSE GEOCODING — Mapbox first, MapTiler as the fallback.
//
// MapTiler suspended the account on 2026-08-10, and its GEOCODING endpoint
// returns 403 exactly like its tiles do. That was verified, not assumed. Four
// server paths still called it — geocode-new-places, suggest, detect-trips and
// _shared/strava.ts — so since the suspension every one of them has silently
// got nothing back, and new places have gone unnamed and unplaced.
//
// Two of those declared the key non-optionally (`Deno.env.get('MAPTILER_KEY')!`),
// which means they did not even fail loudly; they just produced no result.
//
// Mapbox's Geocoding v6 answers the same question and its token is already set
// on this project (MAPBOX_TOKEN, added 2026-08-11). MapTiler is kept underneath
// for the day the account comes back, but it is never tried first.

const MAPBOX_TOKEN = Deno.env.get('MAPBOX_TOKEN') ?? '';
const MAPTILER_KEY = Deno.env.get('MAPTILER_KEY') ?? '';

export interface PlaceName {
  /** Best human name for the point — a POI or address if there is one. */
  name: string;
  /** State / region. */
  admin1: string | null;
  country: string | null;
  /** Which provider answered, so a caller can log or test it. */
  source: 'mapbox' | 'maptiler' | 'none';
}

interface MapboxProps {
  name?: string;
  name_preferred?: string;
  place_formatted?: string;
  context?: {
    region?: { name?: string };
    country?: { name?: string };
    place?: { name?: string };
  };
}

/** Mapbox Geocoding v6 reverse. Returns null on any failure, never throws. */
async function viaMapbox(lng: number, lat: number): Promise<PlaceName | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    const p = new URLSearchParams({
      longitude: String(lng),
      latitude: String(lat),
      access_token: MAPBOX_TOKEN,
      limit: '1',
    });
    const r = await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?${p}`);
    if (!r.ok) return null;
    const d = (await r.json()) as { features?: Array<{ properties?: MapboxProps }> };
    const f = d.features?.[0]?.properties;
    if (!f) return null;
    const name = f.name_preferred || f.name || f.context?.place?.name || '';
    if (!name) return null;
    return {
      name,
      admin1: f.context?.region?.name ?? null,
      country: f.context?.country?.name ?? null,
      source: 'mapbox',
    };
  } catch {
    return null;
  }
}

interface MapTilerFeat {
  text?: string;
  place_name?: string;
  context?: Array<{ id?: string; text?: string }>;
}

/** The old path. Kept only as a fallback; currently 403 for this account. */
async function viaMapTiler(lng: number, lat: number): Promise<PlaceName | null> {
  if (!MAPTILER_KEY) return null;
  try {
    const r = await fetch(
      `https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${MAPTILER_KEY}&limit=1`,
    );
    if (!r.ok) return null;
    const d = (await r.json()) as { features?: MapTilerFeat[] };
    const f = d.features?.[0];
    if (!f?.text) return null;
    const ctx = f.context ?? [];
    const pick = (prefix: string) =>
      ctx.find((c) => (c.id ?? '').startsWith(prefix))?.text ?? null;
    return {
      name: f.text,
      admin1: pick('region'),
      country: pick('country'),
      source: 'maptiler',
    };
  } catch {
    return null;
  }
}

/**
 * Name a coordinate. Mapbox, then MapTiler, then nothing.
 *
 * "Nothing" is a real answer and callers must respect it: STATE.md §2 —
 * *"No suggestion" means leave it alone.* Never write a placeholder name
 * because the geocoder was quiet.
 */
export async function reverseGeocode(lng: number, lat: number): Promise<PlaceName> {
  return (
    (await viaMapbox(lng, lat)) ??
    (await viaMapTiler(lng, lat)) ?? { name: '', admin1: null, country: null, source: 'none' }
  );
}

/** Whether any geocoder is configured at all — for health checks. */
export function geocoderConfigured(): { mapbox: boolean; maptiler: boolean } {
  return { mapbox: Boolean(MAPBOX_TOKEN), maptiler: Boolean(MAPTILER_KEY) };
}
