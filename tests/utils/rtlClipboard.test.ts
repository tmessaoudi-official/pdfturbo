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

  it('keeps a MULTI-char span in its native (logical) order — does not reverse within a span', () => {
    // pdf.js emits the trailing "لام" of "السلام" as ONE span whose chars are in native
    // (logical) order, at the visual LEFT; the remaining glyphs follow to the right as
    // single items. The old blanket reverseRtlText(visual) reversed within the span and
    // scrambled the word ("لسمال"). Reading order comes from span POSITION, never from
    // reversing a span's internal chars.
    const spans = [
      g('لام', 0, 24), // logical ل-ا-م, visual-leftmost (so logical-LAST)
      g('س', 26, 8),
      g('ل', 36, 8),
      g('ا', 46, 8),   // visual-rightmost (so logical-FIRST)
    ];
    expect(reconstructLogicalText(spans)).toBe('السلام');
  });

  it('keeps an embedded LTR token intact inside an RTL line (no internal reverse)', () => {
    // RTL line, visual L→R: "ب"@0, "PDF"@12, "ا"@40. Read right-to-left → "ا PDF ب".
    // The Latin token must stay "PDF", not "FDP" (the old blanket reverse flipped it).
    const spans = [g('ب', 0, 8), g('PDF', 12, 24), g('ا', 40, 8)];
    expect(reconstructLogicalText(spans)).toBe('ا PDF ب');
  });

  it('reverses an embedded NUMBER+percent run (no Latin letter) to logical order', () => {
    // Real-PDF case (arabic-allcases.pdf): an embedded number run is laid in RTL visual
    // order — "%" sits LEFT of "100". Logical reading is "100%". A run with NO strong-LTR
    // letter must flow with the RTL line (reverse), unlike a Latin-letter run (kept forward).
    const spans = [
      g('ا', 0), g('ل', 10), g('%', 40, 8), g('100', 50, 18), g('بنسبة', 76, 30),
    ];
    expect(reconstructLogicalText(spans)).toContain('100%');
  });

  it('keeps an embedded PER-GLYPH LTR run forward in an RTL line', () => {
    // pdf.js often emits Latin per-glyph too: visual L→R "M a i n" then Arabic "ا ب ح ر م".
    // Logical reading: "مرحبا Main" — "Main" forward, NOT "niaM" (the blanket span-reverse bug).
    const spans = [
      g('M', 0), g('a', 10), g('i', 20), g('n', 30),
      g('ا', 60), g('ب', 70), g('ح', 80), g('ر', 90), g('م', 100),
    ];
    expect(reconstructLogicalText(spans)).toBe('مرحبا Main');
  });
});
