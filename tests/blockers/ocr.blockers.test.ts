/**
 * OCR blockers — confirming tests. See ./README.md for the it.fails convention.
 * Source research: research-2026-06-15-blockers/raw/ocr-signing.md (removed from the repo — see ./README.md)
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
  // FIXED (decision: vendor all 8 rather than trim). This is now the drift guard:
  // if languages.ts and prepare-ocr-assets.mjs diverge, OCR silently breaks under
  // the app CSP (connect-src 'self'), so the test enforces advertised ⊆ vendored.
  it('every advertised OCR language has a vendored traineddata asset', () => {
    const vendored = new Set(vendoredLangs());
    const missing = OCR_LANGUAGES.filter((l) => !vendored.has(l.code)).map((l) => l.code);
    expect(missing).toEqual([]);
  });

  it('vendors exactly the advertised set (no orphan downloads)', () => {
    const vendored = [...vendoredLangs()].sort();
    const advertised = OCR_LANGUAGES.map((l) => l.code).sort();
    expect(advertised.length).toBe(8);
    expect(vendored).toEqual(advertised);
  });
});
