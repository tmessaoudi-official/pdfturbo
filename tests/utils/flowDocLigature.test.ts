/**
 * B7 — Latin ligature normalization for PDF→DOCX extraction.
 *
 * Many PDFs encode the Latin presentation-form ligatures (U+FB00–U+FB06: ﬀ ﬁ ﬂ
 * ﬃ ﬄ ﬅ ﬆ) as single glyphs. Emitted verbatim into DOCX they render as the
 * ligature glyph and break word-search ("file" won't match "ﬁle"). `foldLatinLigatures`
 * expands ONLY those codepoints to their ASCII letters — it is NOT blanket NFKC
 * (which would also fold CJK width forms, superscript digits, etc.), so any string
 * without an FB0x codepoint is returned byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { foldLatinLigatures, reconstructPage, type RawTextItem, type FontInfoMap } from '../../src/utils/flowDoc';

describe('foldLatinLigatures', () => {
  it('expands each Latin presentation-form ligature', () => {
    expect(foldLatinLigatures('ﬀ')).toBe('ff');
    expect(foldLatinLigatures('ﬁ')).toBe('fi');
    expect(foldLatinLigatures('ﬂ')).toBe('fl');
    expect(foldLatinLigatures('ﬃ')).toBe('ffi');
    expect(foldLatinLigatures('ﬄ')).toBe('ffl');
    expect(foldLatinLigatures('ﬅ')).toBe('st');
    expect(foldLatinLigatures('ﬆ')).toBe('st');
  });

  it('expands ligatures inside a word', () => {
    expect(foldLatinLigatures('ﬁle')).toBe('file');
    expect(foldLatinLigatures('eﬃcient')).toBe('efficient');
    expect(foldLatinLigatures('ﬂow')).toBe('flow');
  });

  it('returns plain ASCII unchanged (byte-identical when inactive)', () => {
    const s = 'The quick brown fox — 100% (n=3).';
    expect(foldLatinLigatures(s)).toBe(s);
  });

  it('leaves non-Latin (Arabic, CJK, width forms) untouched', () => {
    // Arabic carries no FB0x Latin ligature; CJK full-width must NOT be folded.
    expect(foldLatinLigatures('السلام')).toBe('السلام');
    expect(foldLatinLigatures('ＡＢ')).toBe('ＡＢ'); // fullwidth AB stays
  });

  it('wires into reconstructPage — a ligature item folds in the emitted run (B7 wire guard)', () => {
    const items: RawTextItem[] = [
      { str: 'ﬁle', transform: [12, 0, 0, 12, 72, 700], width: 24, height: 12, fontName: 'g_d0', dir: 'ltr' } as RawTextItem,
    ];
    const fonts: FontInfoMap = { g_d0: { name: 'Helvetica' } };
    const page = reconstructPage(items, fonts, 595, 842);
    const text = page.paragraphs.flatMap(p => p.runs.map(r => r.text)).join('');
    expect(text).toBe('file');
  });
});
