/**
 * True-edit engine blockers — confirming tests. See ./README.md for the convention.
 * Source research: research-2026-06-15-blockers/raw/trueedit.md (removed from the repo — see ./README.md)
 *
 * B-1 (exponent tokenizer) and B-3 (non-WinAnsi refusal) are now FIXED — these
 * assert the corrected behavior.
 */
import { describe, it, expect } from 'vitest';
import { tokenizeContentStream, serializeTokens, hasNonWinAnsi } from '../../src/utils/contentStreamEditor';

describe('True-edit B-1 — number tokenizer preserves exponent notation (FIXED)', () => {
  it('parses `1e-3` as the value 0.001, not `1` + a bogus operator', () => {
    const tokens = tokenizeContentStream('1e-3');
    const numbers = tokens.filter((t) => t.type === 'number');
    expect(numbers).toHaveLength(1);
    expect(numbers[0]?.value).toBeCloseTo(0.001);
    expect(tokens.filter((t) => t.type === 'operator')).toHaveLength(0);
  });

  it('round-trips `1e-3 0 0 1 0 0 Tm` without inserting a stray operator', () => {
    const round = serializeTokens(tokenizeContentStream('1e-3 0 0 1 0 0 Tm'));
    expect(round.replace(/\s+/g, ' ').trim()).toBe('1e-3 0 0 1 0 0 Tm');
  });

  it('handles uppercase E and positive exponent', () => {
    const t = tokenizeContentStream('2.5E+2');
    const nums = t.filter((x) => x.type === 'number');
    expect(nums).toHaveLength(1);
    expect(nums[0]?.value).toBeCloseTo(250);
  });

  it('does NOT swallow a real `e`-led operator when no valid exponent follows', () => {
    // `1 et` → number 1, then operator-ish `et` (e not followed by digits/sign+digit)
    const t = tokenizeContentStream('1 et');
    expect(t.filter((x) => x.type === 'number')).toHaveLength(1);
    expect(t.some((x) => x.type === 'operator' && x.raw === 'et')).toBe(true);
  });
});

describe('True-edit B-3 — non-WinAnsi text refuses standard-font redraw', () => {
  it('flags CJK, Cyrillic, and emoji as non-WinAnsi (→ overlay)', () => {
    expect(hasNonWinAnsi('日本語')).toBe(true);
    expect(hasNonWinAnsi('Привет')).toBe(true);
    expect(hasNonWinAnsi('hi 😀')).toBe(true);
  });

  it('accepts ASCII, Latin-1 accents, and CP1252 high specials', () => {
    expect(hasNonWinAnsi('Hello, world!')).toBe(false);
    expect(hasNonWinAnsi('café déjà-vu Ñ ümlaut')).toBe(false);
    expect(hasNonWinAnsi('“quote” — € ™ œ')).toBe(false); // all WinAnsi-encodable
  });
});
