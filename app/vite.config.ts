/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vite loads .env.local from the app dir; the repo keeps a single .env.local at
// the workspace root, so point envDir up one level.
export default defineConfig({
  plugins: [react()],
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
