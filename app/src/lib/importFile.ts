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
  /** Where the recording BEGAN — 'garmin', 'strava', 'apple-health'… not how it reached us. */
  origin?: string;
  /** The provider's own id for this exact record. The Tier 1 de-dup key (0203). */
  externalKey?: string;
  /** e.g. "Garmin fēnix 6S" — evidence of origin, and useful to a person reading a list. */
  device?: string;
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

/** Where a recording BEGAN, read off whatever the file says made it.
 *
 *  Mirrors `originFor` in supabase/functions/_shared/strava.ts deliberately: the same word
 *  has to come out whether an outing arrives through Strava's API or as a file, or the two
 *  copies of one run disagree about their own origin. */
function originFromMaker(maker: string | null | undefined): string {
  const m = (maker ?? '').toLowerCase();
  if (!m) return 'unknown';
  for (const p of ['garmin', 'wahoo', 'polar', 'suunto', 'coros']) {
    if (m.includes(p)) return p;
  }
  if (m.includes('strava')) return 'strava-app';
  if (m.includes('alltrails')) return 'alltrails';
  if (m.includes('apple') || m.includes('healthkit')) return 'apple-health';
  return 'unknown';
}

/** Garmin Connect's own activity id, taken from the link it stamps into an export.
 *
 *  `<link href="https://connect.garmin.com/modern/activity/12345678">` appears in the GPX
 *  metadata (and sometimes on the <trk>). It is the id of the activity in Garmin's system,
 *  so it is a genuine Tier 1 key: the same activity exported twice, or exported after
 *  already being imported, attaches instead of arriving again. */
function garminConnectId(doc: Document): string | null {
  const links = doc.getElementsByTagName('link');
  for (let i = 0; i < links.length; i++) {
    const href = links[i].getAttribute('href') ?? text(links[i].getElementsByTagName('href')[0]);
    const m = href?.match(/connect\.garmin\.com\/(?:modern\/)?activity\/(\d+)/i);
    if (m) return m[1];
  }
  return null;
}

/** Parse a GPX or TCX file's text into a ParsedActivity (or null if no track). */
/**
 * The name to send for an imported activity — or '' to let the server name it.
 *
 * This used to mint "Morning Walk" / "Evening Hike" from the clock, matching
 * Strava's convention. Erica: "I want the names of real places, not 'morning
 * walk'." She's right — the time of day is already the date, and it says nothing
 * about where you were.
 *
 * So: a descriptive filename ("Old Rag with Josh.gpx") is a person's own words and
 * is kept. A bulk-export filename ("hiking 2018-01-14 14:34.gpx", "activity_881.fit")
 * is not a name at all, and we send nothing — `import_file_activity` then names the
 * row after the place it geocodes to (migration 0147).
 */
