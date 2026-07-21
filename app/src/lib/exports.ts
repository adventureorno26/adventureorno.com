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
  (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

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

export function exportCsv(places: Place[]) {
  const rows = exportable(places);
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
  for (const p of rows)
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
  download('adventureorno-places.csv', 'text/csv', lines.join('\n'));
}

export function exportGpx(places: Place[]) {
  const rows = exportable(places);
  const wpts = rows
    .map(
      (p) =>
        `  <wpt lat="${p.lat}" lon="${p.lng}"><name>${xml(p.name)}</name>` +
        `<desc>${xml((p.categories ?? []).join(', '))}</desc></wpt>`,
    )
    .join('\n');
  const doc =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="adventureorno.com" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `${wpts}\n</gpx>\n`;
  download('adventureorno-places.gpx', 'application/gpx+xml', doc);
}

export function exportKml(places: Place[]) {
  const rows = exportable(places);
  const marks = rows
    .map(
      (p) =>
        `    <Placemark><name>${xml(p.name)}</name>` +
        `<description>${xml((p.categories ?? []).join(', '))}</description>` +
        `<Point><coordinates>${p.lng},${p.lat},0</coordinates></Point></Placemark>`,
    )
    .join('\n');
  const doc =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n` +
    `    <name>AdventureOrNo places</name>\n${marks}\n  </Document>\n</kml>\n`;
  download('adventureorno-places.kml', 'application/vnd.google-earth.kml+xml', doc);
}
