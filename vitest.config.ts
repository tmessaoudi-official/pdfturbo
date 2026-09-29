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
    // The same allowance, for HOOKS. Leaving this at vitest's 10s default gave a `beforeAll`
    // doing that identical keygen one third of the budget of a test doing it — which is how
    // `incrementalSigner.test.ts:106` failed a real pre-push run with `Hook timed out in
    // 10000ms` and blocked the push. Three sibling hooks had already been patched one at a
    // time with `}, 60_000)`; the fourth was missed, so the origin is this gap, not that
    // fourth argument. 60s is the value those three independently converged on, and it is
    // measured headroom, not a guess: the failing hook's workload runs in 242–466ms idle and
    // 564–2297ms under 8-way CPU saturation, so it is contention-slow, never hung.
    // The per-hook `60_000` args are now redundant but kept as local documentation.
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
    // Real-browser tests run only under vitest.browser.config.ts (npm run
    // test:browser); they need canvas/pdf.js/?url imports that jsdom lacks.
    exclude: [...configDefaults.exclude, 'tests/browser/**'],
    setupFiles: ['tests/setup.ts'],
    // vitest 5 never removes its root module-cache dir (/tmp/<nanoid>, ~23 MB per run); this
    // removes it at run end, and refuses to start if the internal field it reads changes.
    globalSetup: ['tests/vitestTmpCleanup.ts'],
    // No `server.deps.inline` for @cantoo/pdf-lib any more (removed 2026-09-29). 2.11.0's ES build imported JSON
    // without `with { type: 'json' }`, which Node's loader rejects, so an externalized pdf-lib turned 48 jsdom files
    // red [2026-09-13] and it was inlined through Vite's transform; 2.11.1 ships the attribute and the full jsdom suite
    // is green without it (3304 tests). `deps.optimizer.client` was never an alternative: it bundles fflate's Node
    // entry and dies with `createRequire is not a function`. If a future pdf-lib drops the attribute again, the
    // symptom is "needs an import attribute of type: json" at import — restore `server: { deps: { inline: [...] } }`.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
});
