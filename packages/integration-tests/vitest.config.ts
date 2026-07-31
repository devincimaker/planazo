import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Every test is a round-trip to the local Supabase stack; signups in
    // beforeAll make hooks the slowest part.
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
