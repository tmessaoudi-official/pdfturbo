/**
 * M3 #31 — the OCR traineddata download is the only unguarded remote-asset
 * ingress (worker + wasm core come from node_modules). These tests pin its
 * integrity: every advertised language has a committed SHA-256, and the
 * verifier rejects any buffer whose digest doesn't match the pin.
 *
 * Imports the asset-vendor script directly — its `main()` is guarded behind an
 * is-main check, so importing does NOT trigger any network download.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — plain .mjs script, no type declarations
import { TESSDATA_SHA256, LANGS, sha256Hex, verifyTraineddata } from '../../scripts/prepare-ocr-assets.mjs';
import { OCR_LANGUAGES } from '../../src/ocr/languages';

const HEX64 = /^[0-9a-f]{64}$/;

describe('M3 #31 — OCR traineddata SHA-256 pinning', () => {
  it('pins a 64-hex SHA-256 for every language the script downloads (LANGS)', () => {
    for (const lang of LANGS as string[]) {
      expect(TESSDATA_SHA256[lang], `missing pin for ${lang}`).toMatch(HEX64);
    }
  });

  it('pins every advertised OCR language (advertised ⊆ pinned)', () => {
    const missing = OCR_LANGUAGES.filter((l) => !TESSDATA_SHA256[l.code]).map((l) => l.code);
    expect(missing).toEqual([]);
  });

  it('sha256Hex matches the known NIST vector for "abc"', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('verifyTraineddata throws on a digest mismatch', () => {
    expect(() => verifyTraineddata('eng', Buffer.from('tampered'))).toThrow(/SHA-256 mismatch/);
  });

  it('verifyTraineddata throws for an unpinned language', () => {
    expect(() => verifyTraineddata('zzz', Buffer.from('x'))).toThrow(/no pinned SHA-256/);
  });

  it('the real vendored ara.traineddata.gz passes verification against its pin', () => {
    const ara = resolve(__dirname, '../../public/tesseract/lang/ara.traineddata.gz');
    // Vendored assets are gitignored; only assert when present (always true in CI after ocr:assets).
    if (!existsSync(ara)) return;
    expect(() => verifyTraineddata('ara', readFileSync(ara))).not.toThrow();
  });
});
