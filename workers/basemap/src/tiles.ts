// SERVING TILES OUT OF THE PLANET FILE.
//
// The copy half of this Worker put a 137.3 GB PMTiles archive into R2. That is the
// expensive part and it is done. This is the part that answers a map request from it.
//
// WHY THIS IS NOT A HAND-ROLLED PARSER. A PMTiles v3 archive is a header, a root
// directory, optional leaf directories and a tile section, with entries varint-encoded,
// run-length compressed, gzip'd, and ordered along a Hilbert curve. Every one of those
// is a place to be subtly wrong in a way that returns the WRONG TILE rather than an
// error — a map that looks fine until you notice Virginia in the sea. `pmtiles` is
// Protomaps' own implementation of the format they publish; using it means the format
// is their problem, and ours is R2 and caching.
//
// WHAT THIS COSTS. R2 charges per class-B operation, not per byte served, and never for
// egress. A tile is one ranged read. The `pmtiles` client caches the header and the
// directories in memory per isolate, so a warm isolate answers most tiles with a single
// range request, and the Cache API in front of it means a tile Erica has already looked
// at costs nothing at all.
import { PMTiles, type Source, type RangeResponse } from 'pmtiles';

/** Reads ranges straight out of the R2 bucket. No network hop: R2 is bound to the
 *  Worker, so this is a local read rather than an HTTP fetch of our own file. */
class R2Source implements Source {
  constructor(
    private bucket: R2Bucket,
    private key: string,
  ) {}

  getKey(): string {
    return this.key;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const obj = await this.bucket.get(this.key, {
      range: { offset, length },
    });
    if (!obj) throw new Error(`basemap object ${this.key} is missing`);
    return { data: await obj.arrayBuffer() };
  }
}

/** One PMTiles reader per isolate. Building it re-reads the header and root directory,
 *  which is exactly the work worth not repeating for every tile. */
let cached: { key: string; archive: PMTiles } | null = null;

function archiveFor(bucket: R2Bucket, key: string): PMTiles {
  if (cached?.key !== key) {
    cached = { key, archive: new PMTiles(new R2Source(bucket, key)) };
  }
  return cached.archive;
}

const TILE_PATH = /^\/basemap\/tiles\/(\d+)\/(\d+)\/(\d+)(?:\.(mvt|pbf))?$/;

/**
 * Serve `/basemap/tiles/{z}/{x}/{y}.mvt`, and the archive's metadata at
 * `/basemap/tiles.json`.
 *
 * Returns null when the path is not a tile request, so the copy endpoints keep working.
 */
export async function serveTile(
  req: Request,
  bucket: R2Bucket,
  key: string,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(req.url);

  if (url.pathname === '/basemap/tiles.json') {
    const archive = archiveFor(bucket, key);
    const [header, metadata] = await Promise.all([archive.getHeader(), archive.getMetadata()]);
    return json({
      tiles: [`${url.origin}/basemap/tiles/{z}/{x}/{y}.mvt`],
      minzoom: header.minZoom,
      maxzoom: header.maxZoom,
      bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
      center: [header.centerLon, header.centerLat, header.centerZoom],
      vector_layers: (metadata as { vector_layers?: unknown }).vector_layers ?? [],
      attribution: '© OpenStreetMap contributors',
    });
  }

  const m = TILE_PATH.exec(url.pathname);
  if (!m) return null;

  const z = Number(m[1]);
  const x = Number(m[2]);
  const y = Number(m[3]);
  if (!Number.isInteger(z) || z < 0 || z > 22) return json({ error: 'bad zoom' }, 400);
  const span = 2 ** z;
  if (x < 0 || y < 0 || x >= span || y >= span) return json({ error: 'tile out of range' }, 400);

  // The Cache API sits in front of R2: a tile already looked at costs no operation.
  const cache = caches.default;
  const hit = await cache.match(req);
  if (hit) return hit;

  const archive = archiveFor(bucket, key);
  const tile = await archive.getZxy(z, x, y);

  // A MISSING TILE IS A 204, NOT A 404. Vector basemaps are sparse — the ocean has no
  // tile — and MapLibre treats 404 as an error worth logging on every pan. 204 says
  // "nothing here", which is the truth and is silent.
  const res =
    tile && tile.data.byteLength > 0
      ? new Response(tile.data, {
          headers: {
            'content-type': 'application/vnd.mapbox-vector-tile',
            // The planet file is replaced wholesale, never edited, so a tile is
            // immutable for as long as this archive is the archive.
            'cache-control': 'public, max-age=604800, immutable',
            'access-control-allow-origin': '*',
          },
        })
      : new Response(null, {
          status: 204,
          headers: { 'cache-control': 'public, max-age=86400' },
        });

  ctx.waitUntil(cache.put(req, res.clone()));
  return res;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}
