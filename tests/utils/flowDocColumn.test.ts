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
