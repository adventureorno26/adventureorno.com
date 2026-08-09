// Import Garmin (or any) GPX/TCX/FIT activity files — the workaround for Strava's
// one-athlete-per-app limit. Parses the track client-side, encodes a Strava-style
// polyline, and inserts via the import_file_activity RPC (attributed to the
// uploader). GPX/TCX are XML (parsed synchronously); FIT is Garmin's native binary
// format, decoded via @garmin/fitsdk (dynamically imported so it stays out of the
// main bundle) in parseFitActivity().

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
/**
 * A readable name for an imported activity.
 *
 * Bulk exports from Garmin and Strava are named after the file — "hiking
 * 2018-01-14 14:34.gpx" — which is how 181 activities ended up called that in the
 * database. Erica's own activities use Strava's convention ("Morning Hike",
 * "Evening Walk"), so match it, from the activity's own LOCAL start time.
 *
 * A filename that is genuinely descriptive ("Old Rag with Josh.gpx") is kept.
 */
export function activityName(filename: string, type: string, startMs: number): string {
  const stem = filename.replace(/\.[^.]+$/, '').trim();
  const looksLikeAnExport =
    /^(hiking|running|cycling|walking|swimming|activity|workout)[\s_-]*\d{4}-\d{2}-\d{2}/i.test(
      stem,
    ) ||
    /^\d{4}-\d{2}-\d{2}[\s_T-]/.test(stem) ||
    /^activity_?\d+$/i.test(stem);
  if (stem && !looksLikeAnExport) return stem;

  const h = new Date(startMs).getHours(); // the device's local hours
  const when =
    h >= 3 && h < 12
      ? 'Morning'
      : h >= 12 && h < 14
        ? 'Lunch'
        : h >= 14 && h < 17
          ? 'Afternoon'
          : h >= 17 && h < 21
            ? 'Evening'
            : 'Night';
  const kind = type ? type[0].toUpperCase() + type.slice(1).toLowerCase() : 'Workout';
  return `${when} ${kind}`;
}

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
    const rte = doc.getElementsByTagName('rte')[0];
    const container = trk ?? rte;
    const t = text(container?.getElementsByTagName('type')[0]);
    if (t) type = mapType(t);
    const nm = text(container?.getElementsByTagName('name')[0]);
    if (nm) name = nm;
    // Recorded tracks use <trkpt>; routes/courses use <rtept>; some exports only
    // carry <wpt>. Fall back through them so a route export still imports.
    let tps = doc.getElementsByTagName('trkpt');
    if (tps.length === 0) tps = doc.getElementsByTagName('rtept');
    if (tps.length === 0) tps = doc.getElementsByTagName('wpt');
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
    // A <name> inside the file wins; otherwise this is still the filename, so the
    // helper turns an export name like "hiking 2018-01-14 14:34" into "Morning Hike".
    name: activityName(name, type, start),
    type,
    polyline: polyline.encode(clean),
    distance: Math.round(distanceMeters),
    moving,
    lat: clean[0][0],
    lng: clean[0][1],
    date: new Date(start).toISOString(),
  };
}

// FIT stores lat/lng as "semicircles": degrees = semicircles * 180 / 2^31.
const SEMICIRCLE_TO_DEG = 180 / 2 ** 31;

/**
 * Parse a Garmin .fit (binary) file into a ParsedActivity (or null if it isn't a
 * valid FIT file or has no GPS track). @garmin/fitsdk is imported dynamically so
 * the ~decoder only loads when someone actually drops a FIT file.
 */
export async function parseFitActivity(
  buf: ArrayBuffer,
  filename: string,
): Promise<ParsedActivity | null> {
  const { Decoder, Stream } = await import('@garmin/fitsdk');
  const stream = Stream.fromArrayBuffer(buf);
  if (!Decoder.isFIT(stream)) return null;

  const decoder = new Decoder(stream);
  const { messages } = decoder.read({
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    applyScaleAndOffset: true,
  });
  const records = (messages.recordMesgs ?? []) as unknown as Array<Record<string, unknown>>;
  const session = (messages.sessionMesgs ?? [])[0] as Record<string, unknown> | undefined;

  const pts: [number, number][] = [];
  const times: number[] = [];
  for (const r of records) {
    const la = r.positionLat;
    const ln = r.positionLong;
    if (typeof la === 'number' && typeof ln === 'number') {
      pts.push([la * SEMICIRCLE_TO_DEG, ln * SEMICIRCLE_TO_DEG]);
    }
    const t = r.timestamp;
    if (t instanceof Date) times.push(t.getTime());
    else if (typeof t === 'number') times.push(t);
  }

  const clean = pts.filter(([la, ln]) => Number.isFinite(la) && Number.isFinite(ln));
  if (clean.length < 2) return null;

  const sport = session?.sport;
  const type = typeof sport === 'string' ? mapType(sport) : 'Workout';

  let distanceMeters = typeof session?.totalDistance === 'number' ? session.totalDistance : 0;
  if (!distanceMeters) {
    for (let i = 1; i < clean.length; i++) distanceMeters += haversine(clean[i - 1], clean[i]);
  }

  const validTimes = times.filter((t) => Number.isFinite(t));
  const startTime = session?.startTime;
  const start =
    startTime instanceof Date
      ? startTime.getTime()
      : validTimes.length
        ? validTimes[0]
        : Date.now();
  const end = validTimes.length ? validTimes[validTimes.length - 1] : start;
  const moving =
    typeof session?.totalTimerTime === 'number'
      ? Math.round(session.totalTimerTime)
      : Math.max(0, Math.round((end - start) / 1000));

  return {
    name: activityName(filename, type, start),
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
