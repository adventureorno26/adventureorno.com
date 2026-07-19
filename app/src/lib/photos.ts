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
  blob: Blob;
  name: string;
}

/** Prepare a file for upload by ALWAYS downscaling to ≤2400px on the client.
 *  This is critical: the Worker decodes images in WASM and dies (connection
 *  reset → "Failed to fetch") on full-resolution 12MP iPhone photos. Resizing
 *  here means the Worker only ever sees a small image. Also converts HEIC/PNG to
 *  JPEG. Time-boxed so a slow/failed decode can never block the upload; falls
 *  back to the original bytes only when the browser can't decode the file.
 *  NOTE: this strips EXIF — callers must pass GPS/date separately (see uploadPhoto). */
async function prepareUpload(file: File): Promise<Prepared> {
  try {
    const url = URL.createObjectURL(file);
    const img = await withTimeout(loadImage(url), 12000);
    URL.revokeObjectURL(url);
    const max = 2400;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const blob = await withTimeout(
      new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9)),
      12000,
    );
    if (blob && blob.size > 0) return { blob, name: 'photo.jpg' };
  } catch {
    /* fall back to the original bytes below */
  }
  return { blob: file, name: file.name || 'photo.jpg' };
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

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return token;
}

export interface UploadResult {
  ok: boolean;
  id?: string;
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
  form.set('photo', new File([prep.blob], prep.name, { type: 'image/jpeg' }));
  if (opts.placeId) form.set('place_id', opts.placeId);
  if (lat != null) form.set('lat', String(lat));
  if (lng != null) form.set('lng', String(lng));
  if (override) form.set('override', 'true');
  if (takenAt) form.set('taken_at', takenAt);

  const res = await fetch(`${GATEWAY}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
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

/** Fetch photo bytes as an object URL (caller must revoke on unmount). */
export async function fetchPhotoObjectUrl(
  photoId: string,
  size: 'full' | 'thumb',
): Promise<string> {
  const token = await accessToken();
  const res = await fetch(`${GATEWAY}/photo/${photoId}?size=${size}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Photo fetch failed (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

/** "Last automated upload" timestamp for the /settings health card. */
export async function lastAutomatedUpload(): Promise<string | null> {
  const { data, error } = await supabase.rpc('last_automated_upload');
  if (error) return null;
  return (data as string | null) ?? null;
}
