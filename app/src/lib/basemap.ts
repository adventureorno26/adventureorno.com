// THE BASEMAP, AND THE GUARD THAT KEEPS IT ON.
//
// MapTiler suspended the account for exceeding quota and every map in the app
// went blank — the whole product, dark. The cause was an idle globe auto-rotate
// with no stop condition, panning ~7°/second for as long as a tab stayed open
// and streaming tiles for hours.
//
// Mapbox is the basemap now (docs/STATE.md Phase 4, decided with Erica
// 2026-08-10): it is what Snapchat's map is built on, the token already existed,
// and Mapbox supports its APIs from MapLibre —
// https://docs.mapbox.com/help/dive-deeper/mapbox-in-maplibre/
//
// WHY RASTER TILES AND NOT MAPBOX'S VECTOR STYLE
//
// The obvious approach — hand MapLibre the Mapbox style URL — does not work,
// and fails silently, which cost most of an evening:
//
//   * A Mapbox style carries `projection: {name: "globe"}` (MapLibre spells it
//     `type`) and a black `fog`, neither of which MapLibre understands. It
//     throws "unknown property" during validation.
//   * With those stripped, the style loads, the TileJSON resolves, the sprite
//     loads, attribution appears — and the map is still a BLACK RECTANGLE.
//     MapLibre requests the composite vector tiles and they never arrive:
//     `isSourceLoaded` false forever, and NO error event. Reduced to a minimal
//     MapLibre map with nothing but those tiles and one fill layer: same
//     result, while a plain fetch() of the identical tile URL returns 200 and
//     150 KB of protobuf. MapLibre 6 cannot consume mapbox.mapbox-streets-v8
//     through the v4 endpoint here.
//
// Mapbox also serves any style as RASTER tiles, which every renderer handles.
// That is what this uses: the same cartography, drawn server-side. It also means
// no `mapbox://` rewriting, no style document to fetch and clean, and no
// question about redistributing their style.
//
// The trade: labels are baked into the image, so they do not rotate or restyle,
// and we cannot re-order our layers between basemap layers. Neither matters
// here — every marker in this app is a photo drawn on top.
//
// Because a map that never fully loads its source never fires `load`, ALL of
// the app's own layers depend on this working. When the basemap broke, the
// place markers vanished too.
//
// Through MapLibre, Mapbox bills PER TILE REQUEST rather than per map load —
// precisely the failure mode that killed MapTiler — so the tile budget below is
// not optional decoration.
//
// Self-hosting (Protomaps .pmtiles in R2 behind our own Worker) remains the
// endgame: nobody outside can suspend that one.

//
// ---------------------------------------------------------------------------
// 2026-08-15: THE ENDGAME ARRIVED. The map is ours.
// ---------------------------------------------------------------------------
//
// `adventureorno.com/basemap/*` now serves tiles, glyphs and a style out of the
// 137 GB Protomaps planet in our own R2 bucket. Nobody outside can suspend it,
// meter it, or change its cartography under us.
//
// Everything below about Mapbox is KEPT, not fossilised: `VITE_SELF_HOSTED_BASEMAP
// = 'false'` puts the app back on Mapbox raster in one environment variable, with
// no code change. Phase 4's own definition of done requires that the old
// dependency can be turned off without blanking the app — the reverse has to be
// true as well, or the switch is a cliff rather than a switch.
import type { StyleSpecification } from 'maplibre-gl';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

/** Dark, to match the app's theme — the photos and route lines are drawn for it. */
const MAPBOX_STYLE = 'mapbox/dark-v11';

/** Off only by explicit opt-out, so a missing variable means the map is ours. */
export const usingSelfHosted = import.meta.env.VITE_SELF_HOSTED_BASEMAP !== 'false';

export const usingMapbox = !usingSelfHosted && Boolean(MAPBOX_TOKEN);

// ---------------------------------------------------------------------------
// Map appearance — a person's choice, per browser
// ---------------------------------------------------------------------------

export type MapAppearance = 'dark' | 'light' | 'auto';
const APPEARANCE_KEY = 'aon_map_appearance';

/** What the person chose. DARK is the default: it is the app's own, and it is
 *  what every photograph and route line on this map was drawn against. */
