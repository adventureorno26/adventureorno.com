// Video client: metadata via Supabase/RLS; bytes + upload + delete through the
// photo-gateway Worker (streamed to R2). Videos are private, so playback fetches
// the bytes with the session bearer and hands back an object URL.

import { supabase } from './supabase';
import { GATEWAY, accessToken, photosEnabled, postWithRetry } from './photos';
import type { Video } from './types';

const VIDEO_COLS = 'id, place_id, poster_key, taken_at, duration_s, created_at';

export async function fetchVideosForPlace(placeId: string): Promise<Video[]> {
  const { data, error } = await supabase
    .from('videos')
    .select(VIDEO_COLS)
    .eq('place_id', placeId)
    .order('taken_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Video[];
}

/** Grab a poster frame + duration from a video file, in the browser. */
async function capturePoster(
  file: File,
): Promise<{ poster: Blob | null; duration: number | null }> {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error('decode'));
      setTimeout(() => rej(new Error('timeout')), 12000);
    });
    const duration = Number.isFinite(v.duration) ? v.duration : null;
    await new Promise<void>((res) => {
      v.onseeked = () => res();
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
      setTimeout(res, 3000);
    });
    const max = 1280;
    const scale = Math.min(1, max / Math.max(v.videoWidth || 1, v.videoHeight || 1));
    const w = Math.max(1, Math.round((v.videoWidth || 640) * scale));
    const h = Math.max(1, Math.round((v.videoHeight || 480) * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(v, 0, 0, w, h);
    const poster = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.8));
    return { poster, duration };
  } catch {
    return { poster: null, duration: null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface VideoUploadResult {
  ok: boolean;
  id?: string;
  place_id?: string | null;
}

export async function uploadVideo(
  file: File,
  opts: { placeId?: string; lat?: number; lng?: number; takenAt?: string } = {},
): Promise<VideoUploadResult> {
  if (!photosEnabled()) throw new Error('Uploads are not configured yet.');
  const token = await accessToken();
  const { poster, duration } = await capturePoster(file);

  const p = new URLSearchParams();
  if (opts.placeId) p.set('place_id', opts.placeId);
  if (opts.lat != null) p.set('lat', String(opts.lat));
  if (opts.lng != null) p.set('lng', String(opts.lng));
  p.set('taken_at', opts.takenAt ?? new Date(file.lastModified || Date.now()).toISOString());
  if (duration != null) p.set('duration', String(duration));

  // Body is the raw File — the browser sets Content-Type to the file's MIME,
  // which the Worker reads (avoids a custom header that CORS would block).
  const res = await postWithRetry(`${GATEWAY}/upload-video?${p.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: file,
  });
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Your session expired — please sign in again.');
    }
    throw new Error(`Video upload failed (${res.status})`);
  }
  const out = (await res.json()) as VideoUploadResult;

  // Best-effort poster upload (gallery falls back to a plain tile without it).
  if (poster && out.id) {
    await postWithRetry(`${GATEWAY}/video-poster/${out.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: poster,
    }).catch(() => undefined);
  }
  return out;
}

/** Fetch the video bytes as an object URL for playback (caller revokes). */
export async function fetchVideoObjectUrl(id: string): Promise<string> {
  const token = await accessToken();
  const res = await postWithRetry(`${GATEWAY}/video/${id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Video fetch failed (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

export async function fetchVideoPosterUrl(id: string): Promise<string> {
  const token = await accessToken();
  const res = await postWithRetry(`${GATEWAY}/video-poster/${id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Poster fetch failed (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

export async function deleteVideo(id: string): Promise<void> {
  const token = await accessToken();
  const res = await postWithRetry(`${GATEWAY}/video-delete/${id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
