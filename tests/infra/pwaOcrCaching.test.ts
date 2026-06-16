/**
 * #48 — OCR assets must NOT be in the SW precache (they're ~6 MB+ of wasm cores
 * + worker that non-OCR users would otherwise download on install); they are
 * served via a runtime cache instead, populated on first OCR use. This guards
 * the vite.config.ts PWA workbox config against regression. The real precache
 * manifest is verified by building + grepping dist/sw.js (see the verdict/docs).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cfg = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8');

describe('PWA OCR caching (#48)', () => {
  it('excludes tesseract assets from the precache via globIgnores', () => {
    expect(cfg).toMatch(/globIgnores:\s*\[[^\]]*tesseract[^\]]*\]/);
  });

  it('serves OCR assets through a dedicated runtime cache', () => {
    expect(cfg).toContain("cacheName: 'ocr-assets'");
    // the OCR runtime route must key off the tesseract path
    expect(cfg).toMatch(/tesseract\//);
  });
});
