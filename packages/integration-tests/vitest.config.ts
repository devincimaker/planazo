import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Ownership + drift checks run once, before any file.
    globalSetup: ['src/global-setup.ts'],
    // Every test is a round-trip to a Supabase stack; signups in beforeAll make
    // hooks the slowest part. Timeouts are sized for a hosted branch database
    // (~1.1s per signup) — loopback runs never get near them.
    testTimeout: 30000,
    hookTimeout: 90000,
  },
});
