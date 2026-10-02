/**
 * Limits row 55 — a rotated margin stamp (the arXiv line up the left edge) was glued into the body line that shares its
 * baseline: "…24 May 2019be effective for…" (BERT p1), "…Dec 2015Deep convolutional…" (ResNet p1). pdf.js reports a
 * 90-degree item at its baseline origin with the advance as `width`, and line clustering is by baseline, so the stamp joined
 * whichever line it landed beside. A rotated item now leaves the line clustering and is a paragraph of its own.
 */
import { describe, it, expect } from 'vitest';
import { reconstructPage, applyRepeatedBands, assignHeadings, type RawTextItem, type FontInfoMap, type FlowDoc } from '../../src/utils/flowDoc';

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

describe('a rotated paragraph carries a PAGE y: the middle of its extent (milestone rounds 2-3)', () => {
  // A rotated paragraph kept the turned frame's y (-x going up, +x going down), which the running-header/footer step read as a
  // page position. Round 2 put the highest baseline there — an END of the run, so a margin banner that starts at the bottom edge
  // was still "in the footer band" (round 3). The middle of the extent is where the text is on the page.
  const down = (str: string, x: number, y: number): RawTextItem => ({ ...stamp(str, x, y), transform: [0, -20, 20, 0, x, y] });
  const labelY = (items: RawTextItem[]) => {
    const p = reconstructPage(items, FONTS, 612, 792).paragraphs.find(q => q.runs.map(r => r.text).join('').includes('LABEL'));
    expect(p).toBeDefined();
    return p?.y;
  };

  it('reading up, from y 300 over 200pt: y is the middle, 400', () => {
    expect(labelY([text('Body', 72, 700), stamp('LABEL 0123456789abcd', 520, 300)])).toBeCloseTo(300 + 100, 5); // 20 chars x 10 = 200pt
  });
  it('reading down, from y 600 over 200pt: y is the middle, 500 — and a left-margin label (x 30) is not in the footer band', () => {
    // without the fix this paragraph's y was +x = 30: inside the footer band (<= 0.12 x 792)
    expect(labelY([text('Body', 72, 700), down('LABEL 0123456789abcd', 30, 600)])).toBeCloseTo(600 - 100, 5);
  });

  it('alignment is measured along the text: a label centred on the page HEIGHT is centred, whichever way it reads', () => {
    // 20 chars x 10pt = 200pt: from 296 to 496 is centred on 396 = 792 / 2. In the old frame (pageWidth 306 as the centre) up was
    // "right" and down, at a negative x, could never be centred.
    const al = (it: RawTextItem) => reconstructPage([text('Body', 72, 700), it], FONTS, 612, 792).paragraphs.find(q => q.runs.map(r => r.text).join('').includes('LABEL'))?.alignment;
    expect(al(stamp('LABEL 0123456789abcd', 520, 296))).toBe('center');
    expect(al(down('LABEL 0123456789abcd', 520, 496))).toBe('center');
  });

  const page = (n: number, label: RawTextItem) =>
    reconstructPage([...[0, 1, 2, 3].map(i => text(`Body line ${i} of page ${n}`, 72, 650 - i * 14)), text(`Page ${n}`, 72, 40), label], FONTS, 612, 792);
  const bodyText = (d: FlowDoc, i: number) => d.pages[i].paragraphs.map(q => q.runs.map(r => r.text).join('')).join(' | ');

  for (const [name, mk] of [
    ['reading up from the bottom edge (x 590, y 30 over 380pt)', () => stamp('CONFIDENTIAL DRAFT - DO NOT DISTRIBUTE', 590, 30)],
    ['reading down from the top edge (x 20, y 770 over 380pt)', () => down('CONFIDENTIAL DRAFT - DO NOT DISTRIBUTE', 20, 770)],
  ] as const) {
    it(`${name}: the running footer is still the folio, and the banner is not hoisted`, () => {
      const doc: FlowDoc = { pages: [1, 2, 3].map(n => page(n, mk())) };
      applyRepeatedBands(doc);
      expect(doc.footer).toBe('Page 1');
      expect(doc.header).toBeUndefined();
      for (let i = 0; i < 3; i++) expect(bodyText(doc, i)).toContain('CONFIDENTIAL DRAFT');
    });
  }
});

