import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// Real-browser regression harness (Stage 0 of the 2026-06-14 QA-fix plan).
//
// WHY THIS EXISTS: the default `vitest.config.ts` runs in jsdom, which cannot
// exercise canvas rendering, pdf.js rasterization, pointer drag, or
// ImageBitmap/VideoFrame extraction. Every issue in KNOWN_ISSUES.md (ISSUE-1..5,
// THUMB-DND) lives in that real-browser layer and ships green under jsdom.
//
// This config drives a real Chromium (the system Google Chrome via Playwright's
// `channel: 'chrome'`, so no browser binary download is needed) against
// `*.browser.test.ts` files under tests/browser/.
//
// Run with: npm run test:browser
export default defineConfig({
  // Pre-bundle deps that the app imports dynamically (docx is a lazy ~395 KB
  // chunk; fflate is used by tests to unzip the DOCX). Without this, Vite
  // discovers them mid-run and re-optimizes, which aborts the in-flight dynamic
  // import ("Failed to fetch dynamically imported module").
  // node-forge is the e-signing crypto dep (dynamically imported by src/signing).
  // tesseract.js is the OCR engine (lazy literal import in src/ocr/ocrEngine.ts);
  // pre-bundle so the real-browser OCR test's dynamic import isn't aborted by a
  // mid-run re-optimize.
  //
  // @pdf-lib/fontkit + @cantoo/pdf-lib were ADDED 2026-07-28 after a CI failure that
  // this comment had already predicted. `--coverage` changes the vite config, so the
  // dep optimizer re-runs at start-up; fontkit (lazily imported by src/export/
  // arabicOverlay.ts) was discovered mid-run and the reload aborted its import:
  //     TypeError: Failed to fetch dynamically imported module: …/@pdf-lib_fontkit.js
  // It only bit `npm run test:coverage:export` — the plain test:browser run passed all
  // 68 files — which is exactly why it survived so long. @cantoo/pdf-lib is added with
  // it: same `await import(...)` shape, same latent race, not yet triggered.
  //
  // INVARIANT: every npm package reached by `await import('<pkg>')` in src/ belongs in
  // this list. Check with:
  //     grep -rhoE "await import\(['\"][^.'\"][^'\"]*['\"]\)" src/ | sort -u
  optimizeDeps: {
    include: ['docx', 'fflate', 'node-forge', 'tesseract.js', '@pdf-lib/fontkit', '@cantoo/pdf-lib'],
  },
  test: {
    include: ['tests/browser/**/*.browser.test.ts'],
    // jsdom setup (fake-indexeddb etc.) is irrelevant here — real browser has real APIs.
    setupFiles: [],
    // The heaviest true-edit tests (truedit-spot-color, issue2-true-edit) do a full
    // PDF build → pdf.js render → content-stream surgery → re-render → pixel sample.
    // They finish in ~3.5s in isolation but exceed the 15s default under full-suite
    // browser/CPU contention (intermittent CI deploy-blocking flake — they COMPLETE,
    // they're just slow under load, not hung). 30s gives headroom for contention while
    // still failing fast on a genuine hang.
    testTimeout: 30_000,
    // M1 #14 — coverage gate on the export RENDER path (the P0 surface). Only active
    // when --coverage is passed (npm run test:coverage:export); a normal test:browser
    // run ignores it. The export element renderer can ONLY be exercised in a real
    // browser (canvas/pdf.js), so the gate lives here, not in the jsdom config. If a
    // regression deletes the pixel tests, coverage drops below the floor and CI fails.
    // Thresholds sit just below the current real values (≈51% lines / 70% functions)
    // to catch deletion without flapping on antialiasing/minor-branch drift.
    coverage: {
      provider: 'v8',
      include: ['src/export/pdfElementRenderer.ts'],
      thresholds: {
        'src/export/pdfElementRenderer.ts': { statements: 45, lines: 45, functions: 60, branches: 25 },
      },
    },
    browser: {
      enabled: true,
      // Vitest 4: provider is a factory from @vitest/browser-playwright.
      // `launchOptions` belongs on the FACTORY (PlaywrightProviderOptions), not
      // the instance. `channel: 'chrome'` selects the system Google Chrome and
      // avoids the binary download (Playwright's chrome-headless-shell isn't
      // packaged for ubuntu 26.04).
      provider: playwright({ launchOptions: { channel: 'chrome' } }),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
});
