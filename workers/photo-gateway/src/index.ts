// photo-gateway — the ONLY path to photo bytes in R2.
//
//   POST /ingest       Erica's daily Shortcut. Bearer = device ingest token.
//   POST /upload       Manual drag-and-drop. Bearer = user session JWT.
//   GET  /photo/:id    Authenticated read (?size=full|thumb). Streams from R2.
//   POST /delete/:id   Permanent, sticky deletion (rule #6).
//
// Pipeline (rules #4, #5, #6): hash → deleted? → duplicate? → EXIF gate →
// home-zone → resize 2400/400 (strips EXIF) → R2 write → photos row.

import {
  assignPlace,
  deletePhotoRow,
  deleteVideoRow,
  findPhotoByHash,
  recomputePlace,
  getHomeZone,
  getPhoto,
  getVideo,
  hashIsDeleted,
  insertPhoto,
  insertVideo,
  removeDeletedHash,
  resolveDeviceToken,
  resolveSession,
  setVideoPoster,
  sha256Hex,
  type Caller,
  type Env,
} from './supa';
import { readExif, screenshotGate } from './exif';
import { ingestDecision } from './decide';
import { renderVariants } from './images';
import { photoCacheKey, purgePhotoCache } from './cache';

const EARTH_RADIUS_M = 6371008.8;
const toRad = (d: number): number => (d * Math.PI) / 180;
function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  // Echo the caller's origin if it's an allowed domain OR any adventureorno
  // Cloudflare Pages URL (the prod alias + preview deploys), so uploads work
  // whether the app is opened from adventureorno.com or *.pages.dev.
  const okPages = !!origin && /^https:\/\/([a-z0-9-]+\.)?adventureorno\.pages\.dev$/.test(origin);
  const allow = origin && (allowed.includes(origin) || okPages) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function bearer(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

async function readImageBytes(req: Request): Promise<{
  bytes: Uint8Array;
  thumbBytes: Uint8Array | null; // client-rendered thumbnail (manual UI path)
  w: number | null;
  h: number | null;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
  override: boolean;
  takenAt: string | null;
}> {
  const ct = req.headers.get('Content-Type') ?? '';
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = (form.get('photo') ?? form.get('file')) as File | null;
    if (!file) throw new Error('no photo field');
    const thumb = form.get('thumb') as File | null;
    const num = (k: string): number | null => {
      const v = form.get(k);
      return v != null && v !== '' ? Number(v) : null;
    };
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      thumbBytes: thumb ? new Uint8Array(await thumb.arrayBuffer()) : null,
      w: num('w'),
      h: num('h'),
      lat: num('lat'),
      lng: num('lng'),
      placeId: (form.get('place_id') as string | null) || null,
      override: form.get('override') === 'true',
      takenAt: (form.get('taken_at') as string | null) || null,
    };
  }
  // Raw body (the iOS Shortcut posts the JPEG as the request body).
  const buf = new Uint8Array(await req.arrayBuffer());
  const url = new URL(req.url);
  const qnum = (k: string): number | null => {
    const v = url.searchParams.get(k);
    return v != null && v !== '' ? Number(v) : null;
  };
  return {
    bytes: buf,
    thumbBytes: null,
    w: null,
    h: null,
    lat: qnum('lat'),
    lng: qnum('lng'),
    placeId: url.searchParams.get('place_id'),
    override: url.searchParams.get('override') === 'true',
    takenAt: url.searchParams.get('taken_at'),
  };
}

interface IngestOutcome {
  status: number;
  body: Record<string, unknown>;
}

