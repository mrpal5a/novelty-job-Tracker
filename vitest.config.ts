// vitest.config.ts
// Unit tests for the pure maths in src/lib (calculators, BOM costing, paper
// stock). Node environment — nothing here renders. The @/ alias mirrors
// tsconfig's paths so tests import exactly what the app imports.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The server (Vercel) runs in UTC; a developer's laptop at the plant runs
    // in IST. Tests take the server's clock, so a date bug that only shows
    // there fails here too.
    env: { TZ: 'UTC' },
  },
});
