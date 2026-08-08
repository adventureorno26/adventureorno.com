// Google Photos import (owner/editor, web) via the Google Photos Picker API. The
// user picks in Google's own hosted picker; we poll the session, then download
// the selected items and hand them back as File[] for the normal upload path.
// Only the public Client ID is used (no secret) — this is a browser token flow.
//
// Robust return flow: opening Google's picker (especially as a full tab on
// mobile) can strand the user on the Google page — win.close()/focus() are
// unreliable there. So we PERSIST the picker session id + where to return
// (localStorage, NOT the access token) before opening. Any tab — even after a
// full reload — can then resume: re-mint a token from the server refresh path,
// read the picked items off the still-live session, and finish the upload. A
// resume banner + the /photos/import/complete route are the safety net.

import { supabase } from './supabase';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export const googlePhotosEnabled = (): boolean => Boolean(CLIENT_ID);

interface GoogleOAuth2 {
  initTokenClient(cfg: {
    client_id: string;
    scope: string;
    prompt?: string;
    callback: (r: { access_token?: string; expires_in?: number }) => void;
    error_callback?: (e: { message?: string }) => void;
  }): { requestAccessToken: (overrides?: { prompt?: string }) => void };
  initCodeClient(cfg: {
    client_id: string;
    scope: string;
    ux_mode?: 'popup' | 'redirect';
    callback: (r: { code?: string; error?: string }) => void;
    error_callback?: (e: { message?: string }) => void;
  }): { requestCode: () => void };
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

// The granted access token is kept in MEMORY ONLY (good ~1h). It is deliberately
// NOT written to localStorage — a Google OAuth token in web storage is an
// unnecessary exposure, and the server refresh-token path (google-photos-token
// edge fn) re-mints one silently after a reload. So persistence across reloads
// comes from the server, not the browser.
interface CachedToken {
  token: string;
  exp: number; // epoch ms this token stops being usable
}
let memToken: CachedToken | null = null;

function validCached(): string | null {
  if (memToken && memToken.exp > Date.now() + 60_000) return memToken.token;
  return null;
}

function storeToken(token: string, expiresInS?: number): void {
  memToken = { token, exp: Date.now() + ((expiresInS ?? 3600) - 120) * 1000 };
}

// Why this reports a REASON instead of just null: every failure here used to be
// swallowed (`if (!res.ok) return null`, `catch { return null }`) and silently fell
// through to the implicit-token path, so a broken connect looked identical to a
// working one and the only thing the user ever saw was "Google Photos import
// failed." google_tokens has never had a row, and no error was ever recorded.
export type TokenReason =
  'ok' | 'needs-consent' | 'not-signed-in' | `http-${number}` | `error-${string}`;

// Persistent path: ask our edge function for an access token minted from a stored
// refresh token.
async function serverToken(code?: string): Promise<{ token?: string; reason: TokenReason }> {
  const r = await serverTokenInner(code);
  warmed = r.reason; // every answer refreshes what the next click already knows
  return r;
}

async function serverTokenInner(code?: string): Promise<{ token?: string; reason: TokenReason }> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt || !SUPABASE_URL) return { reason: 'not-signed-in' };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/google-photos-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        apikey: SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(code ? { code } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      needsConsent?: boolean;
      error?: string;
    };
    if (!res.ok) {
      return { reason: body.error ? `error-${body.error}` : `http-${res.status}` };
    }
    if (body.needsConsent) return { reason: 'needs-consent' };
    if (body.access_token) {
      storeToken(body.access_token, body.expires_in);
      return { token: body.access_token, reason: 'ok' };
    }
    return { reason: 'error-empty-response' };
  } catch (e) {
    return { reason: `error-${e instanceof Error ? e.message : 'network'}` };
  }
}

// What the connect step will need, worked out BEFORE the user clicks. Google's
// consent popup and the picker window both have to be opened from inside the click
// handler to survive a pop-up blocker, so the async question "am I already
// connected?" must already be answered by then.
let warmed: TokenReason | null = null;
export async function prewarmGooglePhotos(): Promise<TokenReason> {
  if (!CLIENT_ID) return 'error-not-configured';
  void loadGis().catch(() => undefined); // fetch Google's SDK now, not on the click
  const s = await serverToken();
  warmed = s.reason;
  return s.reason;
}
/** True when a click can go straight to the picker with no Google sign-in step. */
export function googlePhotosConnected(): boolean {
  return validCached() !== null || warmed === 'ok';
}

// One-time Google consent → an auth CODE, exchanged server-side for a lasting
// refresh token. Popup; only shown the first time (or after a revoke).
async function runConsent(): Promise<string> {
  await loadGis();
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2 || !CLIENT_ID) return reject(new Error('Google Photos not configured'));
    const client = oauth2.initCodeClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      ux_mode: 'popup',
      callback: (r) =>
        r.code ? resolve(r.code) : reject(new Error(r.error ?? 'Google sign-in cancelled')),
      error_callback: (e) => reject(new Error(e?.message ?? 'Google sign-in failed')),
    });
    client.requestCode();
  });
}

