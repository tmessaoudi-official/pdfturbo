/**
 * reverseCidHex — pure CID-pair reversal for RTL Arabic overlay rendering (Phase C).
 *
 * pdf-lib font.encodeText shapes Arabic and emits 2-byte subset CIDs in LOGICAL
 * order; reversing the pairs yields visual right-to-left order while preserving
 * the (already-shaped) joined glyph forms. The full render path is browser-only
 * (font asset fetch) — see tests/browser/arabic-overlay.browser.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { reverseCidHex } from '../../src/export/arabicOverlay';

describe('reverseCidHex', () => {
  it('reverses 2-byte CID groups', () => {
    expect(reverseCidHex('000100020003')).toBe('000300020001');
  });
  it('strips angle-bracket wrapping from a PDFHexString', () => {
    expect(reverseCidHex('<000100020003000400050006>')).toBe('000600050004000300020001');
  });
  it('single CID is unchanged', () => {
    expect(reverseCidHex('00AB')).toBe('00AB');
  });
  it('empty → empty', () => {
    expect(reverseCidHex('')).toBe('');
  });
});
