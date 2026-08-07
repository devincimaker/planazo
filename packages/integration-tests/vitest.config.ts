import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Ownership + drift checks run once, before any file.
    globalSetup: ['src/global-setup.ts'],
    // Every test is a round-trip to a Supabase stack; user creation in
    // beforeAll makes hooks the slowest part (tokens are minted locally, but
    // each admin.createUser is still a hosted round-trip). Timeouts are sized
    // for a hosted branch database — loopback runs never get near them.
    testTimeout: 30000,
    hookTimeout: 90000,
  },
});
