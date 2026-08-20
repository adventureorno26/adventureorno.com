import { describe, it, expect } from 'vitest';
import {
  activitiesToCsv,
  activitiesToGpx,
  archiveFilename,
  placesToCsv,
  placesToGpx,
  placesToKml,
  type ExportActivity,
} from './exports';
import type { Place } from './types';

// Minimal valid Place; override per test.
function place(overrides: Partial<Place>): Place {
  return {
    id: 'id',
    name: 'A Place',
    country: null,
    admin1: null,
    lat: 10,
    lng: 20,
    first_visit: null,
    last_visit: null,
    cover_photo_id: null,
    cover_pos_y: 50,
    address: null,
    city: null,
    auto: false,
    needs_geocode: false,
    name_locked: false,
    counts_as_place: true,
    named_by: null,
    name_scope: null,
    visit_count: 0,
    rating: null,
    review: null,
    is_home: false,
    saved: true,
    is_trail: false,
    part_of: [],
    suggested: false,
    bucket: false,
    website: null,
    categories: [],
    activity_categories: [],
    favorite: null,
    holds_children: false,
    category: null,
    park: null,
    created_by: null,
    created_at: '2026-01-01',
    ...overrides,
  };
}

describe('exportable filtering', () => {
  const set = [
    place({ name: 'Saved', saved: true, bucket: false }),
    place({ name: 'Bucket', saved: true, bucket: true }), // excluded: wishlist
    place({ name: 'Unsaved', saved: false }), // excluded: not on map
    place({ name: '   ', saved: true, bucket: false }), // excluded: blank name
  ];

  it('CSV keeps only saved, non-bucket, named places', () => {
    const lines = placesToCsv(set).split('\n');
    // header + exactly one data row (Saved)
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'name,latitude,longitude,city,state,country,categories,rating,first_visit,last_visit',
    );
    expect(lines[1].startsWith('Saved,')).toBe(true);
  });

  it('GPX/KML emit one node per exportable place', () => {
    expect(placesToGpx(set).match(/<wpt /g)).toHaveLength(1);
    expect(placesToKml(set).match(/<Placemark>/g)).toHaveLength(1);
  });
});

describe('sorting', () => {
  it('orders places by name, case-insensitively', () => {
    const rows = placesToCsv([
      place({ name: 'banana' }),
      place({ name: 'Apple' }),
      place({ name: 'cherry' }),
    ])
      .split('\n')
      .slice(1)
      .map((l) => l.split(',')[0]);
    expect(rows).toEqual(['Apple', 'banana', 'cherry']);
  });
});

describe('CSV escaping', () => {
  it('quotes cells containing commas, quotes, or newlines', () => {
    // Assert on the whole document: a newline inside a quoted cell is valid CSV
    // but spans two physical lines, so we can't split on '\n' here.
    const csv = placesToCsv([
      place({ name: 'Smith, John', city: 'a "b" c', admin1: 'line1\nline2' }),
    ]);
    expect(csv).toContain('"Smith, John"');
    expect(csv).toContain('"a ""b"" c"'); // doubled inner quotes
    expect(csv).toContain('"line1\nline2"');
  });

  it('joins categories with a semicolon (not a bare comma) so CSV stays intact', () => {
    const row = placesToCsv([place({ name: 'X', categories: ['hiking', 'beach'] })]).split('\n')[1];
    expect(row).toContain('hiking; beach');
  });

  it('renders null optional fields as empty cells', () => {
    const row = placesToCsv([place({ name: 'X', rating: null, city: null })]).split('\n')[1];
    expect(row).toBe('X,10,20,,,,,,,');
  });
});

describe('XML escaping', () => {
  it('escapes special chars in GPX names and descriptions', () => {
    const gpx = placesToGpx([place({ name: 'Tom & Jerry <b>', categories: ['a>b', 'c&d'] })]);
    expect(gpx).toContain('<name>Tom &amp; Jerry &lt;b&gt;</name>');
    expect(gpx).toContain('<desc>a&gt;b, c&amp;d</desc>');
    expect(gpx).not.toContain('Tom & Jerry'); // raw ampersand must not survive
  });

  it('escapes special chars in KML and encodes coordinates lng,lat,0', () => {
    const kml = placesToKml([place({ name: "O'Hara & Co", lat: 38.5, lng: -77.1 })]);
    expect(kml).toContain('<name>O&#39;Hara &amp; Co</name>');
    expect(kml).toContain('<coordinates>-77.1,38.5,0</coordinates>');
  });
});

