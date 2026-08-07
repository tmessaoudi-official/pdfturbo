/**
 * Guard for the `@cantoo/pdf-lib` ≥2.8.1 / `@pdf-lib/fontkit` v1 incompatibility.
 *
 * pdf-lib 2.8.1 feature-detects `typeof subset.encode === 'function'` and, if present, calls
 * `subset.encode()` with no arguments. fontkit v1's subset has an `encode` — restructure's
 * `Struct.encode(stream)` — so the call dereferences `undefined` and every custom-font embed dies with
 * `Cannot read properties of undefined (reading 'pos')`. Measured: 2.8.0 green, 2.8.1 red, 13 tests
 * across 6 files, all of them font embeds.
 *
 * These are pure: they assert the DISCRIMINATOR (arity) and the wrapper's behaviour, with a fake subset
 * shaped like each fontkit generation. The real embed is covered by the browser suites that regressed
 * (`arabic-overlay`, `searchable-ocr`, `trueedit-literal-subset`, `cyrillic-docx`, …).
 */
import { describe, it, expect, vi } from 'vitest';
import { adaptFontkit, adaptSubset, hasIncompatibleEncode } from '../../src/utils/fontkitAdapter';

/** fontkit v1: `encode(stream)` takes an argument and throws when called bare. */
function v1Subset() {
  return {
    encode(stream: unknown) {
      if (!stream) throw new TypeError("Cannot read properties of undefined (reading 'pos')");
      return 'wrote-to-stream';
    },
    encodeStream: () => 'stream',
    includeGlyph: (g: unknown) => g,
    cff: undefined,
  };
}

/** fontkit v2: `encode()` is the argument-less sync encoder pdf-lib is looking for. */
function v2Subset() {
  return { encode: () => new Uint8Array([1, 2, 3]), includeGlyph: (g: unknown) => g };
}

describe('hasIncompatibleEncode — arity is the discriminator, not presence', () => {
  it('flags fontkit v1 (encode takes a stream)', () => {
    expect(hasIncompatibleEncode(v1Subset())).toBe(true);
  });

  it('does NOT flag fontkit v2 (argument-less sync encode)', () => {
    // If this ever regresses to keying on presence, the adapter would hide the CORRECT encode and
    // force a non-existent encodeStream — breaking a future fontkit upgrade instead of fixing v1.
    expect(hasIncompatibleEncode(v2Subset())).toBe(false);
  });

  it('does not flag a subset with no encode at all', () => {
    expect(hasIncompatibleEncode({ encodeStream: () => 's' })).toBe(false);
  });
});

describe('adaptSubset', () => {
  it('hides the incompatible encode so pdf-lib takes the encodeStream path', () => {
    const s = adaptSubset(v1Subset());
    // This is the exact check pdf-lib 2.8.1 performs.
    expect(typeof s.encode === 'function').toBe(false);
    expect('encode' in s).toBe(false);
    expect(typeof s.encodeStream === 'function').toBe(true);
  });

  it('leaves everything else reachable and bound to the real subset', () => {
    const s = adaptSubset(v1Subset());
    expect(s.encodeStream?.()).toBe('stream');
    expect(s.includeGlyph?.('g')).toBe('g');
  });

  it('returns a v2 subset UNTOUCHED (same object, encode intact)', () => {
    const raw = v2Subset();
    const s = adaptSubset(raw);
    expect(s).toBe(raw);
    expect(typeof s.encode === 'function').toBe(true);
  });
});

describe('adaptFontkit', () => {
  it('adapts every subset the wrapped module produces', () => {
    const fontkit = { create: () => ({ createSubset: v1Subset, unitsPerEm: 1000 }) };
    const font = adaptFontkit(fontkit).create();
    const subset = (font.createSubset as () => Record<string, unknown>)();
    expect(typeof subset.encode === 'function').toBe(false);
    expect(font.unitsPerEm).toBe(1000);            // other members pass through
  });

  it('passes create() arguments through and preserves other module members', () => {
    const create = vi.fn(() => ({ createSubset: v1Subset }));
    const bytes = new Uint8Array([0]);
    const wrapped = adaptFontkit({ create, version: '1.1.1' } as never);
    (wrapped as { create: (b: Uint8Array, n?: string) => unknown }).create(bytes, 'PS');
    expect(create).toHaveBeenCalledWith(bytes, 'PS');
    expect((wrapped as { version: string }).version).toBe('1.1.1');
  });

  it('is inert for a font with no createSubset (non-subset embed path)', () => {
    const font = { unitsPerEm: 2048 };
    const wrapped = adaptFontkit({ create: () => font });
    expect(wrapped.create()).toBe(font);
  });
});
