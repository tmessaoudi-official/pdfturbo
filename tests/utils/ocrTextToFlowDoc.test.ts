/**
 * ocrTextToFlowDoc — pure OCR-text → FlowDoc transform feeding the "OCR → Word"
 * export. One non-blank line per body paragraph; Arabic lines right-aligned.
 */
import { describe, it, expect } from 'vitest';
import { ocrTextToFlowDoc } from '../../src/utils/flowDoc';

function must<T>(v: T | undefined, what = 'value'): T {
  if (v === undefined) throw new Error(`expected ${what} to be defined`);
  return v;
}

describe('ocrTextToFlowDoc', () => {
  it('makes one body paragraph per non-blank line, skipping blanks', () => {
    const doc = ocrTextToFlowDoc('Hello world\n\n  \nSecond line\n');
    expect(doc.pages).toHaveLength(1);
    const paras = must(doc.pages[0], 'page').paragraphs;
    expect(paras.map(p => must(p.runs[0], 'run').text)).toEqual(['Hello world', 'Second line']);
    expect(paras.every(p => p.heading === 0)).toBe(true);
  });

  it('right-aligns + flags RTL for an Arabic line, left for Latin', () => {
    const doc = ocrTextToFlowDoc('Bonjour\nمرحبا بالعالم');
    const paras = must(doc.pages[0], 'page').paragraphs;
    const latin = must(paras[0], 'latin');
    const arabic = must(paras[1], 'arabic');
    expect(latin.rtl).toBe(false);
    expect(latin.alignment).toBe('left');
    expect(arabic.rtl).toBe(true);
    expect(arabic.alignment).toBe('right');
  });

  it('returns an empty paragraph list for blank/whitespace text (caller warns, no empty file)', () => {
    expect(must(ocrTextToFlowDoc('   \n\n\t ').pages[0], 'page').paragraphs).toHaveLength(0);
    expect(must(ocrTextToFlowDoc('').pages[0], 'page').paragraphs).toHaveLength(0);
  });

  it('uses a valid Letter-point page box and well-formed runs', () => {
    const page = must(ocrTextToFlowDoc('x').pages[0], 'page');
    expect(page.width).toBe(612);
    expect(page.height).toBe(792);
    const run = must(must(page.paragraphs[0], 'para').runs[0], 'run');
    expect(run).toMatchObject({ text: 'x', bold: false, italic: false, fontSize: 11, fontFamily: 'serif' });
  });
});
