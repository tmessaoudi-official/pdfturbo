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


// Limits row 45: ResNet (and any CVPR-style paper) never split, on any page — the centred PAGE NUMBER sits 14pt into the
// 22.5pt gutter (measured: `2` at x 295.1–300.1, y 51; the columns end at 286.4 and start at 308.9). One item of 175
// left a clean gap of ~9pt, under the 10pt floor. The gutter is now looked for WITHOUT the page's bottom edge band, where
// a page number or a footer lives; those words are still assigned to a column by their centre, never dropped.
describe('detectColumnSplit — a page number in the gutter (limits row 45)', () => {
  const W = 612;
  // A two-column body: 40 lines each, left 58.5–286.5, right 308.9–544.9, y 700 down to 232.
  const ys = Array.from({ length: 40 }, (_, i) => 700 - i * 12);
  const body = [...ys.map(y => ({ x: 58.5, width: 228, y })), ...ys.map(y => ({ x: 308.9, width: 236, y }))];
  const folio = (y: number) => ({ x: 295.1, width: 5, y });

  it('splits a two-column page whose centred page number (bottom edge) sits in the gutter', () => {
    const cut = detectColumnSplit([...body, folio(51)], W);
    expect(cut).not.toBeNull();
    expect(cut).toBeGreaterThan(286.5);
    expect(cut).toBeLessThan(308.9);
  });

  it('control: the same item in the MIDDLE of the body still blocks the cut', () => {
    expect(detectColumnSplit([...body, folio(500)], W)).toBeNull();
  });

  it('control: a running title in the TOP band still blocks it (a title block is not a footer — row 44)', () => {
    expect(detectColumnSplit([...body, { x: 153, width: 289, y: 775 }], W)).toBeNull();
  });

  it('control: without the footer item the page splits exactly as before', () => {
    const cut = detectColumnSplit(body, W);
    expect(cut).not.toBeNull();
    expect(cut).toBeGreaterThan(286.5);
    expect(cut).toBeLessThan(308.9);
  });

  it('splitColumns keeps every word: the page number lands in one column, none is lost', () => {
    const words = [...body, folio(51)];
    const groups = splitColumns(words, W);
    expect(groups).toHaveLength(2);
    expect(groups.flat()).toHaveLength(words.length);
    expect(groups.some(g => g.some(w => w.y === 51))).toBe(true);
  });
});

// Limits row 46: Publication 17's three-column body pages leave ~8pt gutters (measured 6pt on the 2pt bins), under the 10pt
// floor, so they exported one interleaved column. Lowering the floor to 8 would also split GPT-3's prompt-example pages,
// where a narrow LABEL column sits beside its content (94pt of 612, 6–16 lines, gap 4–8pt) — a smaller number cannot tell
// the two apart. What does: a narrow gutter splits only between two BODY blocks — at least 20 lines on each side and the
// narrower side at least a quarter of the region — a label column fails both, a body column passes both with margin
// (Pub 17: 53–70+ lines, 27% at the page and 40% inside a half; GPT-3: ≤ 16 lines, 15%).
describe('detectColumnSplit — a narrow gutter between body blocks (limits row 46)', () => {
  const W = 612;
  const lines = (n: number) => Array.from({ length: n }, (_, i) => 700 - i * 12);
  const block = (x: number, w: number, n: number, c: number) => lines(n).map(y => ({ x, width: w, y, c }));
  const inOrder = (groups: { c: number }[][]) => groups.every((g, i) => g.every(w => w.c === i));

  it('three body columns 9pt apart (Publication 17) split into three, in reading order', () => {
    const groups = splitColumns([...block(36, 168, 40, 0), ...block(213, 168, 40, 1), ...block(390, 168, 40, 2)], W);
    expect(groups).toHaveLength(3);
    expect(inOrder(groups)).toBe(true);
  });

  it('four narrow columns 9pt apart split into four (the test is relative to the region, not the page)', () => {
    // Each column is 124pt = 20% of the page, under a quarter; it is the HALVES (40% of the page) the first cut tests, and
    // 40% of a half the next.
    const groups = splitColumns([0, 1, 2, 3].flatMap(c => block(36 + c * 133, 124, 40, c)), W);
    expect(groups).toHaveLength(4);
    expect(inOrder(groups)).toBe(true);
  });

  it('control: a short LABEL column beside its content stays one group (GPT-3 prompt examples)', () => {
    // 94pt = 15% of the page, 12 lines — fails the width and the line count.
    expect(splitColumns([...block(36, 94, 12, 0), ...block(139, 400, 40, 1)], W)).toHaveLength(1);
  });

  it('control: a narrow column with MANY lines still stays one group (the width criterion alone refuses it)', () => {
    expect(splitColumns([...block(36, 94, 40, 0), ...block(139, 400, 40, 1)], W)).toHaveLength(1);
  });

  it('control: two wide blocks of FEW lines stay one group (the line criterion alone refuses them)', () => {
    expect(splitColumns([...block(36, 250, 10, 0), ...block(295, 250, 10, 1)], W)).toHaveLength(1);
  });

  it('control: a 6pt drawn gutter between body columns stays one group (below the narrow-gutter floor)', () => {
    expect(splitColumns([...block(36, 250, 40, 0), ...block(292, 250, 40, 1)], W)).toHaveLength(1);
  });

  it('the 10pt rule is unchanged: a 14pt gutter splits even between short blocks', () => {
    expect(splitColumns([...block(36, 250, 5, 0), ...block(300, 250, 5, 1)], W)).toHaveLength(2);
  });
});
