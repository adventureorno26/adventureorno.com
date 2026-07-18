/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vite loads .env.local from the app dir; the repo keeps a single .env.local at
// the workspace root, so point envDir up one level.
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  server: { port: 5173 },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
