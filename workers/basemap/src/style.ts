// THE STYLE DOCUMENT — what ties the tiles and the glyphs together into a map.
//
// MapLibre needs one JSON that says where the vector tiles are, where the fonts are, and
// how to paint every layer. This file is that JSON, for two themes.
//
// WHY WE PAINT IT OURSELVES rather than using `protomaps-themes-base`.
//
// The theme package is excellent and generated from the same schema the planet build
// uses, so it cannot drift from the data. It was what this Worker served first. But
// Erica chose a look — INK for dark and DAYLIGHT 2 for light — from renders of a
// hand-built layer set, and a style assembled from somebody else's 68 layers with our
// colours poured over the top would not have been the thing she approved. The preview
// and the product have to be the same map. So the layers below ARE the preview's layers,
// and the palettes below are its values, lifted rather than retyped.
//
// TWO RULES THAT DO NOT MOVE:
//
//   1. NO ICONS. Erica's rule; the only exception anywhere in this app is the heart and
//      the flame on a photo. Nothing here paints an icon, and `withoutIcons` still runs
//      over the result so a future edit cannot quietly add one.
//
//   2. IT POINTS AT US. Tiles and glyphs come from this Worker on Erica's own domain, so
//      no third party sits in the critical path of the map — the entire point of Phase 4,
//      after MapTiler suspended the account and took every map in the app with it.

interface StyleLayer {
  id: string;
  layout?: Record<string, unknown>;
  [k: string]: unknown;
}

export type Theme = 'dark' | 'light';

interface Palette {
  earth: string;
  land: string;
  park: string;
  water: string;
  roadMinor: string;
  roadMajor: string;
  roadHigh: string;
  /** Light themes only. A white road on a near-white ground is invisible without one. */
  casingMinor?: string;
  casingMajor?: string;
  casingHigh?: string;
  building: string;
  boundary: string;
  text: string;
  textMuted: string;
  halo: string;
  waterText: string;
  parkAlpha: number;
}

/**
 * INK — the card's own palette, so opening a place card over the map is one surface
 * rather than two. `--panel #0e1728`, `--panel-2 #131f36`, `--text #eaf1ff` (app CSS).
 */
const INK: Palette = {
  earth: '#0e1728',
  land: '#131f36',
  park: '#14293a',
  water: '#16324f',
  roadMinor: '#22314f',
  roadMajor: '#33507f',
  roadHigh: '#3f6fae',
  building: '#182642',
  boundary: '#2a3f66',
  text: '#eaf1ff',
  textMuted: '#93a6cc',
  halo: '#080e1c',
  waterText: '#7fd4e8',
  parkAlpha: 0.55,
};

/**
 * DAYLIGHT 2 — chosen 2026-08-15 from a four-step saturation ladder, one step above
 * Google's own level. The ground, roads and label colour are Google's idiom; the water
 * and parks are one notch richer.
 */
const DAYLIGHT: Palette = {
  earth: '#f8f9fa',
  land: '#eef2f3',
  park: '#b4dfb4',
  water: '#8ccbf9',
  roadMinor: '#ffffff',
  roadMajor: '#ffffff',
  roadHigh: '#ffffff',
  casingMinor: '#dfe4e9',
  casingMajor: '#cbd3db',
  casingHigh: '#a6b3c0',
  building: '#e9edf0',
  boundary: '#bfc7d0',
  text: '#3c4043',
  textMuted: '#6b7178',
  halo: '#ffffff',
  waterText: '#3f82bd',
  parkAlpha: 0.85,
};

const PALETTES: Record<Theme, Palette> = { dark: INK, light: DAYLIGHT };

/**
 * Take the ICONS out, keep the WORDS.
 *
 * Nothing this file writes paints an icon, so today this is a no-op — which is exactly
 * why it stays. My first attempt at it dropped any layer that set `icon-image`, and that
 * is wrong in a way worth keeping written down: `places_locality` drew the town dot AND
 * the town NAME in one layer, so dropping it took every city and town label off the map
 * in order to remove one dot.
 *
 * The icon properties go and the layer stays. A layer that was ONLY an icon has nothing
 * left to draw and goes.
 */
export function withoutIcons(layers: StyleLayer[]): StyleLayer[] {
  const out: StyleLayer[] = [];
  for (const layer of layers) {
    if (!layer.layout || !Object.keys(layer.layout).some((k) => k.startsWith('icon-'))) {
      out.push(layer);
      continue;
    }
    const hadImage = 'icon-image' in layer.layout;
    const layout: Record<string, unknown> = { ...layer.layout };
    for (const k of Object.keys(layout)) {
      if (k.startsWith('icon-')) delete layout[k];
    }
    // Nothing but an icon: there is no word to keep. (A stray icon-padding with no
    // icon-image never drew anything, so its layer is not one of these.)
    if (hadImage && !('text-field' in layout)) continue;
    out.push({ ...layer, layout });
  }
  return out;
}