async function getAccessToken(): Promise<string> {
  const cached = validCached();
  if (cached) return cached;
  // 1) Persistent server path — no prompt after the first connect.
  const s = await serverToken();
  if (s.token) return s.token;
  if (s.reason === 'needs-consent') {
    const code = await runConsent();
    const c = await serverToken(code);
    if (c.token) return c.token;
    // The consent popup came back with a code but the exchange failed. Say which
    // half broke instead of quietly retrying a different flow.
    throw new Error(`Google accepted the sign-in but the connection failed (${c.reason}).`);
  }
  if (s.reason !== 'ok') {
    throw new Error(`Could not reach the Google Photos connection (${s.reason}).`);
  }
  // 2) Fallback: the in-browser implicit token (short-lived; pre-persistence path).
  return getImplicitToken();
}

async function getImplicitToken(): Promise<string> {
  await loadGis();
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2 || !CLIENT_ID) return reject(new Error('Google Photos not configured'));
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      // Empty prompt = don't force the consent screen again once granted.
      prompt: '',
      callback: (r) => {
        if (r.access_token) {
          storeToken(r.access_token, r.expires_in);
          resolve(r.access_token);
        } else {
          reject(new Error('No token'));
        }
      },
      error_callback: (e) => reject(new Error(e?.message ?? 'Google sign-in failed')),
    });
    client.requestAccessToken();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Lets the UI cancel a long pick/download (the picker polls for up to ~6 min).
let cancelRequested = false;
export function cancelGooglePick(): void {
  cancelRequested = true;
}

// ---------------------------------------------------------------------------
// Persisted import context — the key to a robust return. We store the picker
// session id and where to send the user back, so ANY tab can finish the import
// even if the original one was backgrounded/discarded. We never store the Google
// access token here (re-minted from the server refresh path on resume).
// ---------------------------------------------------------------------------
const PENDING_KEY = 'ao.import.pending';

export interface PendingImport {
  sessionId: string;
  returnTo: string; // route to restore after finishing (e.g. /photos/sort, /place/:id)
  placeId?: string | null; // upload target; null/absent → lands unassigned (inbox)
  label?: string; // friendly name for the "Return to …" button
  startedAt: number; // epoch ms — used to expire stale sessions
}

