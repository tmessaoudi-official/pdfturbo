/**
 * Limits row 55 — a rotated margin stamp (the arXiv line up the left edge) was glued into the body line that shares its
 * baseline: "…24 May 2019be effective for…" (BERT p1), "…Dec 2015Deep convolutional…" (ResNet p1). pdf.js reports a
 * 90-degree item at its baseline origin with the advance as `width`, and line clustering is by baseline, so the stamp joined
 * whichever line it landed beside. A rotated item now leaves the line clustering and is a paragraph of its own.
 */
import { describe, it, expect } from 'vitest';
import { reconstructPage, type RawTextItem, type FontInfoMap } from '../../src/utils/flowDoc';

const FONTS: FontInfoMap = { f1: { name: 'Helvetica', family: 'sans-serif' } };
const text = (str: string, x: number, y: number): RawTextItem => ({
  str, dir: 'ltr', transform: [10, 0, 0, 10, x, y], width: str.length * 5, height: 10, fontName: 'f1', hasEOL: false,
});
// pdf.js's shape for text turned 90 degrees: the matrix is [0, s, -s, 0, x, y] and `width` stays the advance along the text.
const stamp = (str: string, x: number, y: number): RawTextItem => ({
  str, dir: 'ltr', transform: [0, 20, -20, 0, x, y], width: str.length * 10, height: 20, fontName: 'f1', hasEOL: false,
});
const paras = (items: RawTextItem[]) =>
  reconstructPage(items, FONTS, 612, 792).paragraphs.map(p => p.runs.map(r => r.text).join(''));

describe('a rotated margin stamp is its own paragraph (limits row 55)', () => {
  const body = [text('Language model pre-training has been shown to', 72, 255), text('be effective for improving many tasks', 72, 242), text('processing tasks (Dai and Le, 2015)', 72, 228)];

  it('does not join the body line that shares its baseline', () => {
    const out = paras([...body, stamp('arXiv:1810.04805v2 [cs.CL] 24 May 2019', 32, 242)]);
    const stampPara = out.find(t => t.includes('arXiv:'));
    expect(stampPara).toBe('arXiv:1810.04805v2 [cs.CL] 24 May 2019');
    expect(out.some(t => t.includes('be effective') && t.includes('arXiv'))).toBe(false);
    for (const k of ['Language model', 'be effective', 'processing tasks']) expect(out.join(' ')).toContain(k);
  });

  it('loses no word: every body line and the stamp survive exactly once', () => {
    const out = paras([...body, stamp('arXiv:1810.04805v2 [cs.CL] 24 May 2019', 32, 242)]).join(' ');
    for (const k of ['Language model pre-training', 'be effective for improving', 'processing tasks (Dai', 'arXiv:1810.04805v2']) {
      expect(out.split(k).length - 1).toBe(1);
    }
  });

  it('control: a slanted (italic) run is not rotated and stays in its line', () => {
    const italic: RawTextItem = { ...text('italic', 262, 242), transform: [10, 0, 3, 10, 262, 242] };
    const out = paras([...body, italic]);
    expect(out.some(t => t.includes('be effective') && t.includes('italic'))).toBe(true);
  });

  it('control: a page with no rotated item reads exactly as before', () => {
    expect(paras(body).join(' ')).toContain('Language model pre-training has been shown to be effective');
  });
});

describe('a page made only of rotated text (limits row 55)', () => {
  it('keeps every word exactly once', () => {
    const items = [0, 1, 2, 3, 4].map(i => stamp(`LINE-${i} turned text`, 100 + i * 24, 300));
    const out = paras(items).join(' ');
    for (let i = 0; i < 5; i++) expect(out.split(`LINE-${i} `).length - 1).toBe(1);
  });
});
