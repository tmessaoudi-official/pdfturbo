/**
 * #6 — reconstructLogicalText turns pdf.js's per-glyph, visual-order,
 * presentation-form, space-less text-layer spans (what a copy selects on an Arabic
 * page) back into logical, spaced, base-letter text. Synthetic glyph geometry so
 * the cases are explicit and content-controlled.
 */
import { describe, it, expect } from 'vitest';
import { reconstructLogicalText, type SpanGeom } from '../../src/utils/rtlClipboard';

// helper: a glyph cell at (left,top) with width w on a 20px row.
const g = (text: string, left: number, w = 8, top = 0): SpanGeom => ({ text, left, right: left + w, top, height: 20 });

describe('reconstructLogicalText (#6 Arabic copy)', () => {
  it('reverses a pure-Arabic visual row to logical order', () => {
    // logical "مرحبا" is laid out visually (L→R) as its codepoint-reverse: ا ب ح ر م
    const visual = [...'ابحرم'];
    const spans = visual.map((ch, i) => g(ch, i * 10)); // gap 2px < space threshold
    expect(reconstructLogicalText(spans)).toBe('مرحبا');
  });

  it('folds presentation forms to base letters (NFKC)', () => {
    // U+FEE3 ARABIC LETTER MEEM INITIAL FORM → base ARABIC LETTER MEEM (U+0645)
    expect(reconstructLogicalText([g('ﻣ', 0)])).toBe('م');
  });

  it('infers a space from a wide x-gap and keeps it after reversal', () => {
    // visual "ب" [gap] "ا"  →  logical "ا ب"
    const spans = [g('ب', 0, 8), g('ا', 40, 8)];
    expect(reconstructLogicalText(spans)).toBe('ا ب');
  });

  it('leaves an LTR row as-is (NFKC only, no reversal)', () => {
    const spans = [g('H', 0, 8), g('i', 9, 6)];
    expect(reconstructLogicalText(spans)).toBe('Hi');
  });

  it('joins multiple rows top-to-bottom with newlines', () => {
    const row1 = [...'با'].map((ch, i) => g(ch, i * 10, 8, 0)); // visual "با" → logical "اب"
    const row2 = [g('X', 0, 8, 40)];
    expect(reconstructLogicalText([...row2, ...row1])).toBe('اب\nX');
  });

  it('returns empty string for no spans', () => {
    expect(reconstructLogicalText([])).toBe('');
  });
});
