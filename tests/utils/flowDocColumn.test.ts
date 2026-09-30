/**
 * M2 #21 — reconstructColumn decomposed into pure stages. These property tests
 * pin the two foundational stages directly (formerly buried in a ~290-line fn):
 *   - clusterWordsIntoLines: baseline clustering + super/subscript overlap rule
 *   - groupLinesIntoParagraphs: baseline-gap / font-size-jump paragraph splitting
 * The end-to-end behavior stays guarded by the reconstructColumn/reconstructPage
 * tests in flowDoc.test.ts (regression guard for the decomposition).
 */
import { describe, it, expect } from 'vitest';
import {
  clusterWordsIntoLines,
  groupLinesIntoParagraphs,
  type Word,
  type Line,
} from '../../src/utils/flowDoc';

const W = (text: string, x: number, y: number, size = 12, width = text.length * 6): Word => ({
  text, x, y, width, size, fontName: 'F', rtl: false,
});
const L = (y: number, size = 12, x0 = 10, x1 = 100): Line => ({ words: [], y, size, x0, x1 });

describe('clusterWordsIntoLines', () => {
  it('groups words sharing a baseline into one line (reading order), top line first', () => {
    const lines = clusterWordsIntoLines([W('a', 10, 100), W('b', 40, 100.2), W('c', 10, 80)]);
    expect(lines).toHaveLength(2);
    expect(lines[0].words.map(w => w.text)).toEqual(['a', 'b']); // y≈100 cluster, x-ordered
    expect(lines[1].words.map(w => w.text)).toEqual(['c']);
  });

  it('splits words on distinct baselines into separate lines', () => {
    const lines = clusterWordsIntoLines([W('top', 10, 200), W('bot', 10, 100)]);
    expect(lines.map(l => l.words[0].text)).toEqual(['top', 'bot']);
  });

  it('keeps a small superscript glyph on the body line via the overlap rule', () => {
    // body size 12 @ y=100 (box 100..112); superscript size 6 @ y=106 (box 106..112):
    // baseline gap 6 > 0.5×6 (not baseline-close) but vertically overlapping → joins.
    const lines = clusterWordsIntoLines([W('x', 10, 100, 12), W('2', 22, 106, 6, 4)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].words.map(w => w.text)).toEqual(['x', '2']);
    expect(lines[0].size).toBe(12); // dominant (body) size, not the superscript's
  });
});

