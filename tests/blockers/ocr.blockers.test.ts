/**
 * OCR blockers — confirming tests. See ./README.md for the it.fails convention.
 * Source research: docs/reviews/research-2026-06-15-blockers/raw/ocr-signing.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OCR_LANGUAGES } from '../../src/ocr/languages';

/** Parse the `const LANGS = [...]` array the asset-vendor script actually downloads. */
function vendoredLangs(): string[] {
  const src = readFileSync(
    resolve(__dirname, '../../scripts/prepare-ocr-assets.mjs'),
    'utf8',
  );
  const m = src.match(/const\s+LANGS\s*=\s*\[([^\]]*)\]/);
  if (!m) throw new Error('LANGS array not found in prepare-ocr-assets.mjs');
  return [...m[1].matchAll(/'([a-z]{3})'/g)].map((x) => x[1]);
}

describe('OCR blocker O1 — advertised languages must all be vendored', () => {
  // REACHABLE. The UI advertises 8 OCR languages (languages.ts) but the asset
  // vendor downloads only eng/fra/ara. Under the app CSP (connect-src 'self')
  // choosing deu/spa/ita/por/nld fetches a non-existent same-origin traineddata
  // → the engine throws. So 5 of 8 "supported" languages are broken at runtime.
  it.fails('every advertised OCR language has a vendored traineddata asset', () => {
    const vendored = new Set(vendoredLangs());
    const missing = OCR_LANGUAGES.filter((l) => !vendored.has(l.code)).map((l) => l.code);
    // DESIRED: nothing advertised is missing its asset. TODAY: deu/spa/ita/por/nld missing.
    expect(missing).toEqual([]);
  });

  it('documents the current advertised-vs-vendored gap (pin)', () => {
    const vendored = new Set(vendoredLangs());
    const advertised = OCR_LANGUAGES.map((l) => l.code);
    expect(advertised.length).toBe(8);
    expect([...vendored].sort()).toEqual(['ara', 'eng', 'fra']);
  });
});