/** The layers, in draw order. Painted from the palette so both themes stay in step. */
function layersFor(c: Palette): StyleLayer[] {
  const casings: StyleLayer[] = c.casingMinor
    ? [
        // A white road on a near-white ground is invisible; the casing is what makes it
        // read as a road at all. Dark themes need none — the road is already lighter
        // than the ground it sits on.
        {
          id: 'casing-major',
          type: 'line',
          source: 'basemap',
          'source-layer': 'roads',
          filter: ['match', ['get', 'kind'], ['major_road', 'medium_road'], true, false],
          paint: {
            'line-color': c.casingMajor,
            'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 6, 1.4, 12, 3.2, 16, 9],
          },
        },
        {
          id: 'casing-highway',
          type: 'line',
          source: 'basemap',
          'source-layer': 'roads',
          filter: ['==', ['get', 'kind'], 'highway'],
          paint: {
            'line-color': c.casingHigh,
            'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 5, 1.8, 10, 4.2, 16, 12],
          },
        },
        {
          id: 'casing-minor',
          type: 'line',
          source: 'basemap',
          'source-layer': 'roads',
          filter: ['match', ['get', 'kind'], ['minor_road', 'path'], true, false],
          minzoom: 12,
          paint: {
            'line-color': c.casingMinor,
            'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 1.1, 16, 4.6],
          },
        },
      ]
    : [];

  return [
    { id: 'earth', type: 'background', paint: { 'background-color': c.earth } },
    {
      id: 'landcover',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landcover',
      paint: { 'fill-color': c.land },
    },
    {
      // The greens are `landuse`, not `landcover` — worth naming, because two attempts
      // at calming them changed the wrong layer. In Loudoun County `wood` and `park`
      // cover most of the frame, so their opacity is what decides how green the map is.
      id: 'parks',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landuse',
      filter: [
        'match',
        ['get', 'kind'],
        ['park', 'forest', 'nature_reserve', 'wood', 'grass', 'garden', 'recreation_ground'],
        true,
        false,
      ],
      paint: { 'fill-color': c.park, 'fill-opacity': c.parkAlpha },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'water',
      paint: { 'fill-color': c.water },
    },
    {
      id: 'buildings',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'buildings',
      minzoom: 14,
      paint: { 'fill-color': c.building, 'fill-opacity': 0.7 },
    },
    ...casings,
    {
      id: 'roads-minor',
      type: 'line',
      source: 'basemap',
      'source-layer': 'roads',
      filter: ['match', ['get', 'kind'], ['minor_road', 'path'], true, false],
      minzoom: 12,
      paint: {
        'line-color': c.roadMinor,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 0.4, 16, 3],
      },
    },
    {
      id: 'roads-major',
      type: 'line',
      source: 'basemap',
      'source-layer': 'roads',
      filter: ['match', ['get', 'kind'], ['major_road', 'medium_road'], true, false],
      paint: {
        'line-color': c.roadMajor,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 6, 0.5, 12, 1.8, 16, 6],
      },
    },
    {
      id: 'roads-highway',
      type: 'line',
      source: 'basemap',
      'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'highway'],
      paint: {
        'line-color': c.roadHigh,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 5, 0.6, 10, 2.2, 16, 8],
      },
    },
    {
      id: 'boundaries',
      type: 'line',
      source: 'basemap',
      'source-layer': 'boundaries',
      paint: {
        'line-color': c.boundary,
        'line-dasharray': [2, 2],
        'line-width': 0.8,
      },
    },
    // ---- THE WORDS ----------------------------------------------------------------
    // Our glyph server publishes Noto Sans Regular, Medium and Italic. Bold is not
    // published upstream — it answers 502 — so it must not be asked for.
    {
      id: 'water-labels',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'water',
      filter: ['has', 'name'],
      layout: {
        'text-field': ['get', 'name'],
        // Italic for water is the cartographic convention, and it reads as considered
        // rather than default.
        'text-font': ['Noto Sans Italic'],
        'text-size': 11.5,
        'text-letter-spacing': 0.04,
        'text-max-width': 7,
      },
      paint: {
        'text-color': c.waterText,
        'text-halo-color': c.halo,
        'text-halo-width': 1,
      },
    },
    {
      id: 'poi-labels',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'pois',
      minzoom: 14,
      filter: ['has', 'name'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10.5,
        'text-max-width': 8,
        'text-anchor': 'top',
        'text-offset': [0, 0.45],
      },
      paint: {
        'text-color': c.textMuted,
        'text-halo-color': c.halo,
        'text-halo-width': 1,
      },
    },
    {
      id: 'place-labels',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'places',
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Medium'],
        // A wide spread between the smallest and largest name is what makes a map read
        // as designed rather than uniform; tight tracking and a thin halo are what make
        // it read as current. Labels should sit ON the map, not punch a hole in it.
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 15, 14, 19],
        'text-letter-spacing': -0.012,
        'text-max-width': 8,
      },
      paint: {
        'text-color': c.text,
        'text-halo-color': c.halo,
        'text-halo-width': 1.1,
      },
    },
  ];
}

export function buildStyle(origin: string, theme: Theme = 'dark'): unknown {
  return {
    version: 8,
    // Both on our own origin. No CSP entry to forget, and the service worker can cache
    // them like anything else the app serves.
    glyphs: `${origin}/basemap/fonts/{fontstack}/{range}.pbf`,
    sources: {
      basemap: {
        type: 'vector',
        tiles: [`${origin}/basemap/tiles/{z}/{x}/{y}.mvt`],
        minzoom: 0,
        maxzoom: 15,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: withoutIcons(layersFor(PALETTES[theme])),
  };
}

/** Anything that is not exactly `light` is dark — the app's own default, and an
 *  unreadable map is a worse answer to a typo than the one she chose. */
export function themeFrom(param: string | null): Theme {
  return param === 'light' ? 'light' : 'dark';
}

export function serveStyle(req: Request): Response | null {
  const url = new URL(req.url);
  if (url.pathname !== '/basemap/style.json') return null;
  const theme = themeFrom(url.searchParams.get('theme'));
  return new Response(JSON.stringify(buildStyle(url.origin, theme)), {
    headers: {
      'content-type': 'application/json',
      // Short: the style is cheap to rebuild and this is the thing most likely to be
      // adjusted while the look is being settled.
      'cache-control': 'public, max-age=300',
      // The answer differs by query string, and a cache that ignores it would serve the
      // dark map to someone who asked for light.
      vary: 'Accept-Encoding',
      'access-control-allow-origin': '*',
    },
  });
}
