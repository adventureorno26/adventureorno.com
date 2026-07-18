// Parse a Google Takeout / on-device Timeline export into {lat,lng,time} points,
// then stream them to the import-timeline Edge Function in batches. Kept tolerant
// of the several JSON shapes Google has shipped over the years.

import { supabase } from './supabase';

export interface Point {
  lat: number;
  lng: number;
  time?: string;
}

/** "37.421998°, -122.084000°" | "geo:37.4,-122.0" | "37.4,-122.0" → [lat,lng] */
function parseLatLngString(s: string): [number, number] | null {
  const cleaned = s.replace(/geo:/i, '').replace(/°/g, '');
  const m = cleaned.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return [lat, lng];
}

function e7(v: unknown): number | null {
  return typeof v === 'number' ? v / 1e7 : null;
}

/** Extract points from any of the known Timeline JSON shapes. */
export function parseTimeline(root: unknown): Point[] {
  const out: Point[] = [];
  const push = (lat: number | null, lng: number | null, time?: string) => {
    if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      out.push({ lat, lng, time });
    }
  };

  const obj = root as Record<string, unknown>;

  // 1) Classic Records.json: { locations: [{ latitudeE7, longitudeE7, timestamp }] }
  const locations = obj?.locations as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(locations)) {
    for (const l of locations) {
      const ts =
        (l.timestamp as string) ??
        (typeof l.timestampMs === 'string'
          ? new Date(Number(l.timestampMs)).toISOString()
          : undefined);
      push(e7(l.latitudeE7), e7(l.longitudeE7), ts);
    }
  }

  // 2) On-device export: { semanticSegments: [{ timelinePath: [{ point, time }],
  //    visit/activity: { ... placeLocation/latLng } }] } — or a top-level timelinePath.
  const segments =
    (obj?.semanticSegments as Array<Record<string, unknown>> | undefined) ??
    (Array.isArray(root) ? (root as Array<Record<string, unknown>>) : undefined);
  const walkTimelinePath = (path: unknown, fallbackTime?: string) => {
    if (!Array.isArray(path)) return;
    for (const p of path as Array<Record<string, unknown>>) {
      const s = (p.point ?? p.latLng) as string | undefined;
      if (typeof s === 'string') {
        const ll = parseLatLngString(s);
        if (ll) push(ll[0], ll[1], (p.time as string) ?? fallbackTime);
      }
    }
  };
  if (Array.isArray(segments)) {
    for (const seg of segments) {
      const start = (seg.startTime as string) ?? undefined;
      walkTimelinePath(seg.timelinePath, start);
      // visit / activity anchor points
      const visitLL = (
        (seg.visit as Record<string, unknown>)?.topCandidate as Record<string, unknown>
      )?.placeLocation as Record<string, unknown> | undefined;
      const latLngStr = (visitLL?.latLng ?? visitLL?.point) as string | undefined;
      if (typeof latLngStr === 'string') {
        const ll = parseLatLngString(latLngStr);
        if (ll) push(ll[0], ll[1], start);
      }
    }
  }

  // 3) Top-level { timelinePath: [...] }
  walkTimelinePath(obj?.timelinePath);

  return out;
}

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return token;
}

const BATCH = 500;

/** Upload parsed points in batches; calls onProgress(sent, total, saved). */
export async function importPoints(
  points: Point[],
  onProgress: (sent: number, total: number, saved: number) => void,
): Promise<number> {
  const token = await authToken();
  let saved = 0;
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH);
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-timeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ points: batch }),
    });
    if (!res.ok) throw new Error(`Import failed (${res.status})`);
    const r = (await res.json()) as { saved: number };
    saved += r.saved;
    onProgress(Math.min(i + BATCH, points.length), points.length, saved);
  }
  return saved;
}

/** Owner-only: run the clustering job now (cluster_now RPC). */
export async function runClusteringNow(): Promise<{
  clusters_created: number;
  clusters_attached: number;
  points: number;
}> {
  const { data, error } = await supabase.rpc('cluster_now');
  if (error) throw error;
  return data as { clusters_created: number; clusters_attached: number; points: number };
}
