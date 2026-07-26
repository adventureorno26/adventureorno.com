import { describe, it, expect } from 'vitest';
import { placesToCsv, placesToGpx, placesToKml } from './exports';
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
    solo_profile: null,
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
