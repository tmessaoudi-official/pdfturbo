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
});
