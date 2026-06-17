import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // Mirror the browser config (vitest.browser.config.ts, commit 87180d1): the
    // signing tests do node-forge RSA-2048 keygen + a full PDF sign (~3s in
    // isolation) and intermittently exceed the 5s default under full-suite CPU
    // contention — slow under load, not hung. 30s absorbs the contention while
    // still failing fast on a genuine hang.
    testTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
    // Real-browser tests run only under vitest.browser.config.ts (npm run
    // test:browser); they need canvas/pdf.js/?url imports that jsdom lacks.
    exclude: [...configDefaults.exclude, 'tests/browser/**'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
});
