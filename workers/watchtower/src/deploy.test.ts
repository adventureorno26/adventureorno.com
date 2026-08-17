// The deploy-freeze detector, tested against the day it was written for.
//
// On 2026-08-15 production sat 16 commits behind `main` for a day: GitHub Actions was
// blocked on billing, merging kept working and shipping silently stopped. Erica found it
// by looking at the map. `/version.json` had the answer the whole time.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeDeployedSha, type Env } from './index';

const ENV: Env = {
  SUPABASE_URL: 'https://db.example.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  SITE: 'https://example.invalid',
  GITHUB_TOKEN: 'test-token',
  GITHUB_REPO: 'owner/repo',
};

const DEPLOYED = '546ff114aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HEAD = '920e52f0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** Answer /version.json and the GitHub commits endpoint independently. */
function routeFetch(version: unknown, github: unknown, opts: { githubStatus?: number } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('version.json')) {
        return new Response(JSON.stringify(version), { status: 200 });
      }
      return new Response(JSON.stringify(github), { status: opts.githubStatus ?? 200 });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('the deploy probe', () => {
  it('catches the freeze: merged, not shipped', async () => {
    routeFetch({ sha: DEPLOYED }, { sha: HEAD });

    const r = await probeDeployedSha(ENV);
    expect(r.ok).toBe(false);
    // Both SHAs in the message, because "behind" without saying behind WHAT sends the
    // reader to two dashboards.
    expect(r.detail).toContain('546ff11');
    expect(r.detail).toContain('920e52f');
    expect(r.detail).toContain('merged but not shipped');
  });

  it('is quiet when production is on main', async () => {
    routeFetch({ sha: HEAD }, { sha: HEAD });

    const r = await probeDeployedSha(ENV);
    expect(r.ok).toBe(true);
    expect(r.detail).toBeNull();
    expect(r.content_type).toBe('920e52f');
  });

  it('reports a missing token as a failure, never as a pass', async () => {
    // The whole failure mode being guarded against is a check that cannot see anything
    // and reports green. Not being able to look is a finding.
    const r = await probeDeployedSha({ ...ENV, GITHUB_TOKEN: undefined });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('no GITHUB_TOKEN');
  });

  it('does not call a bad GitHub answer a match', async () => {
    routeFetch({ sha: HEAD }, { message: 'Bad credentials' }, { githubStatus: 401 });

    const r = await probeDeployedSha(ENV);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('401');
  });

  it('fails rather than guessing when a SHA is missing from either answer', async () => {
    routeFetch({ builtAt: '2026-08-16T20:42:37Z' }, { sha: HEAD });

    const r = await probeDeployedSha(ENV);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('could not read a SHA');
  });
});
