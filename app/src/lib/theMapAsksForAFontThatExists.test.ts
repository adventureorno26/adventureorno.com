// Every font the app asks for must be one the glyph server actually serves.
//
// Measured against production on 2026-08-21, before this test existed:
//
//     /basemap/fonts/Open Sans Bold,Noto Sans Bold/0-255.pbf   → 404
//     /basemap/fonts/Noto Sans Bold/0-255.pbf                  → 502
//     /basemap/fonts/Noto Sans Medium/0-255.pbf                → 200, 77 KB
//
// Four overlay layers in MapView asked for the first one. The glyph Worker only passes a
// stack matching /^Noto Sans[ A-Za-z0-9]*$/ — it is not an open proxy — so anything beginning
// "Open Sans" is refused, and `Noto Sans Bold` is not published upstream at all. Both halves
// of the stack failed, on every tile, and MapLibre logged it every time.
//
// `workers/basemap/src/style.test.ts` has asserted this rule for the STYLE since the basemap
// was built. The app's own layers were never covered by it, which is exactly how a rule that
// is written down gets broken: it was guarded in one of the two places that could break it.
import { describe, expect, it } from 'vitest';

// The faces the Worker serves. Bold is deliberately absent — it 502s upstream.
const PUBLISHED = new Set(['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic']);

const RAW = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const SOURCES = Object.entries(RAW).filter(([path]) => !/\.test\.tsx?$/.test(path));

describe('the map asks for a font that exists', () => {
  it('every text-font in the app names a published face', () => {
    const offenders: string[] = [];
    for (const [path, src] of SOURCES) {
      // Both the literal array form and a named constant holding one.
      for (const m of src.matchAll(/text-font'?\s*:\s*([A-Za-z_][\w]*)\s*,/g)) {
        const name = m[1];
        const decl = new RegExp(`const\\s+${name}\\s*=\\s*(\\[[^\\]]*\\])`);
        const found = src.match(decl)?.[1];
        if (!found) {
          offenders.push(`${path} (text-font: ${name}, and no literal for it in this file)`);
          continue;
        }
        for (const face of found.match(/'([^']+)'/g) ?? []) {
          const f = face.slice(1, -1);
          if (!PUBLISHED.has(f)) offenders.push(`${path} (${f})`);
        }
      }
      for (const m of src.matchAll(/text-font'?\s*:\s*(\[[^\]]*\])/g)) {
        for (const face of m[1].match(/'([^']+)'/g) ?? []) {
          const f = face.slice(1, -1);
          if (!PUBLISHED.has(f)) offenders.push(`${path} (${f})`);
        }
      }
    }
    expect(offenders, 'these ask for a font the glyph server refuses or cannot fetch').toEqual([]);
  });

  it('still refuses Bold, which is the one that started this', () => {
    expect(PUBLISHED.has('Noto Sans Bold')).toBe(false);
    expect(PUBLISHED.has('Open Sans Bold')).toBe(false);
  });
});
