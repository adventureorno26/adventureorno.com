// Retry a network call that failed for a reason that is nobody's fault.
//
// WHY THIS EXISTS. Three separate CI steps have failed this month on a single
// unretried request, none of them because anything was wrong with the code:
//
//   * gitleaks download   — curl (22) 503, four times
//   * osv-scanner download — curl (56) connection reset
//   * gen-types           — Supabase Management API 555 "Internal server error"
//
// Every one went green on a re-run. A red check that means nothing teaches you to
// re-run without reading, which is exactly how a real failure gets waved through.
//
// ONLY RETRIES WHAT IS WORTH RETRYING. A 401 or a 404 is an answer, not a hiccup —
// retrying it wastes time and hides the real problem. 5xx, 408, 429 and outright
// connection failures are retried; everything else is raised immediately.

/** HTTP statuses worth trying again. 555 is the Management API's own flavour of 500. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524, 555]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call `fn` until it succeeds or the attempts run out.
 *
 * `fn` receives the attempt number (1-based). Throw a `RetryableError`, or an error
 * carrying a retryable `.status`, to ask for another attempt.
 */
export async function withRetry(fn, opts = {}) {
  const { attempts = 4, baseMs = 500, label = 'request', onRetry } = opts;
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const retryable = err?.retryable === true || RETRYABLE_STATUS.has(err?.status);
      if (!retryable || attempt === attempts) throw err;
      // Exponential, with a little jitter so parallel jobs do not all return together.
      const waitMs = Math.round(baseMs * 2 ** (attempt - 1) * (1 + Math.random() * 0.25));
      const why = err?.status ? `HTTP ${err.status}` : (err?.code ?? err?.message ?? 'error');
      console.warn(
        `${label}: ${why} on attempt ${attempt}/${attempts}; retrying in ${waitMs}ms…`,
      );
      if (onRetry) onRetry(attempt, err);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

/**
 * `fetch`, but a transient failure is retried instead of failing the build.
 *
 * Returns the Response only for 2xx. A retryable status is thrown with `.status` set so
 * `withRetry` picks it up; anything else throws immediately with the body attached, so
 * a genuine 401 still fails fast and says why.
 */
export async function fetchWithRetry(url, init = {}, opts = {}) {
  const label = opts.label ?? new URL(url).host;
  return withRetry(
    async () => {
      let res;
      try {
        res = await fetch(url, init);
      } catch (cause) {
        // DNS failure, reset connection, TLS handshake — no response at all.
        // The label is added by withRetry's log line; repeating it here read as
        // "api.supabase.com: api.supabase.com: ECONNRESET".
        const err = new Error(cause.message);
        err.retryable = true;
        err.cause = cause;
        throw err;
      }
      if (res.ok) return res;
      const body = (await res.text().catch(() => '')).slice(0, 400);
      const err = new Error(`${label}: HTTP ${res.status} ${body}`);
      err.status = res.status;
      throw err;
    },
    { ...opts, label },
  );
}
