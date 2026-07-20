// MapTiler helpers: basemap style URL + reverse geocoding for "add place".
// Geocoding search prefers Mapbox (much better business/POI + trailhead coverage)
// when a token is present, falling back to MapTiler.

const KEY = import.meta.env.VITE_MAPTILER_KEY;
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

interface MbFeature {
  id?: string;
  properties?: {
    mapbox_id?: string;
    name?: string;
    full_address?: string;
    place_formatted?: string;
    feature_type?: string;
    coordinates?: { longitude: number; latitude: number };
    context?: {
      region?: { name?: string };
      country?: { name?: string };
    };
  };
  geometry?: { coordinates: [number, number] };
}

const MB_TYPES = 'poi,address,street,place,locality,neighborhood,region,country';

// Mapbox Search Box billing session: suggest calls + the final retrieve share one
// session_token; regenerate after each retrieve.
let mbSession = '';
const mbSessionToken = (): string => {
  if (!mbSession) mbSession = crypto.randomUUID();
  return mbSession;
};

interface MbSuggestion {
  mapbox_id?: string;
  name?: string;
  full_address?: string;
  place_formatted?: string;
  feature_type?: string;
}

/** Mapbox Search Box suggest → autocomplete candidates (businesses, addresses,
 *  places). Coordinates come later via retrieveResult(). */
async function mapboxSuggest(query: string, proximity?: [number, number]): Promise<SearchResult[]> {
  if (!MAPBOX_TOKEN) return [];
  const p = new URLSearchParams({
    q: query,
    access_token: MAPBOX_TOKEN,
    session_token: mbSessionToken(),
    limit: '10',
    types: MB_TYPES,
  });
  if (proximity) p.set('proximity', `${proximity[0]},${proximity[1]}`);
  const res = await fetch(`https://api.mapbox.com/search/searchbox/v1/suggest?${p.toString()}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { suggestions?: MbSuggestion[] };
  return (data.suggestions ?? [])
    .filter((s) => s.mapbox_id && s.name)
    .map((s) => ({
      id: s.mapbox_id!,
      mapbox_id: s.mapbox_id,
      // Lead with the business/place name, then a short locality/address.
      label: [s.name, s.place_formatted ?? s.full_address].filter(Boolean).join(' · '),
      name: s.name!,
      country: null,
      admin1: null,
      address: s.full_address ?? s.place_formatted ?? null,
      lat: 0,
      lng: 0, // filled in by retrieveResult on pick
    }));
}

/** Resolve a picked suggestion to full coordinates + address (Search Box retrieve). */
export async function retrieveResult(r: SearchResult): Promise<SearchResult> {
  if (!MAPBOX_TOKEN || !r.mapbox_id || (r.lat !== 0 && r.lng !== 0)) return r;
  const p = new URLSearchParams({ access_token: MAPBOX_TOKEN, session_token: mbSessionToken() });
  const res = await fetch(
    `https://api.mapbox.com/search/searchbox/v1/retrieve/${r.mapbox_id}?${p.toString()}`,
  );
  mbSession = ''; // end the billing session after retrieve
  if (!res.ok) return r;
  const data = (await res.json()) as { features?: MbFeature[] };
  const f = data.features?.[0];
  const c = f?.geometry?.coordinates;
  if (!f || !c) return r;
  return {
    ...r,
    lat: c[1],
    lng: c[0],
    address: f.properties?.full_address ?? r.address,
    admin1: f.properties?.context?.region?.name ?? r.admin1,
    country: f.properties?.context?.country?.name ?? r.country,
  };
}