export function readPendingImport(): PendingImport | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingImport;
    // Picker sessions live ~1 day; drop anything older so a stale banner can't linger.
    if (!p.sessionId || Date.now() - p.startedAt > 24 * 3600 * 1000) {
      clearPendingImport();
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export function savePendingImport(p: PendingImport): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function clearPendingImport(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

async function createSession(): Promise<{ id: string; pickerUri: string }> {
  const startSession = async (): Promise<Response> => {
    const token = await getAccessToken();
    return fetch('https://photospicker.googleapis.com/v1/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
  };
  let sRes = await startSession();
  if (sRes.status === 401) {
    memToken = null; // drop the stale token and retry once
    sRes = await startSession();
  }
  if (!sRes.ok) throw new Error(`Couldn't start Google Photos (${sRes.status})`);
  return (await sRes.json()) as { id: string; pickerUri: string };
}

/** Whether the user has finished picking in this session. */
async function isPicked(sessionId: string): Promise<boolean> {
  const token = await getAccessToken();
  const res = await fetch(`https://photospicker.googleapis.com/v1/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return false;
  const p = (await res.json()) as { mediaItemsSet?: boolean };
  return p.mediaItemsSet === true;
}

/** Download every picked photo in a session → File[]. Reusable by the live flow
 *  AND by the completion route resuming after a reload. */
async function downloadSession(sessionId: string, onStatus?: (s: string) => void): Promise<File[]> {
  const token = await getAccessToken();
  const auth = { Authorization: `Bearer ${token}` };
  const files: File[] = [];
  let pageToken: string | undefined;
  do {
    if (cancelRequested) throw new Error('Cancelled.');
    const url = new URL('https://photospicker.googleapis.com/v1/mediaItems');
    url.searchParams.set('sessionId', sessionId);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const mRes = await fetch(url.toString(), { headers: auth });
    if (!mRes.ok) break;
    const m = (await mRes.json()) as {
      mediaItems?: {
        type?: string;
        mediaFile?: { baseUrl?: string; mimeType?: string; filename?: string };
      }[];
      nextPageToken?: string;
    };
    for (const item of m.mediaItems ?? []) {
      const mf = item.mediaFile;
      if (!mf?.baseUrl) continue;
      if (item.type && item.type !== 'PHOTO') continue; // photos only for now
      const dl = await fetch(`${mf.baseUrl}=d`, { headers: auth });
      if (!dl.ok) continue;
      const blob = await dl.blob();
      files.push(
        new File([blob], mf.filename ?? 'google-photo.jpg', { type: mf.mimeType ?? blob.type }),
      );
      onStatus?.(`Fetching from Google Photos… ${files.length}`);
    }
    pageToken = m.nextPageToken;
  } while (pageToken);
  return files;
}

/** Best-effort cleanup of a picker session (safe to call more than once). */
export function deleteGoogleSession(sessionId: string): void {
  void getAccessToken()
    .then((token) =>
      fetch(`https://photospicker.googleapis.com/v1/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }),
    )
    .catch(() => undefined);
}

/**
 * Live picker flow → returns the chosen photos as File[]. onStatus reports
 * progress. `ctx` (returnTo/placeId/label) is persisted so the import can be
 * resumed from the completion route if this tab is backgrounded or reloaded —
 * on mobile the picker often opens full-tab and the caller never resumes here.
 * The pending context is cleared on success/cancel; if this call is interrupted
 * it stays, and the resume banner offers to finish it.
 */
export async function pickFromGooglePhotos(
  onStatus?: (s: string) => void,
  ctx?: { returnTo?: string; placeId?: string | null; label?: string; win?: Window | null },
): Promise<File[]> {
  if (!CLIENT_ID) throw new Error('Google Photos is not configured.');
  cancelRequested = false;

  // FIRST TIME ONLY: Google's consent window and the picker window are two separate
  // pop-ups, and a browser grants a click ONE. So connecting is its own tap. Doing
  // both on one tap is why nothing ever appeared and why google_tokens has never
  // held a row — the second window was opened long after the click, with no user
  // gesture left to justify it.
  if (!googlePhotosConnected()) {
    onStatus?.('Connecting to Google Photos…');
    const code = await runConsent();
    const c = await serverToken(code);
    if (!c.token) {
      throw new Error(`Google sign-in did not complete (${c.reason}).`);
    }
    throw new Error('Connected to Google Photos — tap Google Photos again to pick your pictures.');
  }

  // Opened SYNCHRONOUSLY, before any await: opening it after a token fetch, an
  // OAuth roundtrip and a session POST is a pop-up a browser is entitled to block,
  // and a blocked window looks exactly like "nothing happened".
  const win = ctx?.win !== undefined ? ctx.win : window.open('', 'ao-gphotos');
  if (!win) {
    throw new Error(
      'Your browser blocked the Google Photos window. Allow pop-ups for adventureorno.com, then try again.',
    );
  }
  try {
    win.document.write(
      '<title>Google Photos</title><body style="background:#0b1220;color:#eaf1ff;font:16px system-ui;padding:40px">Opening Google Photos…</body>',
    );
  } catch {
    /* cross-origin already — harmless */
  }

  onStatus?.('Opening Google Photos…');
  let session: { id: string; pickerUri: string };
  try {
    session = await createSession();
  } catch (e) {
    try {
      win.close();
    } catch {
      /* ignore */
    }
    throw e;
  }

  // Persist BEFORE opening the picker so an interrupted flow is recoverable.
  savePendingImport({
    sessionId: session.id,
    returnTo: ctx?.returnTo ?? window.location.pathname + window.location.search,
    placeId: ctx?.placeId ?? null,
    label: ctx?.label,
    startedAt: Date.now(),
  });

  // Send the window we already hold to Google's picker.
  try {
    win.location.href = session.pickerUri;
  } catch {
    throw new Error('Could not open the Google Photos picker window.');
  }

  onStatus?.('Waiting for you to pick photos…');
  let picked = false;
  try {
    for (let i = 0; i < 180 && !picked; i++) {
      // ~6 min max
      await sleep(2000);
      if (cancelRequested) {
        try {
          win?.close();
        } catch {
          /* ignore */
        }
        clearPendingImport();
        throw new Error('Cancelled.');
      }
      picked = await isPicked(session.id);
    }
  } catch (e) {
    if ((e as Error).message === 'Cancelled.') throw e;
    // A transient poll error shouldn't nuke a recoverable import.
    throw e;
  }
  // Close the Google tab and pull focus back (best-effort — unreliable on mobile,
  // which is exactly why the resume path exists).
  try {
    win?.close();
    window.focus();
  } catch {
    /* ignore */
  }
  if (!picked) throw new Error('No photos were picked (timed out).');

  onStatus?.('Downloading your photos…');
  const files = await downloadSession(session.id, onStatus);

  deleteGoogleSession(session.id);
  clearPendingImport();

  if (files.length === 0) throw new Error('Nothing came back from Google Photos.');
  return files;
}

/**
 * Resume a persisted import from the completion route. Verifies the session was
 * picked, downloads the items, and returns them (the caller enqueues uploads).
 * Returns null if the session isn't ready yet (still on the Google page).
 */
export async function resumePendingImport(
  pending: PendingImport,
  onStatus?: (s: string) => void,
): Promise<File[] | null> {
  cancelRequested = false;
  onStatus?.('Checking your selection…');
  if (!(await isPicked(pending.sessionId))) return null;
  onStatus?.('Downloading your photos…');
  const files = await downloadSession(pending.sessionId, onStatus);
  deleteGoogleSession(pending.sessionId);
  return files;
}
