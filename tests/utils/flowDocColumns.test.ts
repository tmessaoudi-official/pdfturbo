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
