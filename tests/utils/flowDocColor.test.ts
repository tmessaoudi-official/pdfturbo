/**
 * Batch-3 (a) — spot-color / Separation "black collapse" root cause.
 *
 * pdf.js v6's `PartialEvaluator.getOperatorList` pre-resolves EVERY fill color
 * space (RGB / Gray / CMYK / Separation / spot / ICC) and re-emits a single
 * `setFillRGBColor` op whose arg is a `"#rrggbb"` STRING (getRgbHex →
 * Util.makeHexColor), NOT an `[r,g,b]` float triple. The old export op-walk
 * destructured `[fillR,fillG,fillB] = args`, so `fillR` became the whole
 * "#rrggbb" string and `fillG`/`fillB` were undefined — every colored run
 * collapsed to garbage/black in the DOCX. `fillOpToHex` is the root-cause fix:
 * it normalizes the v6 hex-string shape (and the legacy float-triple shape, for
 * resilience) to an uppercase 6-hex string with no leading '#'.
 */
import { describe, it, expect } from 'vitest';
import { fillOpToHex } from '../../src/utils/flowDoc';

describe('fillOpToHex — pdf.js v6 color-arg normalization', () => {
  it('parses the v6 "#rrggbb" hex-string arg (the bug)', () => {
    expect(fillOpToHex('rgb', ['#ff0000'])).toBe('FF0000');
    expect(fillOpToHex('rgb', ['#1A2B3C'])).toBe('1A2B3C');
  });

  it('parses a v6 spot/Separation color (already resolved to hex by pdf.js)', () => {
    // A Pantone-ish spot resolves through getRgbHex to a concrete RGB hex —
    // proves spot colors no longer collapse to black.
    expect(fillOpToHex('rgb', ['#e94f37'])).toBe('E94F37');
  });

  it('expands a 3-digit hex shorthand', () => {
    expect(fillOpToHex('rgb', ['#f00'])).toBe('FF0000');
  });

  it('still handles a legacy float-triple RGB arg (resilience)', () => {
    expect(fillOpToHex('rgb', [1, 0, 0])).toBe('FF0000');
    expect(fillOpToHex('rgb', [0, 0.5019607843, 0])).toBe('008000');
  });

  it('handles gray (float) → grey hex', () => {
    expect(fillOpToHex('gray', [0])).toBe('000000');
    expect(fillOpToHex('gray', [1])).toBe('FFFFFF');
    expect(fillOpToHex('gray', [0.5019607843])).toBe('808080');
  });

  it('handles cmyk float → rgb hex (pure cyan)', () => {
    expect(fillOpToHex('cmyk', [1, 0, 0, 0])).toBe('00FFFF');
  });

  it('returns null for an unresolvable / pattern fill (no crash)', () => {
    expect(fillOpToHex('rgb', [])).toBeNull();
    expect(fillOpToHex('rgb', [{}])).toBeNull();
    expect(fillOpToHex('rgb', ['not-a-color'])).toBeNull();
  });
});
