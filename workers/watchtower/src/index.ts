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
// AND IT WATCHES THE SCHEDULED JOBS, since 2026-08-16. `dedupe-joint-outings` failed
// every night from 08-09 to 08-16 with `not authorized` and nobody knew, because a failed
// cron row breaks no page, 500s no request and produces no complaint — it looks like
// nothing at all. This file probed five URLs every fifteen minutes throughout and had no
// idea the database was running anything. `cron_health()` (0197) answers for them; the
// results land in the same ledger as everything else, so one screen tells the truth about
// both halves.
//
// Phase 6 adds three always-on servers (Photon, Valhalla, Open Topo Data). They are in
// the list below already, commented, so wiring them up is deleting a comment rather than
// remembering that this file exists.

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SITE: string;
  /** Read-only, `contents:read` on this repo. Without it the deploy probe cannot ask
   *  what `main` is, and says so rather than passing. */
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
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

/** One row per active pg_cron job, shaped like any other probe so it lands in the same
 *  ledger and shows up on the same screen. A job is a service; its last run is what
 *  "came back". */
interface CronRow {
  jobname: string;
  schedule: string;
  last_start: string | null;
  last_status: string | null;
  failures_24h: number;
  ok: boolean | null;
  detail: string | null;
}

export async function probeCronJobs(env: Env): Promise<Result[]> {
  const started = Date.now();
  const url = `${env.SUPABASE_URL}/rest/v1/rpc/cron_health`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      // The ASKING failed, which is not the same as a job failing — and reporting it as
      // one job's outage would blame whichever job happened to be listed first.
      return [
        {
          service: 'cron',
          url,
          ok: false,
          status: res.status,
          content_type: res.headers.get('content-type'),
          bytes: null,
          ms,
          detail: `cron_health() unreachable: HTTP ${res.status}`,
        },
      ];
    }
    const jobs = (await res.json()) as CronRow[];
    if (!Array.isArray(jobs) || jobs.length === 0) {
      // pg_cron with nothing scheduled is itself suspicious: three jobs are expected.
      return [
        {
          service: 'cron',
          url,
          ok: false,
          status: res.status,
          content_type: 'application/json',
          bytes: null,
          ms,
          detail: 'no active cron jobs at all — something unscheduled them',
        },
      ];
    }
    return jobs.map((j) => ({
      service: `cron:${j.jobname}`,
      url,
      ok: j.ok === true,
      status: null,
      content_type: j.last_status,
      bytes: j.failures_24h,
      ms,
      detail: j.detail,
    }));
  } catch (err) {
    return [
      {
        service: 'cron',
        url,
        ok: false,
        status: null,
        content_type: null,
        bytes: null,
        ms: Date.now() - started,
        detail: err instanceof Error ? err.message : 'cron_health() call failed',
      },
    ];
  }
}

/** IS WHAT IS DEPLOYED WHAT WE MERGED?
 *
 *  On 2026-08-15 production sat 16 commits behind `main` for a day. GitHub Actions was
 *  blocked on billing, so every run failed in 5–8 seconds; merging kept working and
 *  shipping silently stopped. Erica found it by looking at the map and saying it had not
 *  changed. Every automated tick read green throughout.
 *
 *  `/version.json` reports the deployed SHA, and comparing it to `main` is one request.
 *  THE COMPARISON HAS TO LIVE HERE rather than in CI, and that is the whole point: CI was
 *  the thing that was down. A freeze detector inside the frozen system detects nothing.
 *  This Worker runs on Cloudflare's cron, which does not care about GitHub's billing. */
export async function probeDeployedSha(env: Env): Promise<Result> {
  const started = Date.now();
  const repo = env.GITHUB_REPO ?? 'adventureorno26/adventureorno.com';
  const url = `${env.SITE}/version.json`;

  const fail = (detail: string, status: number | null = null): Result => ({
    service: 'deploy',
    url,
    ok: false,
    status,
    content_type: null,
    bytes: null,
    ms: Date.now() - started,
    detail,
  });

  if (!env.GITHUB_TOKEN) {
    // NOT a silent skip. Not being able to check is the same blindness that let the
    // freeze last a day, so it is reported as one.
    return fail('no GITHUB_TOKEN — cannot compare the deployed SHA against main');
  }

  try {
    const [depRes, mainRes] = await Promise.all([
      fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; adventureorno-watchtower)' },
        cf: { cacheTtl: 0, cacheEverything: false },
      }),
      fetch(`https://api.github.com/repos/${repo}/commits/main`, {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'adventureorno-watchtower',
        },
      }),
    ]);

    if (!depRes.ok) return fail(`/version.json returned HTTP ${depRes.status}`, depRes.status);
    if (!mainRes.ok) {
      return fail(`GitHub returned HTTP ${mainRes.status} for ${repo} main`, mainRes.status);
    }

    const deployed = ((await depRes.json()) as { sha?: string }).sha ?? '';
    const head = ((await mainRes.json()) as { sha?: string }).sha ?? '';
    const ms = Date.now() - started;

    if (!deployed || !head) return fail('could not read a SHA from one of the two answers');

    if (deployed !== head) {
      return {
        service: 'deploy',
        url,
        ok: false,
        status: 200,
        content_type: deployed.slice(0, 7),
        bytes: null,
        ms,
        detail: `production is on ${deployed.slice(0, 7)}, main is on ${head.slice(0, 7)} — merged but not shipped`,
      };
    }

    return {
      service: 'deploy',
      url,
      ok: true,
      status: 200,
      content_type: deployed.slice(0, 7),
      bytes: null,
      ms,
      detail: null,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'deploy check failed');
  }
}

/** Every probe this Worker runs: the URLs, the scheduled jobs, and what is deployed. */
async function sweep(env: Env): Promise<Result[]> {
  const [urls, jobs, deploy] = await Promise.all([
    Promise.all(PROBES.map((p) => probe(env.SITE, p))),
    probeCronJobs(env),
    probeDeployedSha(env),
  ]);
  return [...urls, ...jobs, deploy];
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
        const results = await sweep(env);
        await record(env, results);
      })(),
    );
  },

  /** The same sweep on demand, so a person can ask rather than wait for the cron. */
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname !== '/watchtower/run') {
      return new Response('not found', { status: 404 });
    }
    const results = await sweep(env);
    await record(env, results);
    return new Response(JSON.stringify({ checked: results.length, results }, null, 2), {
      headers: { 'content-type': 'application/json' },
    });
  },
};