export function activityName(filename: string, _type: string, _startMs: number): string {
  const stem = filename.replace(/\.[^.]+$/, '').trim();
  const looksLikeAnExport =
    /^(hiking|running|cycling|walking|swimming|activity|workout)[\s_-]*\d{4}-\d{2}-\d{2}/i.test(
      stem,
    ) ||
    /^\d{4}-\d{2}-\d{2}[\s_T-]/.test(stem) ||
    /^activity_?\d+$/i.test(stem) ||
    // the clock-reading names this function itself used to produce
    /^(morning|afternoon|evening|night|lunch|late[\s-]?night)[\s_-]+(walk|run|hike|ride|swim|workout|activity|jog|cycle)s?$/i.test(
      stem,
    ) ||
    /^(walk|run|hike|ride|swim|workout|activity)$/i.test(stem);
  return looksLikeAnExport ? '' : stem;
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
  // Provenance, which GPX and TCX carried all along and this parser used to throw away.
  // Until now every file import landed as origin 'unknown' with NO Tier 1 key, so a
  // re-uploaded export could only ever be caught by Tier 2's guess — see 7a-below.
  let device: string | undefined;
  let origin = 'unknown';
  let externalKey: string | undefined;

  if (isTcx) {
    const act = doc.getElementsByTagName('Activity')[0];
    const sport = act?.getAttribute('Sport');
    if (sport) type = mapType(sport);

    // <Creator xsi:type="Device_t"> is the WATCH; <Author> is the software that wrote the
    // file. The watch is the origin; the author is only a fallback for exports with no
    // device block (a phone app, a hand-entered activity).
    const creator = act?.getElementsByTagName('Creator')[0];
    const author = doc.getElementsByTagName('Author')[0];
    device = text(creator?.getElementsByTagName('Name')[0]) ?? undefined;
    origin = originFromMaker(device ?? text(author?.getElementsByTagName('Name')[0]));

    // THE SAME KEY SHAPE AS A FIT FILE, on purpose. TCX gives UnitId (the device serial),
    // ProductID and <Id> (the activity's start instant) — the same three things the FIT
    // file_id message gives. Emitting an identical key means the watch's own .fit and a
    // .tcx export of that same activity are ONE source record rather than two.
    //
    // ONLY when UnitId is present. A key of just the start time would be global across
    // every user (file imports have no connection to scope them), so two people starting
    // together would collide into one activity — the exact bug 0203 exists to prevent.
    // Without a serial there is no key, and Tier 2 proposes instead. A missed match costs
    // a confirmation; a false one silently merges two people's outings.
    const unitId = text(creator?.getElementsByTagName('UnitId')[0]);
    const productId = text(creator?.getElementsByTagName('ProductID')[0]) ?? 'x';
    const startedAt = text(act?.getElementsByTagName('Id')[0]);
    if (unitId && startedAt) {
      const iso = new Date(startedAt).toISOString();
      externalKey = `fit:${originFromMaker(device) === 'garmin' ? 'garmin' : (device ?? 'device').toLowerCase()}:${productId}:${unitId}:${iso}`;
    }
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

    // GPX names its maker on the root element: "Garmin Connect", "StravaGPX", "AllTrails".
    // It is not the device model, but it is what the file actually knows, and it is enough
    // to stop 265 rows all claiming 'unknown'.
    const maker = doc.documentElement?.getAttribute('creator');
    device = maker ?? undefined;
    origin = originFromMaker(maker);
    const gcId = garminConnectId(doc);
    if (gcId) externalKey = `garmin-connect:${gcId}`;
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
    // A <name> inside the file wins; otherwise this is still the filename, and an
    // export-shaped one yields '' so the server names it after the place.
    name: activityName(name, type, start),
    type,
    polyline: polyline.encode(clean),
    distance: Math.round(distanceMeters),
    moving,
    lat: clean[0][0],
    lng: clean[0][1],
    date: new Date(start).toISOString(),
    origin,
    externalKey,
    device,
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

  // THE file_id MESSAGE — the one thing in a FIT file that identifies it globally.
  //
  // Garmin's spec says the combination of type, manufacturer, product and serial_number is
  // a unique identifier for the file, with time_created disambiguating devices that write
  // several. That makes it the exact de-dup key 0203's Tier 1 wants: re-importing the same
  // watch file, from any folder, on any day, attaches instead of duplicating.
  //
  // The parser read every record and session message and skipped this one, so until now a
  // Garmin file arrived indistinguishable from an AllTrails export — which is why all 265
  // file rows in production say origin 'unknown'.
  const fileId = (messages.fileIdMesgs ?? [])[0] as Record<string, unknown> | undefined;
  const manufacturer = typeof fileId?.manufacturer === 'string' ? fileId.manufacturer : undefined;
  const serial = fileId?.serialNumber;
  const created = fileId?.timeCreated;
  const createdIso =
    created instanceof Date
      ? created.toISOString()
      : typeof created === 'number'
        ? new Date(created).toISOString()
        : undefined;
  // Only a key when it is genuinely identifying. A partial one would collide across files.
  const externalKey =
    manufacturer && serial != null && createdIso
      ? `fit:${manufacturer}:${String(fileId?.product ?? 'x')}:${String(serial)}:${createdIso}`
      : undefined;

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

  // Provenance travels with the parse, so the importer never has to guess.
  return {
    name: activityName(filename, type, start),
    type,
    polyline: polyline.encode(clean),
    distance: Math.round(distanceMeters),
    moving,
    lat: clean[0][0],
    lng: clean[0][1],
    date: new Date(start).toISOString(),
    origin: manufacturer ?? 'unknown',
    externalKey,
    device: manufacturer ? [manufacturer, fileId?.product].filter(Boolean).join(' ') : undefined,
  };
}

/** One import ACTION — a person choosing files, once. Every item lands under it. */
export async function beginImportRun(method = 'file-upload'): Promise<string> {
  const { data, error } = await supabase.rpc('begin_ingest_run', {
    p_method: method,
    p_actor_kind: 'user',
  });
  if (error) throw error;
  return data as string;
}

export async function finishImportRun(runId: string): Promise<void> {
  await supabase.rpc('finish_ingest_run', { p_run: runId });
}

export interface ImportOutcome {
  activityId: string;
  /** inserted | attached | duplicate | proposed — the ledger's word, surfaced to the user. */
  disposition: string;
  reason: string | null;
}

/**
 * Bring one parsed activity in through the ONE door (0203).
 *
 * Replaces `import_file_activity`, which matched an existing row and returned its id
 * WITHOUT INSERTING — so a second recording of an outing was not stored, not linked and not
 * logged. It also re-credited a matched activity to every owner/editor, which is how one
 * person's upload silently changed whose outing it was.
 *
 * Now: the file is always kept, attribution is never touched, and the caller is told what
 * actually happened so the UI can stop saying "Imported" when it means "you already had it".
 */
export async function importActivityFile(runId: string, p: ParsedActivity): Promise<ImportOutcome> {
  const { data, error } = await supabase.rpc('ingest_activity', {
    p_run: runId,
    p_provider: 'file',
    p_origin: p.origin ?? 'unknown',
    p_external_key: p.externalKey ?? undefined,
    p_name: p.name,
    p_type: p.type,
    p_polyline: p.polyline,
    p_distance: p.distance,
    p_moving: p.moving,
    p_lat: p.lat,
    p_lng: p.lng,
    p_date: p.date,
    p_device: p.device ?? undefined,
  });
  if (error) throw error;
  const r = data as { activity_id: string; disposition: string; reason: string | null };
  return { activityId: r.activity_id, disposition: r.disposition, reason: r.reason };
}

/** A single file on its own still gets a run, because provenance is not optional. */
export async function importFileActivity(p: ParsedActivity): Promise<ImportOutcome> {
  const run = await beginImportRun();
  try {
    return await importActivityFile(run, p);
  } finally {
    await finishImportRun(run);
  }
}
