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

describe('rotated items group by their own vertical line (limits row 55 review)', () => {
  // pdf.js's shape for text turned 90 degrees CCW (reads UP): matrix [0, s, -s, 0, x, y]; a line of text is a column of items at one x.
  const up = (str: string, x: number, y: number, width: number): RawTextItem => ({
    str, dir: 'ltr', transform: [0, 10, -10, 0, x, y], width, height: 10, fontName: 'f1', hasEOL: false,
  });

  it('a stamp and an axis label that share a baseline but not a line stay two paragraphs', () => {
    const body = [text('Language model pre-training has been shown to', 72, 255), text('be effective for improving many tasks', 72, 242)];
    const out = paras([...body, stamp('arXiv:1810.04805v2 [cs.CL] 24 May 2019', 32, 242), up('error (%)', 500, 242, 45)]);
    expect(out).toContain('arXiv:1810.04805v2 [cs.CL] 24 May 2019');
    expect(out).toContain('error (%)');
  });

  it('the words of one rotated line read in order with their spaces (a figure label, reading up)', () => {
    const words = ['alpha', 'beta', 'gamma', 'delta'].map((w, i) => up(w, 100, 300 + i * 40, 30));
    const body = [text('Language model pre-training has been shown to', 72, 600), text('be effective for improving many tasks', 72, 588)];
    expect(paras([...body, ...words])).toContain('alpha beta gamma delta');
  });

  it('text turned the other way (reading DOWN the page) also reads in order', () => {
    const down = (str: string, x: number, y: number, width: number): RawTextItem => ({
      str, dir: 'ltr', transform: [0, -10, 10, 0, x, y], width, height: 10, fontName: 'f1', hasEOL: false,
    });
    const words = ['alpha', 'beta', 'gamma', 'delta'].map((w, i) => down(w, 100, 420 - i * 40, 30));
    const body = [text('Language model pre-training has been shown to', 72, 600), text('be effective for improving many tasks', 72, 588)];
    expect(paras([...body, ...words])).toContain('alpha beta gamma delta');
  });

  it('a page made only of rotated text: every line keeps its text and nothing is glued across lines', () => {
    // Five lines at normal leading read as ONE paragraph, as upright lines would — the check is that the words between lines
    // keep their space ("text LINE-1", never "textLINE-1") and every line is whole.
    const items = [0, 1, 2, 3, 4].map(i => stamp(`LINE-${i} turned text`, 100 + i * 24, 300));
    const joined = paras(items).join(' ');
    for (let i = 0; i < 5; i++) expect(joined.split(`LINE-${i} turned text`).length - 1).toBe(1);
    expect(joined).not.toMatch(/textLINE/);
  });

  it('a BERT page-1 shape: the stamp no longer blocks the two columns beneath a centred title', () => {
    const lines = (x: number, tag: string) => Array.from({ length: 24 }, (_, i) => text(`${tag}-${String(i).padStart(2, '0')} ${'word '.repeat(8)}`.trimEnd(), x, 640 - i * 12));
    const items = [text('A Centred Title For The Paper', 180, 750), ...lines(72, 'L'), ...lines(310, 'R'), stamp('arXiv:1810.04805v2 [cs.CL] 24 May 2019', 32, 400)];
    const out = paras(items);
    const lastL = out.map(t => t.includes('L-')).lastIndexOf(true), firstR = out.findIndex(t => t.includes('R-'));
    expect(lastL).toBeGreaterThanOrEqual(0);
    expect(firstR).toBeGreaterThan(lastL);
    expect(out.some(t => t.includes('L-') && t.includes('R-'))).toBe(false);
  });
});
