/**
 * B6 — recursive multi-column (3-col) XY-cut.
 *
 * `detectColumnSplit` finds ONE vertical gutter. `splitColumns` applies it
 * recursively (depth-capped) so a 3-column layout yields 3 word-groups in
 * left-to-right reading order. A 1- or 2-column page is byte-identical to the
 * pre-B6 single-cut behaviour (the regression guard). `detectColumnSplit` gains
 * an optional `bounds` arg; with the default it behaves exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { detectColumnSplit, splitColumns } from '../../src/utils/flowDoc';

// Build n words per column across 2 baselines (detectColumnSplit needs ≥2 y's).
function col(x: number, w: number, ys: number[]) {
  return ys.map(y => ({ x, width: w, y }));
}

describe('detectColumnSplit — bounds arg (B6)', () => {
  it('default bounds unchanged: finds the central gutter of a 2-col page', () => {
    const words = [...col(60, 120, [700, 680]), ...col(330, 120, [700, 680])]; // 600pt page
    const split = detectColumnSplit(words, 600) ?? -1;
    expect(split).toBeGreaterThan(180);
    expect(split).toBeLessThan(330);
  });

  it('bounds restricts the search to a sub-column region', () => {
    // Two sub-columns inside the right half [300,600]; a gutter ~ 410-450.
    const words = [...col(310, 90, [700, 680]), ...col(470, 90, [700, 680])];
    const split = detectColumnSplit(words, 600, { min: 300, max: 600 }) ?? -1;
    expect(split).toBeGreaterThan(400);
    expect(split).toBeLessThan(470);
  });
});

describe('splitColumns (B6)', () => {
  it('1 column → one group with all words (byte-identical)', () => {
    const words = col(60, 480, [700, 680, 660]);
    const groups = splitColumns(words, 600);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(words.length);
  });

  it('2 columns → two groups, left then right', () => {
    const left = col(60, 120, [700, 680]);
    const right = col(330, 120, [700, 680]);
    const groups = splitColumns([...left, ...right], 600);
    expect(groups).toHaveLength(2);
    expect(groups[0].every(w => w.x < 300)).toBe(true);
    expect(groups[1].every(w => w.x >= 300)).toBe(true);
  });

  it('3 columns → three groups in left-to-right reading order', () => {
    const c1 = col(40, 130, [700, 680]);
    const c2 = col(235, 130, [700, 680]);
    const c3 = col(430, 130, [700, 680]);
    const groups = splitColumns([...c1, ...c2, ...c3], 600);
    expect(groups).toHaveLength(3);
    expect(groups[0].every(w => w.x < 200)).toBe(true);
    expect(groups[1].every(w => w.x >= 200 && w.x < 400)).toBe(true);
    expect(groups[2].every(w => w.x >= 400)).toBe(true);
  });
});

describe('limits row 21 (D10) — 4+ columns and narrow gutters', () => {
  // `n` columns across a 600pt page, each `gutter` points from the next, two baselines each.
  const page = (n: number, gutter: number) => {
    const pitch = 580 / n;
    return Array.from({ length: n }, (_, c) => [700, 680].map(y => ({ x: 10 + c * pitch, width: pitch - gutter, y, c }))).flat();
  };
  const inOrder = (groups: { c: number }[][]) => groups.every((g, i) => g.every(w => w.c === i));

  for (const n of [4, 5, 6, 8]) {
    it(`${n} columns split into ${n} groups in reading order`, () => {
      const groups = splitColumns(page(n, 40), 600);
      expect(groups).toHaveLength(n);
      expect(inOrder(groups)).toBe(true);
    });
  }

  it('9 columns under-split to the 8 three levels allow, losing no word (the remaining ceiling)', () => {
    const groups = splitColumns(page(9, 40), 600);
    expect(groups).toHaveLength(8);
    expect(groups.flat()).toHaveLength(18);
  });

  it('the cut is the gutter nearest the centre, not the widest: a ragged 4-column page is halved', () => {
    // Column 3 is ragged-right, so its gutter (385–445, 60pt) is WIDER than the middle one (260–300). The widest-gutter
    // rule this replaced cut there, 3|1; the page must still be halved at the middle gutter.
    const words = page(4, 40).map(w => (w.c === 2 ? { ...w, width: 85 } : w));
    const cut = detectColumnSplit(words, 600) ?? -1;
    expect(cut).toBeGreaterThanOrEqual(260);
    expect(cut).toBeLessThanOrEqual(300);
  });

  it('a two-column paper with a 14pt gutter splits (2.3% of the page — the 5% rule alone never did)', () => {
    const groups = splitColumns(page(2, 14), 600);
    expect(groups).toHaveLength(2);
    expect(inOrder(groups)).toBe(true);
  });

  it('a 12pt gutter that falls on the 2pt grid splits (the floor is 10pt, not 12 — BERT p8 and Census p12 need it)', () => {
    // This fixture's columns start on an even x, so the whole 12pt gutter minus one bin of rounding (10pt) is measured.
    expect(splitColumns(page(2, 12), 600)).toHaveLength(2);
  });

  it('two columns filling only the left half of the page still split (the margin beyond them is not a gutter)', () => {
    // Text ends at x≈290 on a 600pt page, so the empty strip from there to the zone's edge (480) is a gap nearer the
    // centre than the real 20pt gutter at 150–170. It has no words beyond it; choosing it and refusing afterwards left
    // this page one column.
    const words = [0, 1].flatMap(c => [700, 680].map(y => ({ x: 30 + c * 140, width: 120, y, c })));
    const groups = splitColumns(words, 600);
    expect(groups).toHaveLength(2);
    expect(inOrder(groups)).toBe(true);
  });

  it('an 11pt gutter does not split (the stated bound — a label column beside its content looks the same)', () => {
    // The 10pt floor applies to the gap measured on 2pt bins, which loses 2–4pt of the drawn gutter: 11pt or less never
    // splits, 14pt or more always does, 12–13pt depends on where the gap falls on the grid (measured, limits row 21).
    expect(splitColumns(page(2, 11), 600)).toHaveLength(1);
  });
});

