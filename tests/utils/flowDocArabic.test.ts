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
import { logicalToVisual } from '../../src/utils/bidi';

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
  it('keeps an embedded multi-char Latin run forward in a MIXED Arabic+Latin word', () => {
    // A single word mixing Arabic + a multi-char Latin run: the Latin must stay "ABC",
    // not "CBA" (the blanket reverse flips it). Build the visual form, expect logical back.
    const logical = 'اABC'; // alef + ABC
    const visual = logicalToVisual(logical, 'rtl');
    expect(reverseRtlText(visual)).toBe('اABC'.normalize('NFKC'));
  });

  // P2 (2026-06-17): pdf.js delivers Arabic from many PDFs as Unicode PRESENTATION
  // FORMS (isolated/initial/medial/final glyph codepoints, U+FB50–FDFF / U+FE70–FEFF).
  // Carried verbatim into DOCX/MD they render disconnected/garbled (Word re-shapes
  // base letters, not pre-shaped forms). NFKC maps each presentation form back to its
  // base letter so Word's own bidi+shaping lays it out correctly.
  it('NFKC-normalizes a presentation form to its base letter', () => {
    // U+FE8E ARABIC LETTER ALEF FINAL FORM → U+0627 ARABIC LETTER ALEF
    expect(reverseRtlText('ﺎ')).toBe('ا');
  });
  it('expands a presentation ligature to logical base order (length change)', () => {
    // U+FEFB LAM-ALEF ISOLATED FORM → U+0644 U+0627 (lam, alef) in logical order
    expect(reverseRtlText('ﻻ')).toBe('لا');
  });
  it('leaves no presentation-form codepoints in the output', () => {
    const visual = 'ﺎﺒﺭﻤ'; // mixed forms, pdf.js visual order
    expect(/[ﭐ-﷿ﹰ-﻿]/.test(reverseRtlText(visual))).toBe(false);
  });
});

