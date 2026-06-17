/**
 * #4 (2026-06-17) — overlay text the user TYPES in-app (TextElements) must flow
 * into DOCX/MD export. Before this, `_extractFlowDoc` read only SOURCE-PDF text,
 * so typed text (Arabic or otherwise) was silently dropped — a blank page + typed
 * Arabic produced an EMPTY export. `textElementsToFlowParagraphs` is the pure map
 * from typed elements → flow paragraphs (logical `el.text`, so Word lays Arabic
 * out correctly via its own bidi — no reverseRtlText, which is only for pdf.js
 * visual-order source text).
 */
import { describe, it, expect } from 'vitest';
import { textElementsToFlowParagraphs, type FlowDoc } from '../../src/utils/flowDoc';
import { flowDocToDocxBase64 } from '../../src/utils/flowDocWriters';
import { unzipSync, strFromU8 } from 'fflate';

describe('textElementsToFlowParagraphs (pure)', () => {
  it('maps Latin text → LTR paragraph, left-aligned, body', () => {
    const p = textElementsToFlowParagraphs([
      { text: 'Hello world', x: 10, y: 100, fontSize: 14, color: '#000000', fontFamily: 'Arial' },
    ]);
    expect(p).toHaveLength(1);
    expect(p[0].runs[0].text).toBe('Hello world');
    expect(p[0].rtl).toBe(false);
    expect(p[0].alignment).toBe('left');
    expect(p[0].heading).toBe(0);
    expect(p[0].runs[0].fontSize).toBe(14);
  });

  it('maps Arabic text → RTL paragraph, right-aligned, LOGICAL text (not reversed/shaped)', () => {
    const S = 'مرحبا بالعالم';
    const p = textElementsToFlowParagraphs([{ text: S, x: 10, y: 40, fontSize: 20 }]);
    expect(p).toHaveLength(1);
    expect(p[0].runs[0].text).toBe(S); // unchanged: el.text is already logical
    expect(p[0].rtl).toBe(true);
    expect(p[0].runs[0].rtl).toBe(true);
    expect(p[0].alignment).toBe('right');
  });

  it('sorts elements top-to-bottom by y', () => {
    const p = textElementsToFlowParagraphs([
      { text: 'second', x: 0, y: 200, fontSize: 12 },
      { text: 'first', x: 0, y: 50, fontSize: 12 },
    ]);
    expect(p.map((x) => x.runs[0].text)).toEqual(['first', 'second']);
  });

  it('splits multiline text on \\n into separate paragraphs', () => {
    const p = textElementsToFlowParagraphs([{ text: 'line1\nline2', x: 0, y: 0, fontSize: 12 }]);
    expect(p.map((x) => x.runs[0].text)).toEqual(['line1', 'line2']);
  });

  it('skips empty / whitespace-only elements', () => {
    expect(textElementsToFlowParagraphs([{ text: '   ', x: 0, y: 0, fontSize: 12 }])).toHaveLength(0);
    expect(textElementsToFlowParagraphs([{ text: '', x: 0, y: 0, fontSize: 12 }])).toHaveLength(0);
  });

  it('color: non-black → hex without #, black → undefined (default)', () => {
    const red = textElementsToFlowParagraphs([{ text: 'x', x: 0, y: 0, fontSize: 12, color: '#Ff0000' }]);
    expect(red[0].runs[0].color).toBe('FF0000');
    const black = textElementsToFlowParagraphs([{ text: 'x', x: 0, y: 0, fontSize: 12, color: '#000000' }]);
    expect(black[0].runs[0].color).toBeUndefined();
  });

  it('maps fontFamily → generic category', () => {
    const fam = (f: string) =>
      textElementsToFlowParagraphs([{ text: 'x', x: 0, y: 0, fontSize: 12, fontFamily: f }])[0].runs[0].fontFamily;
    expect(fam('Times New Roman')).toBe('serif');
    expect(fam('Courier New')).toBe('monospace');
    expect(fam('Arial')).toBe('sans-serif');
    expect(fam('Verdana')).toBe('sans-serif');
  });
});

describe('typed overlay text → DOCX (writer e2e, jsdom)', () => {
  it('emits typed Arabic as logical text in a right-to-left run', async () => {
    const S = 'مرحبا بالعالم';
    const paras = textElementsToFlowParagraphs([{ text: S, x: 40, y: 50, fontSize: 24 }]);
    const flowDoc: FlowDoc = { pages: [{ width: 600, height: 400, paragraphs: paras }] };
    const b64 = await flowDocToDocxBase64(flowDoc);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain(S); // logical Arabic present verbatim
    expect(/<w:rtl\b/.test(xml)).toBe(true); // run marked RTL → Word lays it out correctly
    expect(/[ﭐ-﷿ﹰ-﻿]/.test(xml)).toBe(false); // no presentation forms leaked
  });
});
