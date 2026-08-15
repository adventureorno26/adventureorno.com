// THE STYLE DOCUMENT — what ties the tiles and the glyphs together into a map.
//
// MapLibre needs one JSON that says where the vector tiles are, where the fonts are,
// and how to paint every layer. Protomaps publish the painting half as
// `protomaps-themes-base`, generated from the same schema their planet build uses, so
// the style and the data cannot drift apart.
//
// TWO DELIBERATE CHANGES to what they publish:
//
//   1. NO ICONS. Erica's rule, and the only exception anywhere in this app is the heart
//      and the flame on a photo. The theme paints POI markers from a sprite sheet, so
//      every layer that sets `icon-image` is dropped — which also removes the need to
//      host a sprite at all. Labels stay: a name is text, not an icon.
//
//   2. IT POINTS AT US. Tiles and glyphs are served from this Worker on Erica's own
//      domain, so there is no third-party host in the critical path of the map — which
//      is the entire point of Phase 4, after MapTiler suspended the account and took
//      every map in the app with it.
import layersFor from 'protomaps-themes-base';

interface StyleLayer {
  id: string;
  layout?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Take the ICONS out, keep the WORDS.
 *
 * My first attempt dropped any layer that set `icon-image`, which is wrong in a way
 * worth writing down: `places_locality` draws the town dot AND the town NAME in one
 * layer, so dropping it took every city and town label off the map to remove one dot.
 *
 * The icon properties are removed and the layer stays. A layer that was ONLY an icon
 * has nothing left to draw and goes.
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

export function buildStyle(origin: string): unknown {
  const raw = (
    layersFor as unknown as (source: string, theme: string, opts: { lang: string }) => StyleLayer[]
  )('basemap', 'dark', { lang: 'en' });

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
    layers: withoutIcons(raw),
  };
}

export function serveStyle(req: Request): Response | null {
  const url = new URL(req.url);
  if (url.pathname !== '/basemap/style.json') return null;
  return new Response(JSON.stringify(buildStyle(url.origin)), {
    headers: {
      'content-type': 'application/json',
      // Short: the style is cheap to rebuild and this is the thing most likely to be
      // adjusted while the look is being settled.
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  });
}
