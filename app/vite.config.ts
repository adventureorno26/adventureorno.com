/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * FAIL THE BUILD RATHER THAN SHIP A SILENTLY BROKEN ONE.
 *
 * `VITE_*` values are baked in at build time. An empty one becomes the string
 * "undefined" in the bundle and its feature just... goes. Nothing errors,
 * nothing logs. That is exactly how `VITE_GOOGLE_CLIENT_ID` went missing and
 * the Google Photos button quietly disappeared, and it is why STATE.md Phase 1
 * exists.
 *
 * REQUIRED means the app is broken without it, not merely reduced:
 *   - Supabase URL + publishable key: no data at all, every page is empty.
 *   - A map source: with neither, every map is blank — and a blank map hides
 *     the places, the routes and the fog, because they are drawn on it.
 *
 * Everything else (photo gateway, Strava, Google) degrades honestly: the
 * feature hides itself and says so. Those stay optional on purpose.
 */
function requireClientEnv(): Plugin {
  const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
  // At least one of these, or there is no basemap.
  const REQUIRED_ONE_OF = ['VITE_MAPBOX_TOKEN', 'VITE_MAPTILER_KEY'];

  return {
    name: 'aon-require-client-env',
    // Build only. `vite dev` stays usable with a partial .env.local.
    apply: 'build',
    config(_config, { mode }) {
      // '..' is the workspace root — the same envDir Vite itself uses below.
      const env = loadEnv(mode, '..', 'VITE_');
      const blank = (k: string) => !env[k] || env[k].trim() === '';

      const missing = REQUIRED.filter(blank);
      if (REQUIRED_ONE_OF.every(blank)) missing.push(REQUIRED_ONE_OF.join(' or '));

      if (missing.length > 0) {
        throw new Error(
          `\n\nRefusing to build: ${missing.length} required client variable(s) are empty.\n` +
            missing.map((v) => `  - ${v}`).join('\n') +
            '\n\nThese are baked into the bundle at build time, so an empty one does not fail at\n' +
            'runtime — the feature silently disappears. Set them in .env.local (local builds) or\n' +
            'in the CI environment, then build again.\n',
        );
      }
    },
  };
}

// Vite loads .env.local from the app dir; the repo keeps a single .env.local at
// the workspace root, so point envDir up one level.
// The SHA this bundle was built from, baked in so the running app can compare
// itself to /version.json and notice that a deploy has happened. prebuild stamps
// that file before vite runs, so it is always there and always current.
function builtSha(): string {
  try {
    // This file is type-checked WITHOUT @types/node, so node's globals are reached
    // through a narrow declared shape rather than an import. The config only ever
    // runs in Node, where both exist.
    const req = (globalThis as unknown as { require?: (m: string) => unknown }).require;
    const fs = req?.('fs') as { readFileSync: (p: string, e: string) => string } | undefined;
    if (!fs) return 'unknown';
    return (
      (JSON.parse(fs.readFileSync('public/version.json', 'utf8')) as { sha?: string }).sha ??
      'unknown'
    );
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  define: { __BUILD_SHA__: JSON.stringify(builtSha()) },
  plugins: [react(), requireClientEnv()],
  envDir: '..',
  server: { port: 5173 },
  build: {
    // Split the heavy, cacheable vendors into their own chunks so the map view's
    // JS parses faster and repeat visits reuse them. MapLibre is the big one.
    // Vite 8 emits <link modulepreload> for lazily-imported chunks too, which put the
    // ~1 MB MapLibre bundle back on the login page — undoing the deliberate change
    // that made MapView lazy in the first place. A preload still DOWNLOADS the file;
    // the map route's dynamic import fetches it when it is actually needed.
    modulePreload: {
      resolveDependencies: (_url: string, deps: string[]) =>
        deps.filter((d) => !d.includes('maplibre')),
    },
    rollupOptions: {
      output: {
        // Vite 8 / Rollup 5 removed the object form of manualChunks; it is a function
        // now. Same three chunks as before, expressed as module-id matches.
        manualChunks(id: string) {
          // NOT the stylesheet. maplibre-gl.css is imported EAGERLY from main.tsx (it
          // must load before index.css or the map collapses to 0 height), so putting
          // it in the maplibre chunk makes the entry statically depend on that chunk
          // and drags the 1 MB of JS onto the login page. The old object form listed
          // the package as a chunk entry point and never had this problem.
          if (id.includes('node_modules/maplibre-gl') && !id.endsWith('.css')) return 'maplibre';
          if (id.includes('node_modules/@supabase/')) return 'supabase';
          // react, react-dom and react-router-dom, as before.
          if (/node_modules\/(react|react-dom|react-router|react-router-dom)\//.test(id)) {
            return 'react';
          }
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      // Edge-function logic that is pure TypeScript (no Deno APIs) is tested by the
      // same runner. There is no local Deno, so without this the route scorer — the
      // piece where a silent bug would poison every suggestion — would ship untested.
      '../supabase/functions/_shared/**/*.test.ts',
    ],
  },
});
