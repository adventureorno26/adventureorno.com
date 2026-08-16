// The cron probe, tested against the shape that actually went wrong.
//
// `dedupe-joint-outings` failed every night from 2026-08-09 to 08-16 with `not
// authorized`, and nothing noticed, because a failed cron row breaks no page and produces
// no complaint. The first case below is that exact night, replayed: a failing job among
// healthy ones must come back `ok: false` with the reason attached, or this probe is
// another green light over a broken thing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeCronJobs, type Env } from './index';

const ENV: Env = {
  SUPABASE_URL: 'https://db.example.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  SITE: 'https://example.invalid',
};

/** Stand in for PostgREST answering `rpc/cron_health`. */
function respondWith(body: unknown, init: ResponseInit = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
      }),
    ),
  );
}

const HEALTHY = {
  jobname: 'purge-trash',
  schedule: '30 4 * * *',
  last_start: '2026-08-16T04:30:00Z',
  last_status: 'succeeded',
  failures_24h: 0,
  ok: true,
  detail: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('the cron probe', () => {
  it('reports the failing job and does not let the healthy ones cover for it', async () => {
    respondWith([
      HEALTHY,
      {
        jobname: 'dedupe-joint-outings',
        schedule: '20 4 * * *',
        last_start: '2026-08-16T04:20:00Z',
        last_status: 'failed',
        failures_24h: 1,
        ok: false,
        detail: 'failed: ERROR:  not authorized',
      },
    ]);

    const rows = await probeCronJobs(ENV);
    expect(rows).toHaveLength(2);

    const bad = rows.find((r) => r.service === 'cron:dedupe-joint-outings');
    expect(bad?.ok).toBe(false);
    expect(bad?.detail).toContain('not authorized');
    // The failure count rides along, so one bad night reads differently from eight.
    expect(bad?.bytes).toBe(1);

    expect(rows.find((r) => r.service === 'cron:purge-trash')?.ok).toBe(true);
  });

  it('treats a job that has stopped running as broken, not as quiet', async () => {
    respondWith([
      {
        ...HEALTHY,
        jobname: 'rebuild-revealed-area',
        ok: false,
        last_status: 'succeeded',
        detail: 'no run since 2026-08-10 07:10 — overdue for a job that normally runs every 24h',
      },
    ]);

    const [row] = await probeCronJobs(ENV);
    // Its last run SUCCEEDED. Judging on status alone would call this healthy, which is
    // the whole reason `ok` is computed in SQL and trusted here.
    expect(row.content_type).toBe('succeeded');
    expect(row.ok).toBe(false);
    expect(row.detail).toContain('overdue');
  });

  it('blames the asking, not a job, when cron_health() cannot be reached', async () => {
    respondWith('{"message":"permission denied"}', { status: 403 });

    const rows = await probeCronJobs(ENV);
    expect(rows).toHaveLength(1);
    // One row named plain `cron` — attaching this to whichever job sorted first would
    // accuse something that may be perfectly fine.
    expect(rows[0].service).toBe('cron');
    expect(rows[0].ok).toBe(false);
    expect(rows[0].detail).toContain('403');
  });

  it('calls an empty schedule a failure, because three jobs are expected', async () => {
    respondWith([]);

    const [row] = await probeCronJobs(ENV);
    expect(row.ok).toBe(false);
    expect(row.detail).toContain('no active cron jobs');
  });

  it('survives the network failing entirely', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection reset');
      }),
    );

    const [row] = await probeCronJobs(ENV);
    expect(row.ok).toBe(false);
    expect(row.detail).toBe('connection reset');
  });
});
