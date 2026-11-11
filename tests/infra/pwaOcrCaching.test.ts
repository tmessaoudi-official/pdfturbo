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

  it('places the OCR rule before the generic .js rule (limits row 9, B3)', () => {
    // Workbox takes the FIRST matching route. The OCR worker and the tesseract `*.wasm.js` cores end in .js,
    // so below the catch-all they would land in `pdf-chunks` (20 entries) and could be evicted by ordinary
    // app chunks — silently re-downloading megabytes on the next OCR.
    const ocr = cfg.indexOf("cacheName: 'ocr-assets'");
    const catchAll = cfg.indexOf("cacheName: 'pdf-chunks'");
    expect(ocr).toBeGreaterThan(-1);
    expect(catchAll).toBeGreaterThan(-1);
    expect(ocr).toBeLessThan(catchAll);
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

  it('the same cache also holds the CMYK profile under /pdfjs/iccs/ (row 37)', () => {
    expect(cfg).toMatch(/url\.pathname\.includes\('\/pdfjs\/iccs\/'\)/);
  });

  it('keeps everything under pdfjs/ out of the precache', () => {
    expect(cfg).toMatch(/globIgnores:\s*\[[^\]]*'\*\*\/pdfjs\/\*\*'[^\]]*\]/);
  });
});

// Limits row 10 (B4) — the vendored Arabic font (Noto Naskh, 172 KB) is fetched only when a document needs
// Arabic shaping (the overlay bake and the searchable-OCR Arabic layer). It stays OUT of the precache, like
// the OCR assets (#48), and is cached the first time it is fetched so later Arabic exports work offline.
describe('PWA Arabic font caching (limits row 10, B4)', () => {
  it('caches the app fonts in a dedicated same-origin runtime cache on first use', () => {
    const rule = cfg.slice(cfg.lastIndexOf('urlPattern', cfg.indexOf("cacheName: 'app-fonts'")), cfg.indexOf("cacheName: 'app-fonts'"));
    expect(cfg.indexOf("cacheName: 'app-fonts'")).toBeGreaterThan(-1);
    expect(rule).toMatch(/\.ttf/);
    expect(rule).toMatch(/url\.origin === self\.location\.origin/);
    expect(rule).toMatch(/handler: 'CacheFirst'/);
  });

  it('does not precache fonts (the install payload stays as small as #48 left it)', () => {
    const glob = cfg.match(/globPatterns:\s*\[([^\]]*)\]/);
    expect(glob).not.toBeNull();
    expect(glob?.[1]).not.toMatch(/ttf|woff|otf/);
  });
});

// Phone-signature-pad step 5c — the scanner's zxing wasm is cached on first scan, and the phone pad page is never
// served stale or as the editor. The rules are read out of the config and RUN on real URLs, not just matched as text.
describe('PWA scanner wasm + phone pad page (phone-signature-pad 5c)', () => {
  /** The urlPattern source of the rule whose cacheName is `name`, evaluated with a fake `self`, and its handler. */
  const rule = (name: string): { match: (href: string) => boolean; handler: string } => {
    const at = cfg.indexOf(`cacheName: '${name}'`);
    expect(at, `no runtime rule with cacheName '${name}'`).toBeGreaterThan(-1);
    const start = cfg.lastIndexOf('urlPattern:', at);
    const handlerAt = cfg.indexOf('handler:', start);
    const src = cfg.slice(start + 'urlPattern:'.length, handlerAt).trim().replace(/,$/, '');
    const fn = new Function('self', `return ${src};`)({ location: { origin: 'https://app.test' } }) as (o: { url: URL }) => boolean;
    const handler = /handler:\s*'(\w+)'/.exec(cfg.slice(handlerAt))?.[1] ?? '';
    return { match: (href) => fn({ url: new URL(href) }), handler };
  };

  it('caches the zxing reader wasm, same origin only, CacheFirst', () => {
    const r = rule('zxing-wasm');
    expect(r.handler).toBe('CacheFirst');
    expect(r.match('https://app.test/pdfturbo/assets/zxing_reader-Ab12_cD.wasm')).toBe(true);
    expect(r.match('https://cdn.test/pdfturbo/assets/zxing_reader-Ab12_cD.wasm')).toBe(false);
    expect(r.match('https://app.test/pdfturbo/assets/reader-Ab12.js')).toBe(false);
    expect(r.match('https://app.test/pdfturbo/pdfjs/wasm/openjpeg.wasm')).toBe(false);
  });

  it('serves pad.html NetworkFirst from its own cache, same origin only', () => {
    const r = rule('pad-page');
    expect(r.handler).toBe('NetworkFirst');
    expect(r.match('https://app.test/pdfturbo/pad.html')).toBe(true);
    expect(r.match('https://app.test/pdfturbo/pad.html?x=1')).toBe(true);
    expect(r.match('https://cdn.test/pdfturbo/pad.html')).toBe(false);
    expect(r.match('https://app.test/pdfturbo/')).toBe(false);
    expect(r.match('https://app.test/pdfturbo/index.html')).toBe(false);
    expect(r.match('https://app.test/pdfturbo/notpad.html')).toBe(false);
  });

  it('keeps pad.html out of the precache, so a deploy reaches the phone without the editor prompt', () => {
    expect(cfg).toMatch(/globIgnores:\s*\[[^\]]*'\*\*\/pad\.html'[^\]]*\]/);
  });

  it('exempts pad.html from the index.html navigation fallback (matched on pathname + search, as Workbox does)', () => {
    const list = /navigateFallbackDenylist:\s*\[([^\]]*)\]/.exec(cfg)?.[1];
    expect(list, 'no navigateFallbackDenylist').toBeDefined();
    const res = new Function(`return [${list}];`)() as RegExp[];
    const denied = (p: string) => res.some((re) => re.test(p));
    expect(denied('/pdfturbo/pad.html')).toBe(true);
    expect(denied('/pdfturbo/pad.html?x=1')).toBe(true);
    expect(denied('/pdfturbo/')).toBe(false);
    expect(denied('/pdfturbo/index.html')).toBe(false);
    expect(denied('/pdfturbo/notpad.html')).toBe(false);
    expect(denied('/pdfturbo/pad.htmlx')).toBe(false);
  });
});
