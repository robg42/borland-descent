import { defineConfig } from 'vitest/config';

// Pure-logic tests only (the CI gate). jsdom cannot run Web Audio / WebGL, so the
// engine's audio + visual backends are exercised behind interfaces, not for real.
// A real-audio Browser-Mode (Playwright) suite is a documented later option.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['packages/**/test/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
  },
});
