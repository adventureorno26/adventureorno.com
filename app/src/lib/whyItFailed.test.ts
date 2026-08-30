import { describe, it, expect } from 'vitest';
import { failureReason, isUnreachable, whyItFailed } from './whyItFailed';

// THE REGRESSION THIS FILE EXISTS FOR (measured live, 2026-08-30):
// pressing "Not the same" in the repair queue with the RPC failing moved nothing,
// said nothing a person could act on, and left `net::ERR_FAILED` in the console.

describe('failureReason', () => {
  it('reads the message off the thing Supabase actually throws', () => {
    // PostgrestError is a PLAIN OBJECT, not an Error — which is exactly why
    // `e instanceof Error ? e.message : 'Could not do that.'` printed the fallback
    // every single time and the real reason never reached the screen.
    const pgError = {
      message: 'that card has already been answered',
      details: '',
      hint: '',
      code: 'P0001',
    };
    expect(pgError instanceof Error).toBe(false);
    expect(failureReason(pgError)).toBe('that card has already been answered');
  });

  it('adds the hint when it says something the message did not', () => {
    expect(
      failureReason({
        message: 'permission denied for function approve_card',
        details: '',
        hint: 'Sign in again.',
        code: '42501',
      }),
    ).toBe('permission denied for function approve_card Sign in again.');
  });

  it('does not repeat details that only echo the message', () => {
    expect(failureReason({ message: 'nope', details: 'nope', hint: 'nope', code: '' })).toBe(
      'nope',
    );
  });

  it('never puts a stack trace on the screen', () => {
    // supabase-js stuffs the whole stack into `details` when the fetch blew up.
    const reason = failureReason({
      message: 'row level security violated',
      details: 'TypeError: x\n    at foo (bar.js:1:1)\n    at baz',
      hint: '',
      code: '42501',
    });
    expect(reason).toBe('row level security violated');
  });

  it('still says something when only a code came back', () => {
    expect(failureReason({ message: '', details: '', hint: '', code: '23503' })).toBe(
      'The database refused it (23503).',
    );
  });

  it('reads a real Error, and a bare string', () => {
    expect(failureReason(new Error('boom'))).toBe('boom');
    expect(failureReason('boom')).toBe('boom');
  });

  it('returns null when there is genuinely nothing to say', () => {
    expect(failureReason(null)).toBeNull();
    expect(failureReason(undefined)).toBeNull();
    expect(failureReason({})).toBeNull();
  });
});

describe('isUnreachable', () => {
  it('recognises the browsers wording it three different ways', () => {
    expect(isUnreachable({ message: 'FetchError: Failed to fetch' })).toBe(true); // Chrome
    expect(isUnreachable(new Error('Load failed'))).toBe(true); // Safari
    expect(isUnreachable(new Error('NetworkError when attempting to fetch resource.'))).toBe(true); // Firefox
    expect(isUnreachable('net::ERR_FAILED')).toBe(true);
  });

  it('does not mistake a refusal for a network failure', () => {
    // The distinction is the whole point: one may have changed something, the
    // other cannot have.
    expect(isUnreachable({ message: 'permission denied', code: '42501' })).toBe(false);
    expect(isUnreachable({})).toBe(false);
  });
});

describe('whyItFailed', () => {
  it('leads with the fact that it did not happen', () => {
    // Confirmation that the press did nothing comes FIRST — a card that has not
    // moved is otherwise indistinguishable from one that is still saving.
    const said = whyItFailed('Couldn’t keep those as two separate outings', {
      message: 'that suggestion was already rejected',
    });
    expect(said.startsWith('Couldn’t keep those as two separate outings')).toBe(true);
    expect(said).toContain('that suggestion was already rejected');
  });

  it('says "nothing was changed" when the server was never reached', () => {
    const said = whyItFailed('Couldn’t save that', { message: 'FetchError: Failed to fetch' });
    expect(said).toContain('couldn’t reach the server');
    expect(said).toContain('nothing was changed');
  });

  it('says offline when the browser knows it is offline', () => {
    const said = whyItFailed('Couldn’t save that', new Error('Load failed'), { online: false });
    expect(said).toContain('offline');
    expect(said).toContain('nothing was changed');
  });

  it('admits it does not know rather than inventing a reason', () => {
    expect(whyItFailed('Couldn’t save that', {})).toBe(
      'Couldn’t save that, and the app was given no reason why. Nothing else was changed.',
    );
  });

  it('never reports a failure as anything a person could read as success', () => {
    for (const e of [{}, new Error('x'), { message: 'FetchError: Failed to fetch' }]) {
      expect(whyItFailed('Couldn’t save that', e)).not.toMatch(/^Saved/);
      expect(whyItFailed('Couldn’t save that', e)).toMatch(/^Couldn’t save that/);
    }
  });
});