describe('groupLinesIntoParagraphs', () => {
  it('groups lines within the paragraph gap + same size band into one paragraph', () => {
    const groups = groupLinesIntoParagraphs([L(200), L(188)]); // gap 12 ≤ 1.6×12=19.2
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('starts a new paragraph on a large baseline gap', () => {
    const groups = groupLinesIntoParagraphs([L(200), L(150)]); // gap 50 > 19.2
    expect(groups).toHaveLength(2);
  });

  it('starts a new paragraph on a font-size jump', () => {
    const groups = groupLinesIntoParagraphs([L(200, 24), L(188, 12)]); // |24-12| ≥ 1
    expect(groups).toHaveLength(2);
  });

  // Limits row 41: a line whose box grew (a Latin fallback font inside an Arabic paragraph, Chrome print-to-PDF)
  // sat 22.50pt under its predecessor against a 1.6 × 13.99 = 22.38pt threshold, and split into its own paragraph.
  // A gap past the threshold stays a wrap when it is within 10% of the column's typical in-paragraph gap at that size.
  const at = (ys: number[], size = 14) => ys.map(y => L(y, size));
  const sizes = (g: Line[][]) => g.map(x => x.length);
  it('limits row 41: a wrap just past the threshold on a loosely spaced page stays in its paragraph', () => {
    // gaps 21.75, 20.68 (typical), 22.50 (the grown line), then 40 (a real paragraph break)
    expect(sizes(groupLinesIntoParagraphs(at([600, 578.25, 557.57, 535.07, 495.07])))).toEqual([4, 1]);
  });

  it('limits row 41: on a tightly spaced page the same ratio is still a paragraph break (LaTeX parskip)', () => {
    // 10pt text on 12pt lines, paragraphs 16.13pt apart — GPT-3 / Attention measured at 1.613
    expect(sizes(groupLinesIntoParagraphs(at([500, 488, 476, 459.87, 447.87], 10)))).toEqual([3, 2]);
  });

  it('limits row 41: one in-paragraph gap is not enough to call a spacing typical', () => {
    expect(sizes(groupLinesIntoParagraphs(at([600, 578.25, 555.75])))).toEqual([2, 1]);
  });

  it('limits row 41: the typical gap is taken per size — a loose 18pt column does not loosen a 14pt break', () => {
    // 18pt gaps of 27 (in-paragraph); 14pt gaps 17, 17, then 23 (a break past 1.6 em). Per size the 14pt typical is 17
    // and 23 > 1.1 × 17 splits; pooled across sizes the lower median is 27 and 23 ≤ 1.1 × 27 would merge it.
    const lines = [...at([800, 773, 746, 719], 18), ...at([600, 583, 566, 543])];
    expect(sizes(groupLinesIntoParagraphs(lines))).toEqual([4, 3, 1]);
  });

  it('limits row 41: a line opening with a list marker is not merged by the loosened rule', () => {
    const item: Line = { words: [W('•', 10, 535.07, 14), W('Schedule', 24, 535.07, 14)], y: 535.07, size: 14, x0: 10, x1: 100 };
    const groups = groupLinesIntoParagraphs([...at([600, 578.25, 557.57]), item]);
    expect(sizes(groups)).toEqual([3, 1]);
  });
});

// Limits row 52: Chrome prints a paragraph with `line-height: 1.6`, so every wrap gap is 22.5pt on a 14pt line — 1.608
// sizes, JUST past `PARA_GAP` (1.6). Row 41's typical gap counts only gaps up to the threshold, so such a page has none
// and each wrapped line became its own paragraph (measured on arabic-allcases p2). The evidence that it IS one
// paragraph: two or more consecutive equal gaps just past the threshold, AND the line above fills the measure (a line
// that ran out of room continues on the next).
describe('groupLinesIntoParagraphs — a uniformly leaded paragraph (limits row 52)', () => {
  const lines = (spec: Array<[number, number]>, size = 14, x0 = 58): Line[] => spec.map(([y, x1]) => L(y, size, x0, x1));
  const sizes = (g: Line[][]) => g.map(x => x.length);
  const HEAD = L(700, 18, 58, 507); // a wider line of another size fixes the column measure at 449pt

  it('joins a paragraph whose every wrap gap is 1.608 sizes and whose lines fill the measure', () => {
    const g = groupLinesIntoParagraphs([HEAD, ...lines([[621.5, 494], [599, 507], [576.5, 507], [554, 257]])]);
    expect(sizes(g)).toEqual([1, 4]); // the heading, then the four-line paragraph
  });

  it('control: the same gaps between SHORT lines are still separate paragraphs (single-line items)', () => {
    const g = groupLinesIntoParagraphs([HEAD, ...lines([[621.5, 158], [599, 158], [576.5, 158], [554, 158]])]);
    expect(sizes(g)).toEqual([1, 1, 1, 1, 1]);
  });

  it('control: a short last line ends the paragraph — the next full line opens a new one', () => {
    const g = groupLinesIntoParagraphs([HEAD, ...lines([[621.5, 507], [599, 507], [576.5, 257], [554, 507], [531.5, 507]])]);
    expect(sizes(g)).toEqual([1, 3, 2]);
  });

  it('control: a gap well past the threshold (2.3 sizes) is a break even after a full line', () => {
    const g = groupLinesIntoParagraphs([HEAD, ...lines([[621.5, 507], [599, 507], [576.5, 507], [544.3, 507]])]);
    expect(sizes(g)).toEqual([1, 3, 1]);
  });

  it('control: a line that opens a list marker starts its own paragraph', () => {
    const item: Line = { ...L(576.5, 14, 58, 507), words: [W('•', 58, 576.5, 14, 6), W('item', 70, 576.5, 14, 24)] };
    const g = groupLinesIntoParagraphs([HEAD, ...lines([[621.5, 507], [599, 507]]), item]);
    expect(sizes(g)).toEqual([1, 2, 1]);
  });

  it('control: equal-spaced TABLE rows (column gaps inside each line) are not a wrapped paragraph', () => {
    // measured on sample-tables-lattice.pdf: rows of `Property 345 445 222` span the measure at 1.61 sizes apart
    const row = (y: number): Line => ({
      ...L(y, 14, 58, 507),
      words: [W('Property', 58, y, 14, 48), W('345', 250, y, 14, 18), W('445', 350, y, 14, 18), W('222', 489, y, 14, 18)],
    });
    const g = groupLinesIntoParagraphs([HEAD, row(621.5), row(599), row(576.5), row(554)]);
    expect(sizes(g)).toEqual([1, 1, 1, 1, 1]);
  });

  it('control: ONE just-past gap is not uniform leading (row 41: a single in-paragraph gap stays a break)', () => {
    const g = groupLinesIntoParagraphs([HEAD, ...lines([[600, 507], [578.25, 507], [555.75, 507]])]);
    expect(sizes(g)).toEqual([1, 2, 1]);
  });
});
