/**
 * Arabic DOCX-export logical-order restoration (Phase A1/A2).
 *
 * pdf.js getTextContent returns Arabic in VISUAL order with each item's string
 * already bidi-reversed, tagged dir:'rtl'. Word re-applies the Unicode Bidi
 * Algorithm to LOGICAL text (because we emit w:rtl), so passing the visual string
 * through verbatim double-reverses it. These helpers restore logical order:
 * reverse each rtl run's characters AND order an rtl line's words right-to-left.
 */
import { describe, it, expect } from 'vitest';
import { reverseRtlText, orderLineWords, isArabicText, reconstructPage, type RawTextItem, type FontInfoMap } from '../../src/utils/flowDoc';
import { flowDocToDocxBase64 } from '../../src/utils/flowDocWriters';

type W = { text: string; x: number; y: number; width: number; size: number; fontName: string; rtl: boolean };
const w = (text: string, x: number, rtl = true): W =>
  ({ text, x, y: 100, width: 40, size: 12, fontName: 'f', rtl });

describe('reverseRtlText', () => {
  it('reverses codepoints (restores logical order from pdf.js visual)', () => {
    expect(reverseRtlText('cba')).toBe('abc');
  });
  it('is codepoint-aware (surrogate pairs not split)', () => {
    // '😀A' → reversed 'A😀', the emoji stays one codepoint.
    expect(reverseRtlText('A\u{1F600}')).toBe('\u{1F600}A');
  });
  it('empty string → empty', () => {
    expect(reverseRtlText('')).toBe('');
  });
});

describe('orderLineWords', () => {
  it('LTR line: ascending-x order, text untouched', () => {
    const r = orderLineWords([w('world', 100, false), w('hello', 40, false)]);
    expect(r.rtl).toBe(false);
    expect(r.words.map((x) => x.text)).toEqual(['hello', 'world']);
  });

  it('RTL line: rightmost word first (logical) + each word char-reversed', () => {
    // Visual page order: left word x=40 str "fed", right word x=200 str "cba".
    // Logical reading: right-to-left → "abc" then "def".
    const r = orderLineWords([w('fed', 40), w('cba', 200)]);
    expect(r.rtl).toBe(true);
    expect(r.words.map((x) => x.text)).toEqual(['abc', 'def']);
  });

  it('majority decides direction (a stray LTR token in an rtl line)', () => {
    const r = orderLineWords([w('ten', 40, false), w('cba', 200), w('fed', 120)]);
    expect(r.rtl).toBe(true); // 2 of 3 rtl
  });

  it('does not mutate the input words', () => {
    const input = [w('cba', 200), w('fed', 40)];
    const before = input.map((x) => x.text);
    orderLineWords(input);
    expect(input.map((x) => x.text)).toEqual(before);
  });
});

describe('isArabicText', () => {
  it('detects Arabic-block codepoints', () => {
    expect(isArabicText('مرحبا')).toBe(true);
  });
  it('detects Arabic Presentation Forms', () => {
    expect(isArabicText('ﭐﻼ')).toBe(true);
  });
  it('false for pure Latin / digits / empty', () => {
    expect(isArabicText('Hello 123')).toBe(false);
    expect(isArabicText('')).toBe(false);
  });
  it('true for mixed Latin + Arabic', () => {
    expect(isArabicText('PDF ملف')).toBe(true);
  });
});

// A RawTextItem mimicking pdf.js output: dir 'rtl', str already visually reversed.
function rtlItem(str: string, x: number): RawTextItem {
  return { str, dir: 'rtl', transform: [12, 0, 0, 12, x, 700], width: str.length * 7, height: 12, fontName: 'f1', hasEOL: false };
}

describe('reconstructPage — RTL logical-order restoration (A1/A2)', () => {
  it('restores logical word + char order for an RTL line', () => {
    // Visual page: "FED" at x=40 (left), "CBA" at x=120 (right); both dir:'rtl'
    // (pdf.js visual-reversed of logical "DEF" and "ABC"). Reading right→left:
    // logical order is "ABC" then "DEF".
    const page = reconstructPage([rtlItem('FED', 40), rtlItem('CBA', 120)], {} as FontInfoMap, 600, 800);
    const text = page.paragraphs.flatMap((p) => p.runs).map((r) => r.text).join('');
    expect(text.replace(/\s+/g, ' ').trim()).toBe('ABC DEF');
    expect(page.paragraphs[0].rtl).toBe(true);
  });

  it('emits w:rtl and a complex-script (cs) Arabic font in the DOCX (A3)', async () => {
    const page = reconstructPage([rtlItem('CBA', 120), rtlItem('FED', 40)], {} as FontInfoMap, 600, 800);
    const b64 = await flowDocToDocxBase64({ pages: [page] });
    const { unzipSync, strFromU8 } = await import('fflate');
    const xml = strFromU8(unzipSync(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))['word/document.xml']);
    expect(xml).toContain('<w:rtl');
    expect(xml).toMatch(/w:cs="Arial"/);
  });
});
