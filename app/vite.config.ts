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
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          supabase: ['@supabase/supabase-js'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
