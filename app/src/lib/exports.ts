import type { Place } from './types';

// Client-side exports of our places → CSV / GPX / KML. All generated in the
// browser (no server), then downloaded.

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