export function mapAppearance(): MapAppearance {
  try {
    const v = localStorage.getItem(APPEARANCE_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {
    /* a browser that refuses storage still gets a map */
  }
  return 'dark';
}

export function setMapAppearance(v: MapAppearance): void {
  try {
    localStorage.setItem(APPEARANCE_KEY, v);
  } catch {
    /* ignore */
  }
}

/** The theme to actually ask the Worker for. `auto` follows the device. */
export function resolvedTheme(): 'dark' | 'light' {
  const choice = mapAppearance();
  if (choice !== 'auto') return choice;
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Our own style, on our own origin — so the service worker can cache it and
 *  there is no CSP entry to be silently blocked, which is how the Mapbox search
 *  died unnoticed. */
export function selfHostedStyleUrl(): string {
  return `/basemap/style.json?theme=${resolvedTheme()}`;
}

const ATTRIBUTION =
  '<a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">© Mapbox</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>';

/**
 * The basemap style. Built by hand rather than fetched, so there is nothing to
 * clean and nothing to go stale. `@2x` keeps it sharp on a phone.
 */
export const BASEMAP_STYLE: StyleSpecification = MAPBOX_TOKEN
  ? {
      version: 8,
      sources: {
        basemap: {
          type: 'raster',
          tiles: [
            `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
          ],
          tileSize: 512,
          maxzoom: 22,
          attribution: ATTRIBUTION,
        },
      },
      layers: [
        // A background under the tiles, so a slow tile shows the app's own dark
        // rather than a white flash.
        { id: 'background', type: 'background', paint: { 'background-color': '#0b1220' } },
        { id: 'basemap', type: 'raster', source: 'basemap' },
      ],
    }
  : {
      version: 8,
      sources: {
        basemap: {
          type: 'raster',
          tiles: [
            `https://api.maptiler.com/maps/streets-v2-dark/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
          ],
          tileSize: 512,
          attribution: ATTRIBUTION,
        },
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#0b1220' } },
        { id: 'basemap', type: 'raster', source: 'basemap' },
      ],
    };

/** Terrain-RGB elevation tiles for the 3D flyover on the Routes map. */
export const TERRAIN_DEM_URL = MAPBOX_TOKEN
  ? `https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1.json?secure&access_token=${MAPBOX_TOKEN}`
  : `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`;

// ---------------------------------------------------------------------------
// The tile budget
// ---------------------------------------------------------------------------

/** A day's tile requests from one browser. Well above real use — a hard day of
 *  panning is a few thousand — and far below a runaway loop, which produced tens
 *  of thousands per hour. This catches a BUG, not a heavy user. */
const DAILY_TILE_BUDGET = 30_000;
const BUDGET_KEY = 'aon_tile_budget';

interface Budget {
  day: string; // YYYY-MM-DD, local
  tiles: number;
}

function today(): string {
  const d = new Date();
  // Local components: a date-only string built from UTC would roll over at the
  // wrong moment west of Greenwich (docs/STATE.md §8).
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readBudget(): Budget {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    if (raw) {
      const b = JSON.parse(raw) as Budget;
      if (b && b.day === today() && typeof b.tiles === 'number') return b;
    }
  } catch {
    /* a broken budget must never break the map */
  }
  return { day: today(), tiles: 0 };
}

let budget = readBudget();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function persist(): void {
  if (flushTimer) return;
  // Batched: writing localStorage on every tile would cost more than the tile.
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      localStorage.setItem(BUDGET_KEY, JSON.stringify(budget));
    } catch {
      /* ignore */
    }
  }, 2000);
}

/** Tiles requested by this browser today, and whether the budget is spent. */
export function tileBudget(): { used: number; limit: number; exhausted: boolean } {
  if (budget.day !== today()) budget = { day: today(), tiles: 0 };
  return {
    used: budget.tiles,
    limit: DAILY_TILE_BUDGET,
    exhausted: budget.tiles >= DAILY_TILE_BUDGET,
  };
}

let warned = false;

