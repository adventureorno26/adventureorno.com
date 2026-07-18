// MapTiler helpers: basemap style URL + reverse geocoding for "add place".

const KEY = import.meta.env.VITE_MAPTILER_KEY;

export const MAPTILER_STYLE_URL = `https://api.maptiler.com/maps/streets-v2/style.json?key=${KEY}`;

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
