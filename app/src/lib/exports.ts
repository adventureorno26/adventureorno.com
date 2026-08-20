import polyline from '@mapbox/polyline';
import { supabase } from './supabase';
import type { Place } from './types';

// Everything you can take with you, generated in the browser and downloaded.
//
// Three different things, and the point of §3e Step 7 is that they are no longer
// pretending to be one: PLACES (the map, in formats other maps read), ACTIVITIES
// (the outings, with their routes), and the ARCHIVE (all of it, as JSON).

function download(filename: string, mime: string, text: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const xml = (s: string | null | undefined) =>
  (s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const csvCell = (s: string | number | null | undefined) => {
  const v = String(s ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

/** Saved, non-bucket, named places — the set we export. */
function exportable(places: Place[]): Place[] {
  return places
    .filter((p) => p.saved && !p.bucket && p.name.trim())
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Pure builders (no DOM) — the actual serialization logic, exported so it can be
// unit-tested without a browser. The export* wrappers just add the download.

/** CSV of the exportable places, header row first. */
export function placesToCsv(places: Place[]): string {
  const head = [
    'name',
    'latitude',
    'longitude',
    'city',
    'state',
    'country',
    'categories',
    'rating',
    'first_visit',
    'last_visit',
  ];
  const lines = [head.join(',')];
  for (const p of exportable(places))
    lines.push(
      [
        p.name,
        p.lat,
        p.lng,
        p.city ?? '',
        p.admin1 ?? '',
        p.country ?? '',
        (p.categories ?? []).join('; '),
        p.rating ?? '',
        p.first_visit ?? '',
        p.last_visit ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  return lines.join('\n');
}

/** GPX 1.1 document with one <wpt> per exportable place. */
export function placesToGpx(places: Place[]): string {
  const wpts = exportable(places)
    .map(
      (p) =>
        `  <wpt lat="${p.lat}" lon="${p.lng}"><name>${xml(p.name)}</name>` +
        `<desc>${xml((p.categories ?? []).join(', '))}</desc></wpt>`,
    )
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="adventureorno.com" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `${wpts}\n</gpx>\n`
  );
}

/** KML document with one <Placemark> per exportable place. */
export function placesToKml(places: Place[]): string {
  const marks = exportable(places)
    .map(
      (p) =>
        `    <Placemark><name>${xml(p.name)}</name>` +
        `<description>${xml((p.categories ?? []).join(', '))}</description>` +
        `<Point><coordinates>${p.lng},${p.lat},0</coordinates></Point></Placemark>`,
    )
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n` +
    `    <name>AdventureOrNo places</name>\n${marks}\n  </Document>\n</kml>\n`
  );
}

export function exportCsv(places: Place[]) {
  download('adventureorno-places.csv', 'text/csv', placesToCsv(places));
}

export function exportGpx(places: Place[]) {
  download('adventureorno-places.gpx', 'application/gpx+xml', placesToGpx(places));
}

export function exportKml(places: Place[]) {
  download('adventureorno-places.kml', 'application/vnd.google-earth.kml+xml', placesToKml(places));
}

// ---------------------------------------------------------------------------
// Activities — the outings, which no export has ever included.
// ---------------------------------------------------------------------------

/** Just the fields an export needs; the archive section carries far more. */
export type ExportActivity = {
  id: string;
  name: string | null;
  type: string | null;
  start_date: string | null;
  local_date: string | null;
  distance: number | null;
  moving_time: number | null;
  elapsed_time: number | null;
  elevation_gain: number | null;
  summary_polyline: string | null;
  original_source: string | null;
  owner_profile: string | null;
  place_id: string | null;
};

const METRES_PER_MILE = 1609.344;
const METRES_PER_FOOT = 0.3048;

const hms = (s: number | null | undefined) => {
  if (s == null) return '';
  const n = Math.round(s);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
};

/** CSV of every outing, in the units she reads them in — miles and feet. */
export function activitiesToCsv(
  rows: ExportActivity[],
  placeName: (id: string | null) => string = () => '',
  personName: (id: string | null) => string = () => '',
): string {
  const head = [
    'date',
    'name',
    'type',
    'miles',
    'moving_time',
    'elapsed_time',
    'elevation_gain_ft',
    'place',
    'recorded_by',
    'source',
    'has_route',
  ];
  const lines = [head.join(',')];
  const sorted = [...rows].sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''));
  for (const a of sorted)
    lines.push(
      [
        a.local_date ?? (a.start_date ?? '').slice(0, 10),
        a.name ?? '',
        a.type ?? '',
        a.distance == null ? '' : (a.distance / METRES_PER_MILE).toFixed(2),
        hms(a.moving_time),
        hms(a.elapsed_time),
        a.elevation_gain == null ? '' : Math.round(a.elevation_gain / METRES_PER_FOOT),
        placeName(a.place_id),
        personName(a.owner_profile),
        a.original_source ?? '',
        a.summary_polyline ? 'yes' : 'no',
      ]
        .map(csvCell)
        .join(','),
    );
  return lines.join('\n');
}

/** GPX 1.1 with one <trk> per outing that has a route. Outings without one are
 *  omitted rather than written as an empty track — a GPX file full of nameless
 *  empty tracks is how you make a map viewer useless. */
export function activitiesToGpx(rows: ExportActivity[]): string {
  const trks: string[] = [];
  for (const a of [...rows].sort((x, y) =>
    (x.start_date ?? '').localeCompare(y.start_date ?? ''),
  )) {
    if (!a.summary_polyline) continue;
    let pts: [number, number][] = [];
    try {
      pts = polyline.decode(a.summary_polyline) as [number, number][];
    } catch {
      continue;
    }
    if (pts.length < 2) continue;
    const seg = pts.map(([lat, lng]) => `      <trkpt lat="${lat}" lon="${lng}"/>`).join('\n');
    trks.push(
      `  <trk><name>${xml(a.name ?? a.type ?? 'Activity')}</name>` +
        `<type>${xml(a.type ?? '')}</type>\n    <trkseg>\n${seg}\n    </trkseg>\n  </trk>`,
    );
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="adventureorno.com" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `${trks.join('\n')}\n</gpx>\n`
  );
}

export function exportActivitiesCsv(
  rows: ExportActivity[],
  placeName?: (id: string | null) => string,
  personName?: (id: string | null) => string,
) {
  download(
    'adventureorno-activities.csv',
    'text/csv',
    activitiesToCsv(rows, placeName, personName),
  );
}

export function exportActivitiesGpx(rows: ExportActivity[]) {
  download('adventureorno-activities.gpx', 'application/gpx+xml', activitiesToGpx(rows));
}

// ---------------------------------------------------------------------------
// The archive — all of it, one section at a time.
// ---------------------------------------------------------------------------

export type ArchiveSection = { section: string; rows: number; note: string };

/** The table of contents: what an archive would contain, before building one.
 *  Counts are what YOU can see — the functions run as the caller (0237). */
export async function fetchArchiveManifest(): Promise<ArchiveSection[]> {
  const { data, error } = await supabase.rpc('export_manifest');
  if (error) throw error;
  return (data ?? []) as ArchiveSection[];
}

export async function fetchArchiveSection(section: string): Promise<unknown[]> {
  const { data, error } = await supabase.rpc('export_section', { p_section: section });
  if (error) throw error;
  // NULL means "not a section", which is a bug here rather than an empty answer.
  if (data == null) throw new Error(`no such section: ${section}`);
  return data as unknown[];
}

/** Build the whole archive, a section at a time.
 *
 *  ONE SECTION PER REQUEST because `authenticated` has an 8-second statement
 *  timeout and the whole thing takes about seven to assemble — a single query
 *  would fail for exactly the person with the most to lose. It also means there
 *  is something true to show while it runs. */
export async function buildArchive(
  onProgress?: (done: number, total: number, section: string) => void,
): Promise<string> {
  const [{ data: header, error: headerError }, manifest] = await Promise.all([
    supabase.rpc('export_header'),
    fetchArchiveManifest(),
  ]);
  if (headerError) throw headerError;

  const data: Record<string, unknown[]> = {};
  let done = 0;
  for (const s of manifest) {
    onProgress?.(done, manifest.length, s.section);
    data[s.section] = await fetchArchiveSection(s.section);
    done += 1;
  }
  onProgress?.(done, manifest.length, '');

  return JSON.stringify(
    {
      ...(header as object),
      contents: manifest,
      data,
    },
    null,
    1,
  );
}

/** Name it for the day it was taken, so two archives never overwrite each other. */
export function archiveFilename(now = new Date()): string {
  return `adventureorno-archive-${now.toISOString().slice(0, 10)}.json`;
}

export function downloadArchive(json: string, now = new Date()) {
  download(archiveFilename(now), 'application/json', json);
}