/** Count one tile. Returns false once the day's budget is gone. */
function spendTile(): boolean {
  if (budget.day !== today()) budget = { day: today(), tiles: 0 };
  budget.tiles += 1;
  persist();
  if (budget.tiles === Math.floor(DAILY_TILE_BUDGET * 0.5) && !warned) {
    warned = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[basemap] ${budget.tiles} tiles today — half the daily budget. If this is not a day of heavy panning, something is looping.`,
    );
  }
  if (budget.tiles > DAILY_TILE_BUDGET) {
    // eslint-disable-next-line no-console
    console.error(
      '[basemap] daily tile budget spent — refusing further tiles. The map keeps what it has already loaded.',
    );
    return false;
  }
  return true;
}

/**
 * THE OTHER BILLED ENDPOINTS. Mapbox charges for Search Box and Directions per
 * request, and neither goes through MapLibre — they are plain `fetch()` calls in
 * lib/maptiler.ts, so `transformRequest` never sees them.
 *
 * That gap was found on 2026-08-11, the day after the tile meter was written to
 * stop a repeat of the MapTiler suspension. A meter that covers only tiles gives
 * exactly the false confidence the meter exists to remove.
 *
 * Counted against their own daily budget, and REFUSED past it. Refusing a search
 * degrades honestly — the typeahead returns nothing and the map still works —
 * whereas refusing tiles would blank the map, which is why the tile budget is
 * much larger.
 */
const DAILY_API_BUDGET = 2_000;
const API_KEY = 'aon_api_budget';

let apiBudget: Budget = (() => {
  try {
    const raw = localStorage.getItem(API_KEY);
    if (raw) {
      const b = JSON.parse(raw) as Budget;
      if (b && b.day === today() && typeof b.tiles === 'number') return b;
    }
  } catch {
    /* ignore */
  }
  return { day: today(), tiles: 0 };
})();

/** Count one billed API call (search, retrieve, directions, reverse geocode).
 *  Returns false once the day's budget is gone. */
export function spendApiCall(what: string): boolean {
  if (apiBudget.day !== today()) apiBudget = { day: today(), tiles: 0 };
  apiBudget.tiles += 1;
  try {
    localStorage.setItem(API_KEY, JSON.stringify(apiBudget));
  } catch {
    /* ignore */
  }
  if (apiBudget.tiles > DAILY_API_BUDGET) {
    // eslint-disable-next-line no-console
    console.error(
      `[basemap] daily Mapbox API budget spent (${what}). Search is off for today; the map is unaffected.`,
    );
    return false;
  }
  return true;
}

/** What the API meter has counted today. */
export function apiCallBudget(): { used: number; limit: number } {
  if (apiBudget.day !== today()) apiBudget = { day: today(), tiles: 0 };
  return { used: apiBudget.tiles, limit: DAILY_API_BUDGET };
}

/**
 * MapLibre's `transformRequest` — the meter. Pass to every map.
 *
 * ALWAYS returns a request, never `undefined`. The signature allows undefined
 * for "leave it alone", but a tile is fetched on a worker and an undefined
 * result there is not worth the risk after what the vector-tile hunt cost.
 */
export function transformRequest(url: string, resourceType?: string): { url: string } {
  if (resourceType === 'Tile' && !spendTile()) {
    // A 1x1 transparent PNG: refusing outright makes MapLibre retry forever.
    return {
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    };
  }
  return { url };
}

/**
 * The options every map shares. Spread into `new maplibregl.Map({...})` so a new
 * map cannot be added with the style but without the meter.
 *
 * A FUNCTION, not a constant, since 2026-08-15: the style now depends on a setting
 * a person can change, and a frozen object would hand every map whichever theme
 * happened to be current when the module first loaded.
 *
 * The meter stays even though our own tiles are not billed per request. It was
 * written to catch a runaway loop — the idle auto-rotate that streamed tiles for
 * hours and got the MapTiler account suspended — and that bug is still possible.
 * It now protects R2 operations instead of somebody's invoice.
 */
export function basemapOptions(): {
  style: StyleSpecification | string;
  transformRequest: typeof transformRequest;
} {
  return {
    style: usingSelfHosted ? selfHostedStyleUrl() : BASEMAP_STYLE,
    transformRequest,
  };
}
