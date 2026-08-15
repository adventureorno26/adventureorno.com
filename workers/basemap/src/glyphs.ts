// GLYPHS — the fonts MapLibre needs before it can draw a single label.
//
// A vector basemap ships geometry and names, not pictures of names. The renderer turns
// a name into pixels using signed-distance-field glyphs, fetched as protobufs in
// 256-character ranges: `{fontstack}/{start}-{end}.pbf`. Without them the map draws
// roads and coastlines and NOTHING is labelled, which looks like a bug rather than a
// missing asset.
//
// SO THIS IS PART OF OWNING THE MAP, not a detail. Pointing the style at somebody
// else's font server would reintroduce exactly what §Phase 4 is escaping: a third-party
// host that can rate-limit us, disappear, or be blocked by a CSP entry nobody notices —
// which is how the Mapbox search died unnoticed.
//
// LAZY FILL, rather than a bulk copy. Protomaps publishes 256 ranges per stack across
// four stacks; almost all of them are scripts this app will never render. The first
// request for a range fetches it once from upstream, writes it to R2, and serves it;
// every request after that is ours. Latin labels use a handful of ranges, so the bucket
// fills with what is actually looked at and nothing else.
//
// It is safe to do this on demand because a glyph range is immutable: it is a rendering
// of a specific font at a specific version, and Protomaps publishes new fonts under new
// names rather than editing these.

const UPSTREAM = 'https://protomaps.github.io/basemaps-assets/fonts';

/** The theme asks for several Noto Sans faces, and which ones depend on the script a
 *  label happens to be in — Devanagari shows up for names in India. Rather than pin a
 *  list that goes stale the first time someone visits Delhi, anything under the Noto
 *  Sans family is allowed through and anything else is refused: this is our font
 *  server, not an open relay to somebody else's. */
const isAllowedStack = (stack: string) =>
  /^Noto Sans[ A-Za-z0-9]*$/.test(stack) && stack.length <= 64;

const GLYPH_PATH = /^\/basemap\/fonts\/([^/]+)\/(\d+)-(\d+)\.pbf$/;

export interface GlyphRequest {
  stack: string;
  range: string;
}

/** Parse and BOUND a glyph path. Exported to be tested without a bucket. */
export function parseGlyphPath(pathname: string): GlyphRequest | 'not-a-glyph' | 'refused' {
  const m = GLYPH_PATH.exec(decodeURIComponent(pathname));
  if (!m) return 'not-a-glyph';
  const stack = m[1];
  const start = Number(m[2]);
  const end = Number(m[3]);
  if (!isAllowedStack(stack)) return 'refused';
  // Ranges are exactly the 256-character windows the format defines. Anything else is
  // someone probing, not MapLibre.
  if (end - start !== 255 || start % 256 !== 0 || start < 0 || end > 65535) return 'refused';
  return { stack, range: `${start}-${end}` };
}

export async function serveGlyphs(
  req: Request,
  bucket: R2Bucket,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(req.url);
  const parsed = parseGlyphPath(url.pathname);
  if (parsed === 'not-a-glyph') return null;
  if (parsed === 'refused') {
    return new Response(JSON.stringify({ error: 'unknown font' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const key = `fonts/${parsed.stack}/${parsed.range}.pbf`;
  const headers = {
    'content-type': 'application/x-protobuf',
    // Immutable: a glyph range is one font at one version, and new fonts get new names.
    'cache-control': 'public, max-age=31536000, immutable',
    'access-control-allow-origin': '*',
  };

  const have = await bucket.get(key);
  if (have) return new Response(have.body, { headers });

  // First time anyone has asked for this range: fetch it once, keep it, serve it.
  const upstream = await fetch(
    `${UPSTREAM}/${encodeURIComponent(parsed.stack)}/${parsed.range}.pbf`,
  );
  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: `upstream ${upstream.status}` }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bytes = await upstream.arrayBuffer();
  // Written in the background so the person waiting on a label does not wait on a PUT.
  ctx.waitUntil(
    bucket.put(key, bytes, {
      httpMetadata: { contentType: 'application/x-protobuf' },
    }),
  );
  return new Response(bytes, { headers });
}