async function runPipeline(
  env: Env,
  req: Request,
  source: 'shortcut' | 'manual',
  uploadedBy: string | null,
  allowOverride: boolean,
): Promise<IngestOutcome> {
  const { bytes, thumbBytes, w: formW, h: formH, lat: formLat, lng: formLng, placeId, override, takenAt } =
    await readImageBytes(req);
  if (bytes.byteLength === 0) return { status: 400, body: { error: 'empty body' } };

  const sha = await sha256Hex(bytes);
  const isDeleted = await hashIsDeleted(env, sha);
  const isDuplicate = isDeleted ? false : await findPhotoByHash(env, sha);

  const exif = await readExif(bytes);
  const lat = exif.lat ?? formLat;
  const lng = exif.lng ?? formLng;
  const hasCoords = lat != null && lng != null;

  // Home-exclusion zone (rule #1) — only meaningful once we have coordinates.
  const zone = await getHomeZone(env);
  const inZone = hasCoords ? haversineM(lat!, lng!, zone.lat, zone.lng) <= zone.radius_m : false;

  // Single ordered decision (rules #1, #5, #6). On /upload a deliberate override
  // clears screenshot/home-zone warnings; deletion is never overridable.
  // Manual uploads are deliberate — only require coordinates (a converted iPhone
  // photo has no camera EXIF, so we don't apply the screenshot/make-model gate).
  // The automated Shortcut path keeps the full gate.
  const skip = ingestDecision({
    isDeleted,
    isDuplicate,
    gate: allowOverride ? (hasCoords ? null : 'no_gps') : screenshotGate(exif, hasCoords),
    hasCoords,
    inZone,
    manual: allowOverride,
    override,
  });
  if (skip) return { status: 200, body: { skipped: skip } };
  // Past the gate: coordinates are guaranteed present. A manual re-upload of a
  // previously-deleted photo fully un-deletes it (clear the sticky hash).
  if (isDeleted && allowOverride) await removeDeletedHash(env, sha).catch(() => undefined);

  // Manual UI uploads arrive pre-rendered (web + thumb) from the browser, so we
  // store them directly and NEVER run the WASM decoder (which crashed on
  // full-res photos). Only the raw-body Shortcut path decodes server-side.
  let variants: { web: { bytes: Uint8Array; width: number; height: number }; thumb: { bytes: Uint8Array } };
  if (thumbBytes) {
    variants = { web: { bytes, width: formW ?? 0, height: formH ?? 0 }, thumb: { bytes: thumbBytes } };
  } else {
    try {
      variants = renderVariants(bytes, Number(env.MAX_EDGE), Number(env.THUMB_EDGE));
    } catch {
      return { status: 200, body: { skipped: 'undecodable' } };
    }
  }

  // Auto-place the photo by its GPS when the caller didn't pick a place.
  let finalPlaceId = placeId;
  if (!finalPlaceId) finalPlaceId = await assignPlace(env, lat!, lng!);

  const uuid = crypto.randomUUID();
  const r2Key = `photos/${uuid}.jpg`;
  const thumbKey = `thumbs/${uuid}.jpg`;
  await env.PHOTOS.put(r2Key, variants.web.bytes, {
    httpMetadata: { contentType: 'image/jpeg' },
  });
  await env.PHOTOS.put(thumbKey, variants.thumb.bytes, {
    httpMetadata: { contentType: 'image/jpeg' },
  });

  const id = await insertPhoto(env, {
    place_id: finalPlaceId,
    lat: lat!,
    lng: lng!,
    // Day-view uploads pin the photo to a chosen date; otherwise use EXIF.
    taken_at: takenAt ?? exif.takenAt,
    r2_key: r2Key,
    thumb_key: thumbKey,
    width: variants.web.width,
    height: variants.web.height,
    sha256: sha,
    uploaded_by: uploadedBy,
    source,
  });

  // Keep the place's visit dates + cover fresh (photos over several days extend
  // the trip length).
  if (finalPlaceId) await recomputePlace(env, finalPlaceId);

  return { status: 200, body: { ok: true, id, place_id: finalPlaceId ?? null } };
}

async function handlePhoto(
  env: Env,
  req: Request,
  id: string,
  caller: Caller | null,
  cors: Record<string, string>,
  ctx: ExecutionContext,
): Promise<Response> {
  // Auth runs on EVERY request — the cache only ever spares the R2 read.
  if (!caller) return json({ error: 'unauthenticated' }, 401, cors);
  const photo = await getPhoto(env, id);
  if (!photo) return json({ error: 'not found' }, 404, cors);
  const size = new URL(req.url).searchParams.get('size') === 'thumb' ? 'thumb' : 'full';

  const cache = caches.default;
  const cacheKey = photoCacheKey(id, size);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const h = new Headers(cached.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    h.set('Cache-Control', 'private, max-age=86400');
    h.set('X-Cache', 'HIT');
    return new Response(cached.body, { status: 200, headers: h });
  }

  const key = size === 'thumb' ? photo.thumb_key : photo.r2_key;
  // Older/restored photos may have no separate thumbnail stored (thumb_key null
  // or its object missing). Fall back to the full-size image instead of 404ing.
  let obj = key ? await env.PHOTOS.get(key) : null;
  if (!obj && size === 'thumb') obj = await env.PHOTOS.get(photo.r2_key);
  if (!obj) return json({ error: 'object missing' }, 404, cors);

  // Stored under the synthetic key WITHOUT `private` (cache.put rejects private);
  // the client copy gets `private` so browsers don't share it.
  const cacheable = new Response(obj.body, {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400', ETag: photo.sha256 },
  });
  ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));
  return new Response(cacheable.body, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
      ETag: photo.sha256,
      'X-Cache': 'MISS',
    },
  });
}

