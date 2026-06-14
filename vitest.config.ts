import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
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
