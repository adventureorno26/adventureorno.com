// Photo client: metadata reads go through Supabase/RLS; bytes + upload + delete
// go through the photo-gateway Worker (the only path to R2). Photos are private,
// so <img src> can't carry the session bearer — we fetch bytes with an
// Authorization header and hand back an object URL.

import exifr from 'exifr';
import { supabase } from './supabase';
import type { Photo } from './types';

/** Read a photo's GPS coordinates (or null) — used to decide auto-place vs. a
 *  "set a location" card. */
export async function readGps(file: File): Promise<{ lat: number; lng: number } | null> {
  try {
    const g = (await exifr.gps(file)) as { latitude?: number; longitude?: number } | undefined;
    if (g && typeof g.latitude === 'number' && typeof g.longitude === 'number') {
      return { lat: g.latitude, lng: g.longitude };
    }
  } catch {
    /* no gps */
  }
  return null;
}

/** Read the photo's capture time from EXIF (before any resize strips it). */
export async function readTakenAt(file: File): Promise<string | undefined> {
  try {
    const d = (await exifr.parse(file, ['DateTimeOriginal', 'CreateDate'])) as
      | { DateTimeOriginal?: Date; CreateDate?: Date }
      | undefined;
    const dt = d?.DateTimeOriginal ?? d?.CreateDate;
    if (dt instanceof Date && !Number.isNaN(dt.getTime())) return dt.toISOString();
  } catch {
    /* no date */
  }
  return undefined;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Never let EXIF/conversion hang the upload — bail after `ms` and move on. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

interface Prepared {
  web: Blob; // ≤2400px JPEG (the stored image)
  thumb: Blob | null; // ≤400px JPEG; null only if the browser couldn't decode
  width: number;
  height: number;
  name: string;
}

/** Draw an image scaled so its longest edge ≤ maxEdge, return the canvas + dims. */
function drawScaled(img: HTMLImageElement, maxEdge: number): { canvas: HTMLCanvasElement; w: number; h: number } {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return { canvas, w, h };
}

const toBlob = (c: HTMLCanvasElement, q: number): Promise<Blob | null> =>
  new Promise((r) => c.toBlob(r, 'image/jpeg', q));

/** Prepare a file for upload entirely on the client: produce BOTH the web-size
 *  (≤2400px) and thumbnail (≤400px) JPEGs here, so the Worker never decodes an
 *  image (server-side WASM decode was crashing on full-res iPhone photos →
 *  "Load failed"). Also converts HEIC/PNG → JPEG and strips EXIF (callers pass
 *  GPS/date separately). Time-boxed; falls back to sending the original only if
 *  the browser genuinely can't decode the file. */
async function prepareUpload(file: File): Promise<Prepared> {
  try {
    const url = URL.createObjectURL(file);
    const img = await withTimeout(loadImage(url), 15000);
    URL.revokeObjectURL(url);
    const web = drawScaled(img, 2400);
    const thumb = drawScaled(img, 400);
    const [webBlob, thumbBlob] = await Promise.all([
      withTimeout(toBlob(web.canvas, 0.85), 15000),
      withTimeout(toBlob(thumb.canvas, 0.8), 15000),
    ]);
    if (webBlob && webBlob.size > 0) {
      return { web: webBlob, thumb: thumbBlob, width: web.w, height: web.h, name: 'photo.jpg' };
    }
  } catch {
    /* fall back to the original bytes below (Worker will decode) */
  }
  return { web: file, thumb: null, width: 0, height: 0, name: file.name || 'photo.jpg' };
}

/** POST with an abort timeout + retries — mobile networks drop requests, which
 *  surface as "Load failed"/"Failed to fetch". Retrying makes uploads reliable. */
export async function postWithRetry(url: string, init: RequestInit, tries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  console.warn('upload retries exhausted', lastErr);
  throw new Error('Upload failed — network error. Check your connection and try again.');
}

const PHOTO_COLS =
  'id, place_id, lat, lng, taken_at, width, height, is_landscape, source, uploaded_by, entry_id, created_at';

export async function fetchPhotosForEntry(entryId: string): Promise<Photo[]> {
  const { data, error } = await supabase
    .from('photos')
    .select(PHOTO_COLS)
    .eq('entry_id', entryId)
    .order('taken_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Photo[];
}

/** Attach/detach a photo to an entry (entry_id = null detaches). */
export async function linkPhotoToEntry(photoId: string, entryId: string | null): Promise<void> {
  const { error } = await supabase.from('photos').update({ entry_id: entryId }).eq('id', photoId);
  if (error) throw error;
}

export const GATEWAY = (import.meta.env.VITE_PHOTO_GATEWAY_URL ?? '').replace(/\/+$/, '');

/** Whether photo features are wired up (Worker deployed + configured). */
export const photosEnabled = (): boolean => GATEWAY.length > 0;

export async function fetchPhotosForPlace(placeId: string): Promise<Photo[]> {
  const { data, error } = await supabase
    .from('photos')
    .select(PHOTO_COLS)
    .eq('place_id', placeId)
    .order('taken_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Photo[];
}

/** Photos taken at a place on a specific day (day view). */
export async function fetchPhotosForPlaceOnDay(placeId: string, day: string): Promise<Photo[]> {
  const next = new Date(day + 'T00:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  const { data, error } = await supabase
    .from('photos')
    .select(PHOTO_COLS)
    .eq('place_id', placeId)
    .gte('taken_at', day)
    .lt('taken_at', next.toISOString().slice(0, 10))
    .order('taken_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Photo[];
}

export async function fetchUnassignedPhotos(): Promise<Photo[]> {
  const { data, error } = await supabase
    .from('photos')
    .select(PHOTO_COLS)
    .is('place_id', null)
    .order('taken_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Photo[];
}

export async function assignPhotoToPlace(photoId: string, placeId: string | null): Promise<void> {
  const { error } = await supabase.from('photos').update({ place_id: placeId }).eq('id', photoId);
  if (error) throw error;
}

// Dedupe concurrent refreshes: when a gallery mounts many <img>s at once they
// all call accessToken() together. Without this, each fires its own
// refreshSession(); the first rotates the refresh token and the rest error,
// which previously nuked the whole session (every photo → 401 / caution sign).
// One shared in-flight refresh fixes that.
let refreshInFlight: Promise<string | null> | null = null;

/** Run an async worker over items with limited concurrency (parallel uploads).
 *  Returns results in the original order; a worker that throws yields undefined. */
export async function mapPool<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = 4,
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await worker(items[i], i);
      } catch {
        results[i] = undefined;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

export async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  const expMs = session?.expires_at ? session.expires_at * 1000 : 0;
  const fresh = session && expMs - Date.now() > 60_000;
  if (fresh) return session!.access_token;

  // Missing or near-expiry — refresh once, shared across concurrent callers.
  if (!refreshInFlight) {
    refreshInFlight = supabase.auth
      .refreshSession()
      .then(({ data: r }) => r.session?.access_token ?? null)
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  const refreshed = await refreshInFlight;
  // Prefer the refreshed token; otherwise fall back to any still-usable current
  // token (a transient refresh failure shouldn't break an otherwise-valid session).
  const token = refreshed ?? session?.access_token ?? null;
  if (!token) throw new Error('Your session expired — please sign out and sign in again.');
  return token;
}

export interface UploadResult {
  ok: boolean;
  id?: string;
  place_id?: string | null; // the place the photo was auto-assigned to (by GPS)
  skipped?: string;
}

/** Manual upload through the Worker. `override` re-tries a home-zone/screenshot
 *  warning as a deliberate upload. Optionally supply lat/lng for photos whose
 *  EXIF lacks GPS, and/or a place to attach to immediately. */
export async function uploadPhoto(
  file: File,
  opts: {
    placeId?: string;
    lat?: number;
    lng?: number;
    override?: boolean;
    takenAt?: string; // force the photo onto a specific date (day view uploads)
  } = {},
): Promise<UploadResult> {
  if (!photosEnabled()) throw new Error('Photo uploads are not configured yet.');
  const token = await accessToken();

  // Read GPS + capture date from the ORIGINAL bytes first — prepareUpload resizes
  // via canvas, which strips EXIF, so we must carry these through ourselves.
  let lat = opts.lat;
  let lng = opts.lng;
  if (lat == null || lng == null) {
    const g = await readGps(file).catch(() => null);
    if (g) {
      lat = lat ?? g.lat;
      lng = lng ?? g.lng;
    }
  }
  const takenAt = opts.takenAt ?? (await readTakenAt(file).catch(() => undefined));

  const prep = await prepareUpload(file);

  // Every call here is a DELIBERATE manual pick in the UI — so by default we
  // override the screenshot/make-model and home-zone backstops (those exist to
  // filter the *automated* nightly Shortcut, not photos the user hand-picked).
  // Duplicate/deleted are still enforced server-side and can't be overridden.
  const override = opts.override ?? true;

  const form = new FormData();
  form.set('photo', new File([prep.web], prep.name, { type: 'image/jpeg' }));
  // Client-rendered thumbnail → the Worker stores it directly and skips its own
  // (crash-prone) image decode entirely.
  if (prep.thumb) {
    form.set('thumb', new File([prep.thumb], 'thumb.jpg', { type: 'image/jpeg' }));
    form.set('w', String(prep.width));
    form.set('h', String(prep.height));
  }
  if (opts.placeId) form.set('place_id', opts.placeId);
  if (lat != null) form.set('lat', String(lat));
  if (lng != null) form.set('lng', String(lng));
  if (override) form.set('override', 'true');
  if (takenAt) form.set('taken_at', takenAt);

  const res = await postWithRetry(`${GATEWAY}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Your session expired — please sign out and sign in again.');
    }
    const detail = await res.text().catch(() => '');
    throw new Error(`Upload failed (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`);
  }
  return (await res.json()) as UploadResult;
}

export async function deletePhoto(photoId: string): Promise<void> {
  if (!photosEnabled()) throw new Error('Photo deletion is not configured yet.');
  const token = await accessToken();
  const res = await fetch(`${GATEWAY}/delete/${photoId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

/** Fetch photo bytes as an object URL (caller must revoke on unmount). Retries,
 *  since a dropped fetch on mobile leaves a cover-photo marker blank. */
export async function fetchPhotoObjectUrl(
  photoId: string,
  size: 'full' | 'thumb',
): Promise<string> {
  const token = await accessToken();
  const res = await postWithRetry(`${GATEWAY}/photo/${photoId}?size=${size}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Photo fetch failed (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

/** Set (or fix) a photo's date. Stored at midday UTC so it lands on the chosen
 *  calendar day regardless of timezone. */
export async function setPhotoDate(photoId: string, isoDate: string): Promise<void> {
  const { error } = await supabase
    .from('photos')
    .update({ taken_at: `${isoDate}T12:00:00Z` })
    .eq('id', photoId);
  if (error) throw error;
}

export interface OnThisDayItem {
  photo_id: string;
  place_id: string;
  place_name: string;
  taken_at: string;
}

/** Photos taken on today's month/day in a prior year — the "On this day" card. */
export async function fetchOnThisDay(): Promise<OnThisDayItem[]> {
  const { data, error } = await supabase.rpc('on_this_day');
  if (error) return [];
  return (data ?? []) as OnThisDayItem[];
}

/** "Last automated upload" timestamp for the /settings health card. */
export async function lastAutomatedUpload(): Promise<string | null> {
  const { data, error } = await supabase.rpc('last_automated_upload');
  if (error) return null;
  return (data as string | null) ?? null;
}
