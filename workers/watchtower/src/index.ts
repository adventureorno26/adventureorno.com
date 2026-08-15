// THE WATCHTOWER — it asks what came back, not whether something came back.
//
// On 2026-08-15 every `/basemap/*` URL had been answering **200 with the app's HTML** for
// four days: no Worker route was registered, so Pages replied to the path instead. Tiles,
// glyphs and the style were all "up" by any status-code measure and none of them worked.
//
// So a probe here declares success only if the response is the RIGHT KIND of thing: a
// tile must be a vector tile, a style must be JSON, the app must be HTML. A tile that
// arrives as `text/html` is a failure that happens to have a 200 on it.
//
// It also watches for SILENCE. `service_status()` marks a service stale when its newest
// row is older than half an hour, because a probe that has stopped running leaves a green
// row behind that reads exactly like a healthy one.
//
// Phase 6 adds three always-on servers (Photon, Valhalla, Open Topo Data). They are in
// the list below already, commented, so wiring them up is deleting a comment rather than
// remembering that this file exists.

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SITE: string;
}

interface Probe {
  service: string;
  path: string;
  /** A fragment the content-type must contain for this to count as working. */
  expect: string;
  /** Smallest believable body. A 12-byte "tile" is not a tile. */
  minBytes?: number;
}

const PROBES: Probe[] = [
  { service: 'app', path: '/', expect: 'text/html', minBytes: 500 },
  { service: 'basemap-style', path: '/basemap/style.json?theme=dark', expect: 'application/json', minBytes: 1000 },
  { service: 'basemap-tiles', path: '/basemap/tiles.json', expect: 'application/json', minBytes: 500 },
  {
    service: 'basemap-tile',
    path: '/basemap/tiles/6/18/25.mvt',
    expect: 'application/vnd.mapbox-vector-tile',
    minBytes: 1000,
  },
  {
    service: 'basemap-glyphs',
    path: '/basemap/fonts/Noto%20Sans%20Medium/0-255.pbf',
    expect: 'application/x-protobuf',
    minBytes: 10_000,
  },
  // Phase 6, once the boxes exist. Uncomment with the route.
  // { service: 'geocode',   path: '/geocode/health',   expect: 'application/json' },
  // { service: 'route',     path: '/route/health',     expect: 'application/json' },
  // { service: 'elevation', path: '/elevation/health', expect: 'application/json' },
];

interface Result {
  service: string;
  url: string;
  ok: boolean;
  status: number | null;
  content_type: string | null;
  bytes: number | null;
  ms: number;
  detail: string | null;
}

async function probe(base: string, p: Probe): Promise<Result> {
  const url = `${base}${p.path}`;
  const started = Date.now();
  try {
    // A real browser User-Agent: the WAF in front of some of this rejects unrecognised
    // agents with a 1010, which would look like an outage and is not one.
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; adventureorno-watchtower)' },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    const type = res.headers.get('content-type');
    const body = await res.arrayBuffer();
    const bytes = body.byteLength;
    const ms = Date.now() - started;

    if (!res.ok) {
      return { service: p.service, url, ok: false, status: res.status, content_type: type, bytes, ms, detail: `HTTP ${res.status}` };
    }
    if (!type || !type.includes(p.expect)) {
      // THE CASE THIS EXISTS FOR.
      return {
        service: p.service,
        url,
        ok: false,
        status: res.status,
        content_type: type,
        bytes,
        ms,
        detail: `expected ${p.expect}, got ${type ?? 'nothing'} — a 200 from the wrong server looks exactly like success`,
      };
    }
    if (p.minBytes != null && bytes < p.minBytes) {
      return { service: p.service, url, ok: false, status: res.status, content_type: type, bytes, ms, detail: `only ${bytes} bytes, expected at least ${p.minBytes}` };
    }
    return { service: p.service, url, ok: true, status: res.status, content_type: type, bytes, ms, detail: null };
  } catch (err) {
    return {
      service: p.service,
      url,
      ok: false,
      status: null,
      content_type: null,
      bytes: null,
      ms: Date.now() - started,
      detail: err instanceof Error ? err.message : 'fetch failed',
    };
  }
}

async function record(env: Env, rows: Result[]): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/service_health`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    // Nothing to report to but the log: if the ledger is unreachable, the watchtower is
    // the thing that is down, and `stale` in service_status() is what will say so.
    console.error(`[watchtower] could not write results: ${res.status} ${await res.text()}`);
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const results = await Promise.all(PROBES.map((p) => probe(env.SITE, p)));
        await record(env, results);
      })(),
    );
  },

  /** The same sweep on demand, so a person can ask rather than wait for the cron. */
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname !== '/watchtower/run') {
      return new Response('not found', { status: 404 });
    }
    const results = await Promise.all(PROBES.map((p) => probe(env.SITE, p)));
    await record(env, results);
    return new Response(JSON.stringify({ checked: results.length, results }, null, 2), {
      headers: { 'content-type': 'application/json' },
    });
  },
};
