// MapTiler helpers: basemap style URL + reverse geocoding for "add place".

const KEY = import.meta.env.VITE_MAPTILER_KEY;

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
