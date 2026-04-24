import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['./tests/setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    reporters: ['verbose'],
    sequence: { concurrent: false },
  },
});