/** Single-shot Mapbox forward (Search Box) → best match with coordinates. */
async function mapboxForward(query: string, proximity?: [number, number]): Promise<SearchResult[]> {
  if (!MAPBOX_TOKEN) return [];
  const p = new URLSearchParams({
    q: query,
    access_token: MAPBOX_TOKEN,
    limit: '10',
    types: MB_TYPES,
  });
  if (proximity) p.set('proximity', `${proximity[0]},${proximity[1]}`);
  const res = await fetch(`https://api.mapbox.com/search/searchbox/v1/forward?${p.toString()}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { features?: MbFeature[] };
  return (data.features ?? [])
    .map((f, i): SearchResult | null => {
      const coords = f.geometry?.coordinates;
      if (!coords) return null;
      const pr = f.properties;
      return {
        id: pr?.mapbox_id ?? f.id ?? `mb-${i}`,
        label: pr?.full_address ?? [pr?.name, pr?.place_formatted].filter(Boolean).join(', ') ?? '',
        name: pr?.name ?? query,
        country: pr?.context?.country?.name ?? null,
        admin1: pr?.context?.region?.name ?? null,
        address: pr?.full_address ?? pr?.place_formatted ?? null,
        lat: coords[1],
        lng: coords[0],
      };
    })
    .filter((x): x is SearchResult => x !== null);
}

// Dark style to match the app's blue theme (sleeker than the default light streets).
export const MAPTILER_STYLE_URL = `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${KEY}`;

export interface ReverseGeocodeResult {
  name: string; // best-guess place name
  country: string | null;
  admin1: string | null; // state / region
}

interface MapTilerFeature {
  place_type?: string[];
  text?: string;
  place_name?: string;
  context?: Array<{ id: string; text: string }>;
}

/**
 * Reverse-geocode a coordinate into a suggested place name + country + region.
 * Returns null on any network/parse failure so the caller can fall back to a
 * manual name — never throws into the click handler.
 */
export async function reverseGeocode(
  lng: number,
  lat: number,
): Promise<ReverseGeocodeResult | null> {
  try {
    const url = `https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${KEY}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { features?: MapTilerFeature[] };
    const f = data.features?.[0];
    if (!f) return null;

    const contextText = (prefix: string): string | null =>
      f.context?.find((c) => c.id.startsWith(prefix))?.text ?? null;

    return {
      name: f.text ?? f.place_name ?? 'Untitled place',
      country: contextText('country'),
      admin1: contextText('region') ?? contextText('subregion'),
    };
  } catch {
    return null;
  }
}

export interface ForwardResult extends ReverseGeocodeResult {
  lat: number;
  lng: number;
  address: string | null; // full "place_name" (street address / full label)
}

export interface SearchResult extends ForwardResult {
  id: string;
  label: string; // full "place_name" for the dropdown
  mapbox_id?: string; // Search Box suggestion id → retrieveResult() for coords
}

/** Autocomplete search → location suggestions (map "search to add"). Biases to
 *  the current map view (proximity) for accuracy, allows typos, and returns more
 *  options. */
export async function searchGeocode(
  query: string,
  proximity?: [number, number],
): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // Prefer Mapbox Search Box (best businesses/POIs); fall back to MapTiler.
  if (MAPBOX_TOKEN) {
    const mb = await mapboxSuggest(q, proximity).catch(() => []);
    if (mb.length) return mb;
  }
  try {
    const params = new URLSearchParams({
      key: KEY,
      limit: '10',
      autocomplete: 'true',
      fuzzyMatch: 'true',
    });
    // Rank results near where the user is looking on the map.
    if (proximity) params.set('proximity', `${proximity[0]},${proximity[1]}`);
    const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      features?: Array<
        MapTilerFeature & {
          id?: string;
          center?: [number, number];
          geometry?: { coordinates: [number, number] };
        }
      >;
    };
    return (data.features ?? [])
      .map((f): SearchResult | null => {
        const center = f.center ?? f.geometry?.coordinates;
        if (!center) return null;
        const ctx = (p: string): string | null =>
          f.context?.find((c) => c.id.startsWith(p))?.text ?? null;
        return {
          id: f.id ?? f.place_name ?? `${center[0]},${center[1]}`,
          label: f.place_name ?? f.text ?? q,
          name: f.text ?? f.place_name ?? q,
          country: ctx('country'),
          admin1: ctx('region') ?? ctx('subregion'),
          address: f.place_name ?? null,
          lat: center[1],
          lng: center[0],
        };
      })
      .filter((x): x is SearchResult => x !== null);
  } catch {
    return [];
  }
}

/**
 * Forward-geocode a typed address / place name into coordinates + a name.
 * Powers "add a place manually" (no map click needed). Returns null on failure.
 */
export async function forwardGeocode(
  query: string,
  proximity?: [number, number],
): Promise<ForwardResult | null> {
  const q = query.trim();
  if (!q) return null;
  // Prefer Mapbox for accuracy; fall back to MapTiler.
  if (MAPBOX_TOKEN) {
    const mb = await mapboxForward(q, proximity).catch(() => []);
    if (mb[0]) return mb[0];
  }
  try {
    const params = new URLSearchParams({ key: KEY, limit: '1', fuzzyMatch: 'true' });
    if (proximity) params.set('proximity', `${proximity[0]},${proximity[1]}`);
    const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: Array<
        MapTilerFeature & {
          center?: [number, number];
          geometry?: { coordinates: [number, number] };
        }
      >;
    };
    const f = data.features?.[0];
    const center = f?.center ?? f?.geometry?.coordinates;
    if (!f || !center) return null;
    const contextText = (prefix: string): string | null =>
      f.context?.find((c) => c.id.startsWith(prefix))?.text ?? null;
    return {
      lng: center[0],
      lat: center[1],
      name: f.text ?? f.place_name ?? q,
      country: contextText('country'),
      admin1: contextText('region') ?? contextText('subregion'),
      address: f.place_name ?? null,
    };
  } catch {
    return null;
  }
}
