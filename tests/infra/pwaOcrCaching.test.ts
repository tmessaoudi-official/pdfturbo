/**
 * #48 — OCR assets must NOT be in the SW precache (they're ~6 MB+ of wasm cores
 * + worker that non-OCR users would otherwise download on install); they are
 * served via a runtime cache instead, populated on first OCR use. This guards
 * the vite.config.ts PWA workbox config against regression. The real precache
 * manifest is verified by building + grepping dist/sw.js (see the verdict/docs).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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

// Row 32 (2026-09-26) — pdf.js's CMap files are served from public/pdfjs/cmaps/ and cached on first
// use, never precached: only CJK documents that need a CMap fetch one.
describe('PWA CMap caching (row 32)', () => {
  it('serves CMap files through a dedicated runtime cache keyed on /pdfjs/cmaps/', () => {
    expect(cfg).toContain("cacheName: 'pdfjs-cmaps'");
    expect(cfg).toMatch(/url\.pathname\.includes\('\/pdfjs\/cmaps\/'\)/);
  });

  it('holds every vendored CMap file, so a usecmap chain is never evicted', () => {
    const block = cfg.slice(cfg.indexOf("cacheName: 'pdfjs-cmaps'"));
    const max = Number(/maxEntries:\s*(\d+)/.exec(block)?.[1]);
    const files = readdirSync(resolve(ROOT, 'node_modules/pdfjs-dist/cmaps')).length;
    expect(files).toBeGreaterThan(100);
    expect(max).toBeGreaterThanOrEqual(files);
  });

  it('keeps .bcmap out of the precache globs', () => {
    expect(/globPatterns:\s*\[([^\]]*)\]/.exec(cfg)?.[1]).not.toMatch(/bcmap/);
  });
});

// Row 36 (2026-09-26) — pdf.js's JBIG2 / JPEG 2000 decoders are served from public/pdfjs/wasm/ and cached
// on first use. Their JS fallbacks match the precache's **/*.js glob, so the ignore is load-bearing.
describe('PWA decoder caching (row 36)', () => {
  it('serves the decoders through a dedicated runtime cache keyed on /pdfjs/wasm/', () => {
    expect(cfg).toContain("cacheName: 'pdfjs-wasm'");
    expect(cfg).toMatch(/url\.pathname\.includes\('\/pdfjs\/wasm\/'\)/);
  });

  it('places that rule before the generic .js rule, so the JS fallbacks land in it', () => {
    expect(cfg.indexOf("cacheName: 'pdfjs-wasm'")).toBeGreaterThan(-1);
    expect(cfg.indexOf("cacheName: 'pdfjs-wasm'")).toBeLessThan(cfg.indexOf("cacheName: 'pdf-chunks'"));
  });

  it('keeps everything under pdfjs/ out of the precache', () => {
    expect(cfg).toMatch(/globIgnores:\s*\[[^\]]*'\*\*\/pdfjs\/\*\*'[^\]]*\]/);
  });
});