async function handleDelete(
  env: Env,
  id: string,
  caller: Caller | null,
  cors: Record<string, string>,
): Promise<Response> {
  if (!caller) return json({ error: 'unauthenticated' }, 401, cors);
  const photo = await getPhoto(env, id);
  if (!photo) return json({ error: 'not found' }, 404, cors);
  // Owner may delete any photo; an editor only their own uploads (rule #6).
  if (caller.role !== 'owner' && photo.uploaded_by !== caller.userId) {
    return json({ error: 'forbidden' }, 403, cors);
  }
  // Purge BOTH edge-cache variants BEFORE returning — a deleted photo must never
  // survive at the edge (rule #6).
  await purgePhotoCache(caches.default, id);
  await env.PHOTOS.delete([photo.r2_key, photo.thumb_key]);
  await deletePhotoRow(env, photo, caller.userId);
  return json({ ok: true }, 200, cors);
}

// --- Video handlers (bytes stream straight to R2; no server processing) ------
async function handleUploadVideo(
  env: Env,
  req: Request,
  caller: Caller | null,
  cors: Record<string, string>,
): Promise<Response> {
  if (!caller) return json({ error: 'unauthenticated' }, 401, cors);
  if (!req.body) return json({ error: 'empty body' }, 400, cors);
  const url = new URL(req.url);
  const qnum = (k: string): number | null => {
    const v = url.searchParams.get(k);
    return v != null && v !== '' ? Number(v) : null;
  };
  // The browser sets Content-Type from the File (video/mp4, video/quicktime, …).
  const ct = req.headers.get('Content-Type') || '';
  const contentType = ct.startsWith('video/') ? ct : 'video/mp4';
  const uuid = crypto.randomUUID();
  const r2Key = `videos/${uuid}`;
  await env.PHOTOS.put(r2Key, req.body, { httpMetadata: { contentType } });
  const lat = qnum('lat');
  const lng = qnum('lng');
  let placeId = url.searchParams.get('place_id') || null;
  if (!placeId && lat != null && lng != null) placeId = await assignPlace(env, lat, lng);
  const id = await insertVideo(env, {
    place_id: placeId,
    r2_key: r2Key,
    poster_key: null,
    content_type: contentType,
    taken_at: url.searchParams.get('taken_at'),
    lat,
    lng,
    duration_s: qnum('duration'),
    uploaded_by: caller.userId,
    source: 'manual',
  });
  if (placeId) await recomputePlace(env, placeId).catch(() => undefined);
  return json({ ok: true, id, place_id: placeId ?? null }, 200, cors);
}

async function handleVideoPosterPut(
  env: Env,
  req: Request,
  id: string,
  caller: Caller | null,
  cors: Record<string, string>,
): Promise<Response> {
  if (!caller) return json({ error: 'unauthenticated' }, 401, cors);
  if (!req.body) return json({ error: 'empty body' }, 400, cors);
  const video = await getVideo(env, id);
  if (!video) return json({ error: 'not found' }, 404, cors);
  const posterKey = `posters/${id}.jpg`;
  await env.PHOTOS.put(posterKey, req.body, { httpMetadata: { contentType: 'image/jpeg' } });
  await setVideoPoster(env, id, posterKey);
  return json({ ok: true }, 200, cors);
}

