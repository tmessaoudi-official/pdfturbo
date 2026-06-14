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
  optimizeDeps: { include: ['docx', 'fflate', 'node-forge'] },
  test: {
    include: ['tests/browser/**/*.browser.test.ts'],
    // jsdom setup (fake-indexeddb etc.) is irrelevant here — real browser has real APIs.
    setupFiles: [],
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
