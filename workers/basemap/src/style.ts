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

/** Layers that draw a picture rather than a word. */
export function withoutIcons(layers: StyleLayer[]): StyleLayer[] {
  return layers.filter((l) => !(l.layout && 'icon-image' in l.layout));
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