async function handleVideoGet(
  env: Env,
  req: Request,
  id: string,
  caller: Caller | null,
  cors: Record<string, string>,
): Promise<Response> {
  if (!caller) return json({ error: 'unauthenticated' }, 401, cors);
  const video = await getVideo(env, id);
  if (!video) return json({ error: 'not found' }, 404, cors);
  const range = req.headers.get('Range');
  const rm = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
  if (rm) {
    const offset = Number(rm[1]);
    const end = rm[2] ? Number(rm[2]) : undefined;
    const length = end != null ? end - offset + 1 : undefined;
    const obj = await env.PHOTOS.get(video.r2_key, { range: { offset, length } });
    if (!obj) return json({ error: 'not found' }, 404, cors);
    const total = obj.size;
    return new Response(obj.body, {
      status: 206,
      headers: {
        ...cors,
        'Content-Type': video.content_type,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${offset}-${end ?? total - 1}/${total}`,
      },
    });
  }
  const obj = await env.PHOTOS.get(video.r2_key);
  if (!obj) return json({ error: 'not found' }, 404, cors);
  return new Response(obj.body, {
    status: 200,
    headers: { ...cors, 'Content-Type': video.content_type, 'Accept-Ranges': 'bytes' },
  });
}

async function handleVideoPosterGet(
  env: Env,
  id: string,
  caller: Caller | null,
  cors: Record<string, string>,
): Promise<Response> {
  if (!caller) return json({ error: 'unauthenticated' }, 401, cors);
  const video = await getVideo(env, id);
  if (!video?.poster_key) return json({ error: 'not found' }, 404, cors);
  const obj = await env.PHOTOS.get(video.poster_key);
  if (!obj) return json({ error: 'not found' }, 404, cors);
  return new Response(obj.body, { status: 200, headers: { ...cors, 'Content-Type': 'image/jpeg' } });
}

async function handleVideoDelete(
  env: Env,
  id: string,
  caller: Caller | null,
  cors: Record<string, string>,
): Promise<Response> {
  if (!caller) return json({ error: 'unauthenticated' }, 401, cors);
  const video = await getVideo(env, id);
  if (!video) return json({ error: 'not found' }, 404, cors);
  if (caller.role !== 'owner' && video.uploaded_by !== caller.userId) {
    return json({ error: 'forbidden' }, 403, cors);
  }
  const keys = video.poster_key ? [video.r2_key, video.poster_key] : [video.r2_key];
  await env.PHOTOS.delete(keys);
  await deleteVideoRow(env, id);
  return json({ ok: true }, 200, cors);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = req.headers.get('Origin');
    const cors = corsHeaders(env, origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');

    try {
      // --- Device ingest (Erica's Shortcut) ---------------------------------
      if (path === '/ingest' && req.method === 'POST') {
        const tok = bearer(req);
        const profileId = tok ? await resolveDeviceToken(env, tok) : null;
        if (!profileId) return json({ error: 'invalid device token' }, 401, cors);
        const out = await runPipeline(env, req, 'shortcut', profileId, false);
        return json(out.body, out.status, cors);
      }

      // --- Manual upload (owner or editor session) --------------------------
      if (path === '/upload' && req.method === 'POST') {
        const jwt = bearer(req);
        const caller = jwt ? await resolveSession(env, jwt) : null;
        if (!caller) return json({ error: 'unauthenticated' }, 401, cors);
        const out = await runPipeline(env, req, 'manual', caller.userId, true);
        return json(out.body, out.status, cors);
      }

      // --- Authenticated read -----------------------------------------------
      const photoMatch = path.match(/^\/photo\/([0-9a-f-]{36})$/i);
      if (photoMatch && req.method === 'GET') {
        const jwt = bearer(req);
        const caller = jwt ? await resolveSession(env, jwt) : null;
        return handlePhoto(env, req, photoMatch[1], caller, cors, ctx);
      }

      // --- Deletion ---------------------------------------------------------
      const delMatch = path.match(/^\/delete\/([0-9a-f-]{36})$/i);
      if (delMatch && req.method === 'POST') {
        const jwt = bearer(req);
        const caller = jwt ? await resolveSession(env, jwt) : null;
        return handleDelete(env, delMatch[1], caller, cors);
      }

      // --- Video: upload (raw stream), poster, playback, delete -------------
      const session = async () => {
        const jwt = bearer(req);
        return jwt ? resolveSession(env, jwt) : null;
      };
      if (path === '/upload-video' && req.method === 'POST') {
        return handleUploadVideo(env, req, await session(), cors);
      }
      const vposter = path.match(/^\/video-poster\/([0-9a-f-]{36})$/i);
      if (vposter && req.method === 'POST') {
        return handleVideoPosterPut(env, req, vposter[1], await session(), cors);
      }
      if (vposter && req.method === 'GET') {
        return handleVideoPosterGet(env, vposter[1], await session(), cors);
      }
      const vget = path.match(/^\/video\/([0-9a-f-]{36})$/i);
      if (vget && req.method === 'GET') {
        return handleVideoGet(env, req, vget[1], await session(), cors);
      }
      const vdel = path.match(/^\/video-delete\/([0-9a-f-]{36})$/i);
      if (vdel && req.method === 'POST') {
        return handleVideoDelete(env, vdel[1], await session(), cors);
      }

      if (path === '/health') return json({ ok: true }, 200, cors);
      return json({ error: 'not found' }, 404, cors);
    } catch (err) {
      // Never leak coordinates/tokens in error text.
      return json({ error: 'internal error', detail: String(err).slice(0, 200) }, 500, cors);
    }
  },
};