describe('a redaction over rotated text removes it from the flow (milestone round 4, P3)', () => {
  // The item filter runs before words are built, so a rotated item leaves with the rest. A stamp 380pt long reading up from
  // y 242 occupies the page's y 242..622, which is 170..550 from the top: the box below covers it, the control box does not.
  const items = [text('Body line one', 72, 700), stamp('SECRETSTAMP arXiv:1810.04805v2 [cs.CL] 24 May 2019', 32, 242)];
  const flat = (red: { x: number; y: number; width: number; height: number }[]) =>
    reconstructPage(items, FONTS, 612, 792, undefined, red).paragraphs.map(p => p.runs.map(r => r.text).join('')).join(' | ');

  it('control: no redaction keeps the stamp', () => expect(flat([])).toContain('SECRETSTAMP'));
  it('control: a box beside the stamp keeps it', () => expect(flat([{ x: 300, y: 170, width: 60, height: 380 }])).toContain('SECRETSTAMP'));
  it('a box over the stamp removes it, and only it', () => {
    const out = flat([{ x: 20, y: 160, width: 60, height: 400 }]);
    expect(out).not.toContain('SECRETSTAMP');
    expect(out).not.toContain('arXiv');
    expect(out).toContain('Body line one');
  });
});

describe('a rotated stamp never takes a heading rank (limits row 56)', () => {
  // `assignHeadings` ranks paragraphs by font size, so the 20pt arXiv stamp outranked the real 16pt title and became Heading 1.
  const title = (str: string, size: number, y: number): RawTextItem => ({ ...text(str, 72, y), transform: [size, 0, 0, size, 72, y], width: str.length * size * 0.5, height: size });
  const bodyLines = [700, 686, 672, 658].map((y, i) => text(`Language model pre-training has been shown to be effective, line ${i}`, 72, y));
  const headings = (items: RawTextItem[]) => {
    const doc: FlowDoc = { pages: [reconstructPage(items, FONTS, 612, 792)] };
    assignHeadings(doc);
    return doc.pages[0].paragraphs.map(p => ({ t: p.runs.map(r => r.text).join('').slice(0, 14), h: p.heading }));
  };

  it('the upright title is Heading 1 and the stamp is body text', () => {
    const out = headings([title('A Real Paper Title', 16, 740), ...bodyLines, stamp('arXiv:1810.04805v2 [cs.CL] 24 May 2019', 32, 400)]);
    expect(out.find(p => p.t.startsWith('A Real Paper'))?.h).toBe(1);
    expect(out.find(p => p.t.startsWith('arXiv:'))?.h).toBe(0);
  });

  it('a stamp set at the TITLE\'s own size is still body text (the ranking guard alone, not the size vote)', () => {
    const same: RawTextItem = { ...stamp('arXiv:1810.04805v2 [cs.CL] 24 May 2019', 32, 400), transform: [0, 16, -16, 0, 32, 400], height: 16 };
    const out = headings([title('A Real Paper Title', 16, 740), ...bodyLines, same]);
    expect(out.find(p => p.t.startsWith('A Real Paper'))?.h).toBe(1);
    expect(out.find(p => p.t.startsWith('arXiv:'))?.h).toBe(0);
  });

  it('a rotated ALL-CAPS banner at body size is not promoted by the style pass either', () => {
    const banner: RawTextItem = { ...stamp('CONFIDENTIAL DRAFT', 32, 400), transform: [0, 10, -10, 0, 32, 400], width: 90, height: 10 };
    expect(headings([...bodyLines, banner]).find(p => p.t.startsWith('CONFIDENTIAL'))?.h).toBe(0);
  });

  it('control: on a page whose text is ALL rotated, the rotated title still ranks (it is not a stamp)', () => {
    const turned = (str: string, size: number, x: number, y: number): RawTextItem => ({ ...stamp(str, x, y), transform: [0, size, -size, 0, x, y], width: str.length * size * 0.5, height: size });
    const out = headings([turned('A Real Paper Title', 16, 500, 100), ...[0, 1, 2, 3].map(i => turned(`Language model pre-training has been shown to be effective, line ${i}`, 10, 470 - i * 14, 100))]);
    expect(out.find(p => p.t.startsWith('A Real Paper'))?.h).toBe(1);
  });
});

