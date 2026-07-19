// Thin Supabase helpers for the Worker. All DB writes use the service_role key
// (bypasses RLS) via PostgREST; session identification uses the anon key + the
// caller's JWT. The service_role key is a Worker secret — never logged.

export interface Env {
  PHOTOS: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  ALLOWED_ORIGINS: string;
  MAX_EDGE: string;
  THUMB_EDGE: string;
}

export interface Caller {
  userId: string;
  role: 'owner' | 'editor';
}

function restHeaders(env: Env): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

/** SHA-256 hex of a byte buffer (content hash used for dedupe + deletion). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Identify the device (ingest token) behind a bearer token, or null. Stamps
 *  last_used_at so /settings can surface a stale-Shortcut warning. */
export async function resolveDeviceToken(env: Env, bearer: string): Promise<string | null> {
  const tokenHash = await sha256Hex(new TextEncoder().encode(bearer));
  const url =
    `${env.SUPABASE_URL}/rest/v1/ingest_tokens` +
    `?select=id,profile_id&token_hash=eq.${tokenHash}&revoked_at=is.null&limit=1`;
  const res = await fetch(url, { headers: restHeaders(env) });
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ id: string; profile_id: string }>;
  const row = rows[0];
  if (!row) return null;
  // Heartbeat — best-effort, don't block ingest on it.
  await fetch(`${env.SUPABASE_URL}/rest/v1/ingest_tokens?id=eq.${row.id}`, {
    method: 'PATCH',
    headers: restHeaders(env),
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch(() => undefined);
  return row.profile_id;
}

/** Identify a logged-in user + role from their JWT, or null. */
export async function resolveSession(env: Env, jwt: string): Promise<Caller | null> {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  if (!user.id) return null;
  const pr = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles?select=role&id=eq.${user.id}&limit=1`,
    { headers: restHeaders(env) },
  );
  if (!pr.ok) return null;
  const rows = (await pr.json()) as Array<{ role: 'owner' | 'editor' }>;
  const role = rows[0]?.role;
  if (!role) return null;
  return { userId: user.id, role };
}

export interface HomeZone {
  lat: number;
  lng: number;
  radius_m: number;
}

export async function getHomeZone(env: Env): Promise<HomeZone> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/settings?select=value&key=eq.home_zone&limit=1`,
    { headers: restHeaders(env) },
  );
  if (res.ok) {
    const rows = (await res.json()) as Array<{ value: HomeZone }>;
    if (rows[0]?.value) return rows[0].value;
  }
  // Fallback matches the seeded value; never leaves the zone unenforced.
  return { lat: 39.1157, lng: -77.5636, radius_m: 24140 };
}

export async function hashIsDeleted(env: Env, sha256: string): Promise<boolean> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/deleted_hashes?select=sha256&sha256=eq.${sha256}&limit=1`,
    { headers: restHeaders(env) },
  );
  if (!res.ok) return false;
  return ((await res.json()) as unknown[]).length > 0;
}

/** Nearest place within 30 km, else a new auto place at the point (RPC from
 *  0004/0007). Used to auto-place a photo by its GPS when no place was given. */
export async function assignPlace(env: Env, lat: number, lng: number): Promise<string | null> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/assign_activity_place`, {
    method: 'POST',
    headers: restHeaders(env),
    body: JSON.stringify({ p_lat: lat, p_lng: lng }),
  });
  if (!res.ok) return null;
  const id = (await res.json()) as string | null;
  return id;
}

/** Recompute a place's visit dates / cover after adding a photo (RPC). */
export async function recomputePlace(env: Env, placeId: string): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/recompute_place_stats`, {
    method: 'POST',
    headers: restHeaders(env),
    body: JSON.stringify({ p_place: placeId }),
  }).catch(() => undefined);
}

export async function findPhotoByHash(env: Env, sha256: string): Promise<boolean> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/photos?select=id&sha256=eq.${sha256}&limit=1`,
    { headers: restHeaders(env) },
  );
  if (!res.ok) return false;
  return ((await res.json()) as unknown[]).length > 0;
}

/** Remove a hash from deleted_hashes (a manual re-upload fully un-deletes it). */
export async function removeDeletedHash(env: Env, sha256: string): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/deleted_hashes?sha256=eq.${sha256}`, {
    method: 'DELETE',
    headers: restHeaders(env),
  });
}

export interface PhotoRow {
  place_id: string | null;
  lat: number;
  lng: number;
  taken_at: string | null;
  r2_key: string;
  thumb_key: string;
  width: number;
  height: number;
  sha256: string;
  uploaded_by: string | null;
  source: 'shortcut' | 'manual';
}

export async function insertPhoto(env: Env, row: PhotoRow): Promise<string> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/photos`, {
    method: 'POST',
    headers: { ...restHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`insert photo failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{ id: string }>;
  return rows[0].id;
}

export interface FullPhotoRow {
  id: string;
  r2_key: string;
  thumb_key: string;
  sha256: string;
  uploaded_by: string | null;
}

export async function getPhoto(env: Env, id: string): Promise<FullPhotoRow | null> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/photos?select=id,r2_key,thumb_key,sha256,uploaded_by&id=eq.${id}&limit=1`,
    { headers: restHeaders(env) },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as FullPhotoRow[];
  return rows[0] ?? null;
}

export interface VideoRow {
  place_id: string | null;
  r2_key: string;
  poster_key: string | null;
  content_type: string;
  taken_at: string | null;
  lat: number | null;
  lng: number | null;
  duration_s: number | null;
  uploaded_by: string | null;
  source: 'manual';
}

export async function insertVideo(env: Env, row: VideoRow): Promise<string> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/videos`, {
    method: 'POST',
    headers: { ...restHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`insert video failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as Array<{ id: string }>)[0].id;
}

export async function setVideoPoster(env: Env, id: string, posterKey: string): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/videos?id=eq.${id}`, {
    method: 'PATCH',
    headers: restHeaders(env),
    body: JSON.stringify({ poster_key: posterKey }),
  });
}

export interface FullVideoRow {
  id: string;
  r2_key: string;
  poster_key: string | null;
  content_type: string;
  uploaded_by: string | null;
}

export async function getVideo(env: Env, id: string): Promise<FullVideoRow | null> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/videos?select=id,r2_key,poster_key,content_type,uploaded_by&id=eq.${id}&limit=1`,
    { headers: restHeaders(env) },
  );
  if (!res.ok) return null;
  return ((await res.json()) as FullVideoRow[])[0] ?? null;
}

export async function deleteVideoRow(env: Env, id: string): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/videos?id=eq.${id}`, {
    method: 'DELETE',
    headers: restHeaders(env),
  });
  if (!res.ok) throw new Error(`delete video row failed: ${res.status}`);
}

/** Delete the DB row and record the content hash so the file can never be
 *  re-ingested (business rule #6). R2 object removal happens in the caller. */
export async function deletePhotoRow(env: Env, photo: FullPhotoRow, byUser: string): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/deleted_hashes`, {
    method: 'POST',
    headers: { ...restHeaders(env), Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({ sha256: photo.sha256, deleted_by: byUser }),
  });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/photos?id=eq.${photo.id}`, {
    method: 'DELETE',
    headers: restHeaders(env),
  });
  if (!res.ok) throw new Error(`delete photo row failed: ${res.status}`);
}
