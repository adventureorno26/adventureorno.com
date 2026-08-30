// Truthful failure messaging — the other half of saveOutcome.ts.
//
// saveOutcome.ts exists because a save in which every photo failed used to look
// identical to a completely successful one. This exists because of the mirror
// image, measured on the live site on 2026-08-30: pressing a button in the repair
// queue when the RPC could not be reached moved nothing, said nothing useful, and
// left `net::ERR_FAILED` in a console no one has open. From the outside that is
// what "it does not function at all" looks like.
//
// Two separate defects, both fixed here:
//
//  1. `e instanceof Error` is FALSE for the thing Supabase actually throws.
//     PostgrestError is a plain object — `{ message, details, hint, code }`, an
//     interface rather than a class — so every `e instanceof Error ? e.message :
//     'Could not do that.'` in the app threw the real reason away and printed the
//     fallback. The app knew why and declined to say.
//  2. Nothing distinguished "the server refused this" from "the server was never
//     reached". They need different words, because they need different actions:
//     one is worth retrying now, the other is worth retrying when the signal is
//     back — and only one of them can possibly have changed something.
//
// Kept as pure functions so the exact wording is unit-testable, same as
// saveOutcome.ts. Nothing here reads `navigator`; the caller passes what it knows.

/** The shape Supabase returns in `{ error }`. Not an Error — that is the point. */
export interface PostgrestLikeError {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

function asRecord(e: unknown): Record<string, unknown> | null {
  return typeof e === 'object' && e !== null ? (e as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * True when the failure is "we never reached the server", not "the server said no".
 *
 * supabase-js turns a rejected fetch into `{ message: 'FetchError: Failed to
 * fetch' }` with an empty `code`, and the browser logs `net::ERR_FAILED`. Chrome,
 * Firefox and Safari each word it differently, hence the list.
 */
export function isUnreachable(error: unknown): boolean {
  const r = asRecord(error);
  const message = (str(r?.message) || (typeof error === 'string' ? error : '')).toLowerCase();
  if (!message) return false;
  return (
    message.includes('fetcherror') ||
    message.includes('failed to fetch') ||
    message.includes('load failed') || // Safari
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('err_failed') ||
    message.includes('err_internet_disconnected')
  );
}

/**
 * The reason, in the app's own voice, or null when the error carries none.
 *
 * Postgres exception messages are written for people in this codebase — "you may
 * not overwrite an approved name", "that card has already been answered" — so they
 * are shown as-is rather than swallowed. `details`/`hint` are appended only when
 * they say something the message did not.
 */
export function failureReason(error: unknown): string | null {
  if (isUnreachable(error)) return null; // the caller has better words for this
  if (error instanceof Error) return str(error.message) || null;
  if (typeof error === 'string') return str(error) || null;

  const r = asRecord(error);
  if (!r) return null;

  const message = str(r.message);
  const details = str(r.details);
  const hint = str(r.hint);
  const code = str(r.code);

  // A stack trace is not a reason. supabase-js puts the whole thing in `details`
  // when the fetch itself blew up, and nobody needs to read that on a card.
  const usableDetails = details && !details.includes('\n') && details !== message ? details : '';
  const usableHint = hint && hint !== message ? hint : '';

  const head = message || usableDetails;
  if (!head) return code ? `The database refused it (${code}).` : null;

  const tail = [head === message ? usableDetails : '', usableHint].filter(Boolean).join(' ');
  return tail ? `${head} ${tail}` : head;
}

/**
 * What to tell the person when an action failed.
 *
 * @param tried  what was being attempted, as a sentence with no full stop —
 *               "Those two are still one card" is wrong; "Couldn't keep those as
 *               two separate outings" is right. It leads, because the FIRST thing
 *               a person needs is confirmation that the thing they pressed did
 *               not happen.
 * @param error  whatever was caught.
 * @param opts.online  the caller's `navigator.onLine`, when it has one.
 */
export function whyItFailed(tried: string, error: unknown, opts?: { online?: boolean }): string {
  const offline = opts?.online === false;
  if (offline) {
    return `${tried} — you’re offline, so nothing was sent and nothing was changed. It will work when you’re back.`;
  }
  if (isUnreachable(error)) {
    return `${tried} — the app couldn’t reach the server, so nothing was changed. Try again in a moment.`;
  }
  const reason = failureReason(error);
  return reason
    ? `${tried} — ${reason}`
    : `${tried}, and the app was given no reason why. Nothing else was changed.`;
}
