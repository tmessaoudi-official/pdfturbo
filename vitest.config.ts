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
    // @cantoo/pdf-lib 2.11.0 restructured its ES build and now ships
    //     import CourierBoldCompressed from './Courier-Bold.compressed.json';
    // with no `with { type: 'json' }` attribute. Node's ESM loader rejects that, so an EXTERNALIZED
    // pdf-lib killed 37 suites at import ("needs an import attribute of type: json") and silently
    // nulled 11 more wherever a dynamic import was caught [measured 2026-09-13; 2.9.2 has no JSON
    // imports]. Production never loads it through Node — Vite bundles it and handles JSON natively —
    // so inlining makes the jsdom suite load pdf-lib through Vite's transform, which handles JSON the
    // way the shipped build does. Two things measured before settling here [2026-09-13]:
    //  - `deps.optimizer.client` (pre-bundling) is NOT an alternative: its bundle picks up fflate's
    //    Node entry and dies at import with `createRequire is not a function`.
    //  - inlining costs a one-time transform per worker: the DOCX editor's lazy `import('./docxToPdf')`
    //    took 13089 ms cold, so a test that waits on it must warm the import in a hook first
    //    (`tests/docx/docxEditorController.test.ts`), not rely on `vi.waitFor`'s 1 s default.
    // Drop this once an upstream release adds the attribute: remove it and the jsdom suite is the check.
    server: { deps: { inline: ['@cantoo/pdf-lib'] } },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
});