describe('orderLineWords', () => {
  it('LTR line: ascending-x order, text untouched', () => {
    const r = orderLineWords([w('world', 100, false), w('hello', 40, false)]);
    expect(r.rtl).toBe(false);
    expect(r.words.map((x) => x.text)).toEqual(['hello', 'world']);
  });

  it('RTL line: rightmost word first, each word\'s text left as pdf.js gave it (limits row 19)', () => {
    // pdf.js returns an RTL item's text in LOGICAL order already (runBidiTransform, pdf.worker.mjs), so only the
    // item order changes. Visual page order: "def" at x=40, "abc" at x=200 → reading right to left: abc, def.
    // (Until row 19 this expected each word char-reversed — a shape pdf.js never emits; measured on a LibreOffice file.)
    const r = orderLineWords([w('def', 40), w('abc', 200)]);
    expect(r.rtl).toBe(true);
    expect(r.words.map((x) => x.text)).toEqual(['abc', 'def']);
  });

  it('a neutral item takes its strong neighbours\' direction when they agree, the line\'s when they differ', () => {
    // RTL line "النص (RTL) هنا" as LibreOffice draws it (x ascending): هنا ) RTL ( النص
    const r = orderLineWords([
      w('هنا', 56), w(')', 77, false), w('RTL', 82, false), w('(', 106, false), w('النص', 114),
    ]);
    expect(r.rtl).toBe(true); // 7 Arabic letters against 3 Latin — three items against two by count
    expect(r.words.map((x) => x.text)).toEqual(['النص', '(', 'RTL', ')', 'هنا']);
    expect(r.words.map((x) => x.rtl)).toEqual([true, true, false, true, true]);
  });

  it('LTR line: an Arabic phrase split across two items reads right to left inside it', () => {
    // "The phrase مرحبا بكم means" with the Arabic split by a bold word, x ascending: The phrase | بكم | مرحبا | means
    const r = orderLineWords([
      w('The phrase', 50, false), w('بكم', 120), w('مرحبا', 150), w('means', 200, false),
    ]);
    expect(r.rtl).toBe(false);
    expect(r.words.map((x) => x.text)).toEqual(['The phrase', 'مرحبا', 'بكم', 'means']);
  });

  it('majority decides direction (a stray LTR token in an rtl line)', () => {
    const r = orderLineWords([w('ten', 40, false), w('cba', 200), w('fed', 120)]);
    expect(r.rtl).toBe(true); // 2 of 3 rtl
  });

  it('a bracket pair mapped to its SHAPE (Chrome) is mirrored back to what was typed', () => {
    // Typed `فقرة (RTL)`. The brackets sit in the RTL run, so their glyphs are mirrored; Chrome's ToUnicode maps each to
    // its shape, x ascending: ( RTL ) فقرة. Read in order that is `فقرة)RTL(`, which closes before it opens.
    const r = orderLineWords([w('(', 10, false), w('RTL', 16, false), w(')', 40, false), w('فقرة', 60)]);
    expect(r.words.map((x) => x.text).join('')).toBe('فقرة(RTL)');
  });

  it('a bracket pair mapped to its LOGICAL character (LibreOffice) is left alone', () => {
    const r = orderLineWords([w(')', 10, false), w('RTL', 16, false), w('(', 40, false), w('فقرة', 60)]);
    expect(r.words.map((x) => x.text).join('')).toBe('فقرة(RTL)');
  });

  it('a number touching a Latin item belongs to it (W7): `v2.0.0` in an Arabic line', () => {
    // Typed `رقم v2.0.0 صدر`; Chrome draws `v` and `2.0.0` as two items. x ascending: صدر | v | 2.0.0 | رقم
    const r = orderLineWords([w('صدر', 10), w('v', 50, false), w('2.0.0', 56, false), w('رقم', 100)]);
    expect(r.words.map((x) => x.text)).toEqual(['رقم', 'v', '2.0.0', 'صدر']);
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

// A RawTextItem mimicking pdf.js output: dir 'rtl', str in LOGICAL order (pdf.js reverses the drawn chunk itself).
function rtlItem(str: string, x: number): RawTextItem {
  return { str, dir: 'rtl', transform: [12, 0, 0, 12, x, 700], width: str.length * 7, height: 12, fontName: 'f1', hasEOL: false };
}

describe('reconstructPage — RTL logical-order restoration (A1/A2)', () => {
  it('restores logical word order for an RTL line, leaving each item\'s text as pdf.js gave it', () => {
    // Visual page: "DEF" at x=40 (left), "ABC" at x=120 (right), both dir:'rtl' and already logical inside.
    // Reading right→left: "ABC" then "DEF".
    const page = reconstructPage([rtlItem('DEF', 40), rtlItem('ABC', 120)], {} as FontInfoMap, 600, 800);
    const text = page.paragraphs.flatMap((p) => p.runs).map((r) => r.text).join('');
    expect(text.replace(/\s+/g, ' ').trim()).toBe('ABC DEF');
    expect(page.paragraphs[0].rtl).toBe(true);
  });

  it('keeps the space between two Latin items inside an Arabic line (limits row 19)', () => {
    // x ascending: بالكامل | Microsoft | Word | يدعم البرنامج — the Arabic carries more letters, so the line is
    // right-to-left and reads يدعم البرنامج, Microsoft, Word, بالكامل. The gap between
    // Microsoft and Word advances RIGHTWARD on a right-to-left line; a direction-keyed gap lost that space.
    const ltr = (str: string, x: number): RawTextItem => ({ ...rtlItem(str, x), dir: 'ltr' });
    const page = reconstructPage(
      [rtlItem('بالكامل', 40), ltr('Microsoft', 110), ltr('Word', 180), rtlItem('يدعم البرنامج', 230)],
      {} as FontInfoMap, 600, 800,
    );
    const text = page.paragraphs.flatMap((p) => p.runs).map((r) => r.text).join('');
    expect(text.replace(/\s+/g, ' ').trim()).toBe('يدعم البرنامج Microsoft Word بالكامل');
  });

  it('no space inside a per-glyph Arabic word that meets a Latin suffix (`نظام.pdf`, limits row 19)', () => {
    // An English line; Chrome draws `نظام` one glyph per item, x ascending م ا ظ ن, with `.pdf` touching its right end:
    // `the file` | م ا ظ ن | `.pdf was`. In reading order the last Arabic glyph is م, the leftmost, so the gap from it
    // to `.pdf` spans the whole word; the two RUNS touch.
    const ltr = (str: string, x: number, width: number): RawTextItem => ({ ...rtlItem(str, x), dir: 'ltr', width });
    const glyph = (str: string, x: number): RawTextItem => ({ ...rtlItem(str, x), width: 6 });
    const page = reconstructPage(
      [ltr('the file', 40, 48), glyph('م', 92), glyph('ا', 98), glyph('ظ', 104), glyph('ن', 110),
        ltr('.pdf was', 116, 48)],
      {} as FontInfoMap, 600, 800,
    );
    const text = page.paragraphs.flatMap((p) => p.runs).map((r) => r.text).join('');
    expect(text.replace(/\s+/g, ' ').trim()).toBe('the file نظام.pdf was');
  });

  it('a near-even line of an Arabic paragraph reads right to left (limits row 19 tiebreak)', () => {
    // Two lines, one paragraph. The first is plainly Arabic; the second has 8 Latin letters against 7 Arabic, x
    // ascending: `ثم` | `hellos` | `xy` | `مرحبا`. Read by its own letters it is left to right and starts at `ثم`.
    const ltr = (str: string, x: number, y: number): RawTextItem => ({ ...rtlItem(str, x), dir: 'ltr', transform: [12, 0, 0, 12, x, y] });
    const at = (str: string, x: number, y: number): RawTextItem => ({ ...rtlItem(str, x), transform: [12, 0, 0, 12, x, y] });
    const page = reconstructPage(
      [at('هذا سطر عربي طويل جدا للتجربة', 100, 700),
        at('ثم', 100, 686), ltr('hellos', 130, 686), ltr('xy', 175, 686), at('مرحبا', 200, 686)],
      {} as FontInfoMap, 600, 800,
    );
    expect(page.paragraphs).toHaveLength(1);
    const text = page.paragraphs[0].runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
    expect(text).toBe('هذا سطر عربي طويل جدا للتجربة مرحبا hellos xy ثم');
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
