// Google Photos import (owner-only, web) via the Google Photos Picker API. The
// user picks in Google's own hosted picker; we poll the session, then download
// the selected items and hand them back as File[] for the normal upload path.
// Only the public Client ID is used (no secret) — this is a browser token flow.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';

export const googlePhotosEnabled = (): boolean => Boolean(CLIENT_ID);

interface GoogleOAuth2 {
  initTokenClient(cfg: {
    client_id: string;
    scope: string;
    prompt?: string;
    callback: (r: { access_token?: string; expires_in?: number }) => void;
    error_callback?: (e: { message?: string }) => void;
  }): { requestAccessToken: (overrides?: { prompt?: string }) => void };
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

// Keep the granted access token around (it's good for ~1h) so repeated imports —
// picking photos for one place after another on the map or in the table — don't
// pop the Google sign-in every time. Cached in memory + localStorage; a valid
// one is reused, otherwise we request silently (no consent screen after the
// first grant). The full never-sign-in-again flow needs a server-side refresh
// token — that's the next step; this already removes the per-import prompt.
const TOKEN_KEY = 'aon_gphotos_token';
interface CachedToken {
  token: string;
  exp: number; // epoch ms this token stops being usable
}
let memToken: CachedToken | null = null;

function validCached(): string | null {
  const fresh = (c: CachedToken | null): c is CachedToken => !!c && c.exp > Date.now() + 60_000;
  if (fresh(memToken)) return memToken.token;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (raw) {
      const c = JSON.parse(raw) as CachedToken;
      if (fresh(c)) {
        memToken = c;
        return c.token;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function storeToken(token: string, expiresInS?: number): void {
  const exp = Date.now() + ((expiresInS ?? 3600) - 120) * 1000;
  memToken = { token, exp };
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(memToken));
  } catch {
    /* ignore */
  }
}

async function getAccessToken(): Promise<string> {
  const cached = validCached();
  if (cached) return cached;
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

/** Full picker flow → returns the chosen photos as File[]. onStatus reports progress. */
export async function pickFromGooglePhotos(onStatus?: (s: string) => void): Promise<File[]> {
  if (!CLIENT_ID) throw new Error('Google Photos is not configured.');

  onStatus?.('Opening Google Photos…');
  // Try with the cached token; if it was revoked/expired early (401), drop it and
  // request a fresh one once before giving up.
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
    memToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    sRes = await startSession();
  }
  if (!sRes.ok) throw new Error(`Couldn't start Google Photos (${sRes.status})`);
  const token = await getAccessToken();
  const auth = { Authorization: `Bearer ${token}` };
  const session = (await sRes.json()) as { id: string; pickerUri: string };
  const win = window.open(session.pickerUri, '_blank');

  onStatus?.('Waiting for you to pick photos…');
  let picked = false;
  for (let i = 0; i < 180 && !picked; i++) {
    // ~6 min max
    await sleep(2000);
    const pRes = await fetch(`https://photospicker.googleapis.com/v1/sessions/${session.id}`, {
      headers: auth,
    });
    if (!pRes.ok) continue;
    const p = (await pRes.json()) as { mediaItemsSet?: boolean };
    picked = p.mediaItemsSet === true;
  }
  try {
    win?.close();
  } catch {
    /* ignore */
  }
  if (!picked) throw new Error('No photos were picked (timed out).');

  onStatus?.('Downloading your photos…');
  const files: File[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://photospicker.googleapis.com/v1/mediaItems');
    url.searchParams.set('sessionId', session.id);
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

  // Best-effort cleanup of the picker session.
  void fetch(`https://photospicker.googleapis.com/v1/sessions/${session.id}`, {
    method: 'DELETE',
    headers: auth,
  }).catch(() => undefined);

  if (files.length === 0) throw new Error('Nothing came back from Google Photos.');
  return files;
}