describe('well-formed documents', () => {
  it('GPX has the XML prolog and closes the gpx element', () => {
    const gpx = placesToGpx([place({ name: 'X' })]);
    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(gpx.trimEnd().endsWith('</gpx>')).toBe(true);
  });

  it('empty input still yields a valid (empty) document', () => {
    expect(placesToCsv([])).toBe(
      'name,latitude,longitude,city,state,country,categories,rating,first_visit,last_visit',
    );
    expect(placesToGpx([]).trimEnd().endsWith('</gpx>')).toBe(true);
    expect(placesToKml([]).trimEnd().endsWith('</kml>')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The outings, which no export included until §3e Step 7.
// ---------------------------------------------------------------------------

function activity(overrides: Partial<ExportActivity> = {}): ExportActivity {
  return {
    id: 'a1',
    name: 'Morning run',
    type: 'Run',
    start_date: '2026-04-09T13:00:00Z',
    local_date: '2026-04-09',
    distance: 8046.72, // exactly 5 miles
    moving_time: 2400,
    elapsed_time: 2700,
    elevation_gain: 152.4, // exactly 500 ft
    summary_polyline: null,
    original_source: 'garmin',
    owner_profile: 'p1',
    place_id: 'pl1',
    ...overrides,
  };
}

describe('activitiesToCsv', () => {
  it('reports distance in MILES and climb in FEET — the units she reads', () => {
    const [, row] = activitiesToCsv([activity()]).split('\n');
    const cells = row.split(',');
    expect(cells[3]).toBe('5.00');
    expect(cells[6]).toBe('500');
  });

  it('writes times as h:mm:ss rather than a count of seconds', () => {
    const [, row] = activitiesToCsv([activity()]).split('\n');
    expect(row.split(',')[4]).toBe('0:40:00');
    expect(row.split(',')[5]).toBe('0:45:00');
  });

  it('is ordered oldest first, whatever order the rows arrive in', () => {
    const csv = activitiesToCsv([
      activity({ id: 'b', name: 'Later', start_date: '2026-05-01T10:00:00Z' }),
      activity({ id: 'a', name: 'Earlier', start_date: '2026-01-01T10:00:00Z' }),
    ]);
    const names = csv
      .split('\n')
      .slice(1)
      .map((l) => l.split(',')[1]);
    expect(names).toEqual(['Earlier', 'Later']);
  });

  it('says whether a route exists, so the GPX file is not a surprise', () => {
    const rows = [activity({ summary_polyline: null }), activity({ summary_polyline: 'a' })];
    const flags = activitiesToCsv(rows)
      .split('\n')
      .slice(1)
      .map((l) => l.split(',').pop());
    expect(flags).toEqual(['no', 'yes']);
  });

  it('quotes a name containing a comma instead of splitting the row', () => {
    const csv = activitiesToCsv([activity({ name: 'Run, then coffee' })]);
    expect(csv).toContain('"Run, then coffee"');
    expect(csv.split('\n')[1].split(',').length).toBe(csv.split('\n')[0].split(',').length + 1);
  });

  it('leaves an empty cell where a value is missing rather than writing null', () => {
    const csv = activitiesToCsv([
      activity({ distance: null, moving_time: null, elapsed_time: null, elevation_gain: null }),
    ]);
    expect(csv).not.toContain('null');
    expect(csv.split('\n')[1].split(',').slice(3, 7).join('|')).toBe('|||');
  });
});

describe('activitiesToGpx', () => {
  // A tiny real polyline: three points near Great Falls.
  const line = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

  it('omits outings with no route rather than writing an empty track', () => {
    const gpx = activitiesToGpx([activity({ name: 'No route' })]);
    expect(gpx).not.toContain('<trk>');
    expect(gpx).toContain('</gpx>');
  });

  it('writes one track per outing that has one', () => {
    const gpx = activitiesToGpx([
      activity({ id: 'a', summary_polyline: line }),
      activity({ id: 'b', summary_polyline: null }),
      activity({ id: 'c', summary_polyline: line }),
    ]);
    expect(gpx.match(/<trk>/g)?.length).toBe(2);
    expect(gpx).toContain('<trkpt lat=');
  });

  it('survives a polyline it cannot decode instead of failing the whole export', () => {
    const gpx = activitiesToGpx([
      activity({ id: 'bad', summary_polyline: '\u0000\u0001' }),
      activity({ id: 'good', summary_polyline: line }),
    ]);
    expect(gpx.match(/<trk>/g)?.length).toBe(1);
  });

  it('escapes a name that would otherwise break the XML', () => {
    const gpx = activitiesToGpx([activity({ name: 'Josh & me <fast>', summary_polyline: line })]);
    expect(gpx).toContain('Josh &amp; me &lt;fast&gt;');
  });
});

describe('archiveFilename', () => {
  it('carries the day it was taken, so two archives never overwrite each other', () => {
    expect(archiveFilename(new Date('2026-08-20T21:15:00Z'))).toBe(
      'adventureorno-archive-2026-08-20.json',
    );
  });
});
