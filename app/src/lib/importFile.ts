// Import Garmin (or any) GPX/TCX activity files — the workaround for Strava's
// one-athlete-per-app limit. Parses the track client-side, encodes a Strava-style
// polyline, and inserts via the import_file_activity RPC (attributed to the
// uploader). FIT is binary and not supported here — export GPX/TCX from Garmin
// Connect (each activity → gear icon → "Export to GPX/TCX").

import polyline from '@mapbox/polyline';
import { supabase } from './supabase';

export interface ParsedActivity {
  name: string;
  type: string; // Hike / Walk / Run / Ride / Workout
  polyline: string; // encoded [lat,lng] precision 5
  distance: number; // meters
  moving: number; // seconds
  lat: number;
  lng: number;
  date: string; // ISO start
}

function mapType(s: string): string {
  const t = s.toLowerCase();
  if (t.includes('hik')) return 'Hike';
  if (t.includes('walk')) return 'Walk';
  if (t.includes('run')) return 'Run';
  if (t.includes('bik') || t.includes('cycl') || t.includes('ride')) return 'Ride';
  return 'Workout';
}

const R = 6371008.8;
function haversine(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function text(el: Element | null | undefined): string | null {
  return el?.textContent?.trim() || null;
}

/** Parse a GPX or TCX file's text into a ParsedActivity (or null if no track). */
export function parseActivityFile(raw: string, filename: string): ParsedActivity | null {
  const doc = new DOMParser().parseFromString(raw, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;

  const isTcx =
    doc.getElementsByTagName('TrainingCenterDatabase').length > 0 || /\.tcx$/i.test(filename);
  const pts: [number, number][] = [];
  const times: number[] = [];
  let type = 'Workout';
  let name = filename.replace(/\.[^.]+$/, '');
  let distanceMeters = 0;

  if (isTcx) {
    const act = doc.getElementsByTagName('Activity')[0];
    const sport = act?.getAttribute('Sport');
    if (sport) type = mapType(sport);
    const tps = doc.getElementsByTagName('Trackpoint');
    for (let i = 0; i < tps.length; i++) {
      const tp = tps[i];
      const la = text(tp.getElementsByTagName('LatitudeDegrees')[0]);
      const ln = text(tp.getElementsByTagName('LongitudeDegrees')[0]);
      const tm = text(tp.getElementsByTagName('Time')[0]);
      if (la && ln) pts.push([parseFloat(la), parseFloat(ln)]);
      if (tm) times.push(Date.parse(tm));
    }
    const dms = doc.getElementsByTagName('DistanceMeters');
    for (let i = 0; i < dms.length; i++) {
      const v = parseFloat(text(dms[i]) || '0');
      if (v > distanceMeters) distanceMeters = v; // cumulative → max is the total
    }
  } else {
    const trk = doc.getElementsByTagName('trk')[0];
    const t = text(trk?.getElementsByTagName('type')[0]);
    if (t) type = mapType(t);
    const nm = text(trk?.getElementsByTagName('name')[0]);
    if (nm) name = nm;
    const tps = doc.getElementsByTagName('trkpt');
    for (let i = 0; i < tps.length; i++) {
      const tp = tps[i];
      const la = tp.getAttribute('lat');
      const ln = tp.getAttribute('lon');
      const tm = text(tp.getElementsByTagName('time')[0]);
      if (la && ln) pts.push([parseFloat(la), parseFloat(ln)]);
      if (tm) times.push(Date.parse(tm));
    }
  }

  const clean = pts.filter(([la, ln]) => Number.isFinite(la) && Number.isFinite(ln));
  if (clean.length < 2) return null;

  if (!distanceMeters) {
    for (let i = 1; i < clean.length; i++) distanceMeters += haversine(clean[i - 1], clean[i]);
  }
  const validTimes = times.filter((t) => Number.isFinite(t));
  const start = validTimes.length ? validTimes[0] : Date.now();
  const end = validTimes.length ? validTimes[validTimes.length - 1] : start;
  const moving = Math.max(0, Math.round((end - start) / 1000));

  return {
    name,
    type,
    polyline: polyline.encode(clean),
    distance: Math.round(distanceMeters),
    moving,
    lat: clean[0][0],
    lng: clean[0][1],
    date: new Date(start).toISOString(),
  };
}

/** Insert one parsed activity via the RPC (dedupes against your own imports). */
export async function importFileActivity(p: ParsedActivity): Promise<string> {
  const { data, error } = await supabase.rpc('import_file_activity', {
    p_name: p.name,
    p_type: p.type,
    p_polyline: p.polyline,
    p_distance: p.distance,
    p_moving: p.moving,
    p_lat: p.lat,
    p_lng: p.lng,
    p_date: p.date,
  });
  if (error) throw error;
  return data as string;
}
