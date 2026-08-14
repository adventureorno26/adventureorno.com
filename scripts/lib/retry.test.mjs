// The retry has to retry the right things. Retrying a 401 wastes a minute and hides
// the real problem; not retrying a 503 fails a build for no reason.
import { describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, withRetry } from './retry.mjs';

const ok = (body = '{}') => new Response(body, { status: 200 });
const status = (code) => new Response('nope', { status: code });

describe('withRetry', () => {
  it('returns the first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('done');
    await expect(withRetry(fn, { attempts: 3, baseMs: 1 })).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and returns the eventual success', async () => {
    const boom = Object.assign(new Error('flaky'), { retryable: true });
    const fn = vi.fn().mockRejectedValueOnce(boom).mockResolvedValue('done');
    await expect(withRetry(fn, { attempts: 3, baseMs: 1 })).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last attempt and rethrows', async () => {
    const boom = Object.assign(new Error('still flaky'), { retryable: true });
    const fn = vi.fn().mockRejectedValue(boom);
    await expect(withRetry(fn, { attempts: 3, baseMs: 1 })).rejects.toThrow('still flaky');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry an error that is an answer', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('unauthorised'), { status: 401 }));
    await expect(withRetry(fn, { attempts: 4, baseMs: 1 })).rejects.toThrow('unauthorised');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('fetchWithRetry', () => {
  it('retries the Management API 555 that broke the build', async () => {
    const f = vi.fn().mockResolvedValueOnce(status(555)).mockResolvedValueOnce(ok('{"types":"x"}'));
    vi.stubGlobal('fetch', f);
    const res = await fetchWithRetry('https://api.supabase.com/x', {}, { attempts: 3, baseMs: 1 });
    await expect(res.json()).resolves.toEqual({ types: 'x' });
    expect(f).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('retries a connection that never answered', async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(ok('{}'));
    vi.stubGlobal('fetch', f);
    await expect(
      fetchWithRetry('https://api.supabase.com/x', {}, { attempts: 3, baseMs: 1 }),
    ).resolves.toBeInstanceOf(Response);
    expect(f).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('fails fast on a bad token instead of trying four times', async () => {
    const f = vi.fn().mockResolvedValue(status(401));
    vi.stubGlobal('fetch', f);
    await expect(
      fetchWithRetry('https://api.supabase.com/x', {}, { attempts: 4, baseMs: 1 }),
    ).rejects.toThrow(/401/);
    expect(f).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('does not leak the response body beyond a short excerpt', async () => {
    const f = vi.fn().mockResolvedValue(new Response('x'.repeat(5000), { status: 400 }));
    vi.stubGlobal('fetch', f);
    await expect(
      fetchWithRetry('https://api.supabase.com/x', {}, { attempts: 1, baseMs: 1 }),
    ).rejects.toThrow(/x{100}/);
    const err = await fetchWithRetry('https://api.supabase.com/x', {}, { attempts: 1, baseMs: 1 })
      .then(() => null)
      .catch((e) => e);
    expect(err.message.length).toBeLessThan(600);
    vi.unstubAllGlobals();
  });
});
