/**
 * One-off vitest config for the Adobe/DSS verification-kit generator.
 *
 * The default `vitest.config.ts` globs only `tests/**`, so the generator (which
 * lives under docs/reviews/) never runs in CI. This config includes ONLY the
 * generator file. Run it on demand:
 *
 *   ./node_modules/.bin/vitest run \
 *     --config docs/reviews/adobe-verify-2026-06-18/vitest.gen.config.ts
 *
 * environment is 'node' — the generator touches only node-forge + @cantoo/pdf-lib
 * (both pure-JS) and node:fs; no jsdom/DOM is needed. Two RSA-2048 keygens in
 * beforeAll → generous timeouts.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['docs/reviews/adobe-verify-2026-06-18/generate-samples.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
