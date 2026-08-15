// THE MAP IS OURS — and the switch back has to keep working.
//
// Phase 4's definition of done requires that the old dependency can be turned off
// without blanking the app. The reverse matters just as much: if self-hosting ever
// has to be undone, it must be one environment variable and not a code change.
import { describe, expect, it } from 'vitest';

const RAW = import.meta.glob('./basemap.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const SRC = Object.values(RAW)[0] ?? '';

describe('the app asks our own Worker for the map', () => {
  it('builds a same-origin style URL with the theme on it', () => {
    expect(SRC).toMatch(/\/basemap\/style\.json\?theme=/);
    // Same-origin on purpose: the service worker can cache it, and there is no CSP
    // entry to be silently blocked — which is how the Mapbox search died unnoticed.
    expect(SRC).not.toMatch(/https?:\/\/[^'"`]*\/basemap\/style\.json/);
  });

  it('is on by default, and off only by explicit opt-out', () => {
    // A missing variable must mean OUR map, or a fresh deploy quietly goes back to
    // paying Mapbox per tile.
    expect(SRC).toMatch(/VITE_SELF_HOSTED_BASEMAP !== 'false'/);
  });

  it('keeps the Mapbox path so the switch is reversible', () => {
    expect(SRC).toMatch(/api\.mapbox\.com/);
    expect(SRC).toMatch(/BASEMAP_STYLE/);
  });

  it('hands out options through a FUNCTION, not a frozen object', () => {
    // The style depends on a setting that can change; a constant would hand every
    // map whichever theme was current when the module first loaded.
    expect(SRC).toMatch(/export function basemapOptions\(\)/);
  });

  it('still meters tiles', () => {
    // Written to catch the runaway auto-rotate that got MapTiler suspended. Our own
    // tiles are not billed per request, but that bug is still possible — it now
    // protects R2 operations instead of somebody's invoice.
    expect(SRC).toMatch(/transformRequest/);
    expect(SRC).toMatch(/DAILY_TILE_BUDGET/);
  });

  it('defaults the appearance to dark', () => {
    // The app's own default, and what every photo and route line was drawn against.
    expect(SRC).toMatch(/return 'dark';/);
  });
});
