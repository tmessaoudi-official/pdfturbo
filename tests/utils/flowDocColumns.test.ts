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
    // The 10pt floor applies to the gap measured on 2pt bins, which loses 2–4pt of the drawn gutter: 11pt or less splits only
    // between two body blocks of 20+ lines (row 46; this fixture has 2 lines), 14pt or more always does, 12–13pt depends on where the gap falls on the grid (measured, limits row 21).
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

// Limits row 44: a title, abstract, figure or table spanning both columns blocks the vertical cut, so the page stays one
// column and interleaves (measured on BERT p1, 3, 5, 6 and ResNet p1, 5, 8, 11 — untagged, so the product reads them
// through this splitter). A full-width WHITE BAND (no word's extent in it, at least 1.5 em) cuts the page into slabs, and
// the slabs are tried for a vertical split — but only when one of them really splits, so every other page returns exactly
// what it did before.
describe('splitColumns — a spanning block cuts the page into bands first (limits row 44)', () => {
  const W = 595;
  // `n` lines at 12pt leading from `y0` down; `c` tags the column / block so reading order can be asserted.
  const block = (x: number, w: number, n: number, y0: number, c: string, size = 10) =>
    Array.from({ length: n }, (_, i) => ({ x, width: w, y: y0 - i * 12, size, c }));
  const ids = (groups: { c: string }[][]) => groups.map(g => [...new Set(g.map(w => w.c))].join('+'));

  it('a centred title above two columns: title, then left, then right (BERT p1 shape)', () => {
    const words = [...block(150, 300, 3, 760, 'T', 14), ...block(72, 218, 30, 650, 'L'), ...block(307, 219, 30, 650, 'R')];
    expect(ids(splitColumns(words, W))).toEqual(['T', 'L', 'R']);
  });

  it('a full-width figure caption between two column bands: top L, top R, caption, bottom L, bottom R (BERT p3 shape)', () => {
    const words = [
      ...block(72, 218, 15, 740, 'L1'), ...block(307, 219, 15, 740, 'R1'),
      ...block(72, 454, 2, 480, 'CAP'),
      ...block(72, 218, 15, 430, 'L2'), ...block(307, 219, 15, 430, 'R2'),
    ];
    expect(ids(splitColumns(words, W))).toEqual(['L1', 'R1', 'CAP', 'L2', 'R2']);
  });

  it('control: a one-column page with paragraph gaps is returned exactly as before (one group, same array contents)', () => {
    const words = [...block(72, 454, 8, 740, 'P1'), ...block(72, 454, 8, 600, 'P2'), ...block(72, 454, 8, 460, 'P3')];
    const groups = splitColumns(words, W);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(words);
  });

  it('control: a short table-like alignment inside a one-column page is not a column split (fewer than 6 lines a side)', () => {
    // 140pt cells are 23% of the page each, so the WIDTH rule passes them and only the line count can refuse the slab.
    const cell = (x: number, y: number) => ({ x, width: 140, y, size: 10, c: 'tbl' });
    const table = [0, 1, 2].flatMap(r => [72, 232, 392].map(x => cell(x, 600 - r * 12)));
    const words = [...block(72, 454, 8, 740, 'P1'), ...table, ...block(72, 454, 8, 500, 'P2')];
    expect(splitColumns(words, W)).toHaveLength(1);
  });

  it('control: sections of a many-column NUMBER table are not read column by column (GPT-3 Table H.1 shape)', () => {
    // A title, then three sections of 8 rows x 6 numeric columns ~8% of the page wide each, a white band between sections.
    // Every section has a clean gutter and 8 lines, so only the WIDTH of the resulting groups can tell it from a text page.
    const cells = (y0: number, tag: string) =>
      Array.from({ length: 8 }, (_, r) => Array.from({ length: 6 }, (_, c) => ({ x: 120 + c * 62, width: 40, y: y0 - r * 12, size: 10, c: `${tag}${c}` }))).flat();
    const words = [...block(150, 300, 1, 780, 'T', 14), ...cells(740, 'a'), ...cells(600, 'b'), ...cells(460, 'c')];
    expect(splitColumns(words, W)).toHaveLength(1);
  });

  it('control: a table of a names block and three NUMBER blocks is not read block by block (GPT-3 Table H.1 shape)', () => {
    // A names block 140pt (23% of the page) wide, a 20pt gutter, then three blocks of 6 numeric columns, each 111pt (19%) wide with
    // 3pt between its columns and 16pt between blocks. Both groups have 12 lines and a median line over 18% of
    // the page — the line, width and gutter rules all pass it, so only the NUMERIC rule can refuse the slab.
    const row = (y: number) => [
      { x: 40, width: 140, y, size: 10, text: 'HellaSwag acc dev SOTA', c: 'names' },
      ...[0, 1, 2].flatMap(b => Array.from({ length: 6 }, (_, k) => ({ x: 200 + b * 127 + k * 19, width: 16, y, size: 10, text: `${(k * 7.3 + b).toFixed(1)}`, c: `blk${b}` }))),
    ];
    const words = [...block(150, 300, 1, 780, 'T', 14), ...Array.from({ length: 12 }, (_, r) => row(740 - r * 12)).flat()];
    expect(splitColumns(words, W)).toHaveLength(1);
  });

  it('control: an 8-row key/value TEXT table inside a one-column page is not read column by column', () => {
    // Keys (100pt, 17% of the page) beside values (160pt), white bands above and below, no rules and no numbers — so neither
    // the numeric rule nor the 6-line rule refuses it. Only what a text COLUMN is that a key column is not can: its lines run
    // long (a median line span of at least 18% of the page; a key is ~13%).
    const kv = (r: number) => [
      { x: 72, width: 70 + (r % 3) * 12, y: 600 - r * 12, size: 10, text: 'Customer name', c: 'k' },
      { x: 200, width: 150 + (r % 2) * 10, y: 600 - r * 12, size: 10, text: 'Acme Corporation Europe', c: 'v' },
    ];
    const words = [...block(72, 454, 8, 740, 'P1'), ...Array.from({ length: 8 }, (_, r) => kv(r)).flat(), ...block(72, 454, 8, 460, 'P2')];
    expect(splitColumns(words, W)).toHaveLength(1);
  });

  it('a venue footer that SPANS the gutter keeps the page whole in its own slab: left, right, then the footer intact', () => {
    // Row 45 leaves the bottom band out of the gutter search so a 5pt page number cannot block the cut. A footer sentence
    // 150pt a piece is not a page number: left in the search it blocks the cut, the band path runs, and it stays one group.
    const footer = [72, 232, 392].map(x => ({ x, width: 150, y: 190, size: 10, c: 'FOOT' }));
    const words = [...block(72, 218, 40, 700, 'L'), ...block(307, 219, 40, 700, 'R'), ...footer];
    expect(ids(splitColumns(words, W))).toEqual(['L', 'R', 'FOOT']);
  });

  it('every word survives when the LAST slab does not split (a closing full-width line after two column bands)', () => {
    const words = [...block(150, 300, 2, 760, 'T', 14), ...block(72, 218, 14, 650, 'L'), ...block(307, 219, 14, 650, 'R'), ...block(72, 454, 2, 440, 'END')];
    const groups = splitColumns(words, W);
    expect(groups.flat()).toHaveLength(words.length);
    expect(ids(groups)).toEqual(['T', 'L', 'R', 'END']);
  });

  it('control: a spanning line at the bottom of a column band still blocks that band', () => {
    // title, band, two columns whose last line spans the page at normal leading, band, a closing paragraph: the spanning
    // line is wide, so the footer-band exemption (a page number's) does not apply and it keeps blocking the cut.
    const words = [
      ...block(150, 300, 2, 760, 'T', 14),
      ...block(72, 218, 12, 650, 'L'), ...block(307, 219, 12, 650, 'R'),
      ...block(72, 454, 1, 650 - 12 * 12, 'SPAN'),
      ...block(72, 454, 3, 400, 'END'),
    ];
    expect(splitColumns(words, W)).toHaveLength(1);
  });

  it('a spanning line made of PIECES (a short citation piece over the gutter) at the bottom of a band still blocks that band', () => {
    // pdf.js splits a line at every font change: a 218pt roman run, a 15pt `[12]` piece over the gutter and a 147pt run. The
    // 15pt piece is narrower than FOOTER_PIECE, and the lowest line of a BAND is not the page's footer — so the band must be
    // judged against the PAGE's footer cut, or the piece is left out of the gutter search and the sentence is cut in half
    // (milestone round 2, e779ad7: `groups=4`, the halves attached to different columns).
    const y = 650 - 12 * 12;
    const span = [{ x: 72, width: 218, y, size: 10, c: 'SPAN' }, { x: 291, width: 15, y, size: 10, c: 'SPAN' }, { x: 307, width: 147, y, size: 10, c: 'SPAN' }];
    const words = [
      ...block(150, 300, 2, 760, 'T', 14),
      ...block(72, 218, 12, 650, 'L'), ...block(307, 219, 12, 650, 'R'),
      ...span,
      ...block(72, 454, 3, 400, 'END'),
    ];
    expect(splitColumns(words, W)).toHaveLength(1);
  });

  it('below the first cut, a half judges the PAGE\'s footer band, not its own lowest line (a spanning line in PIECES in the left half)', () => {
    // Four columns, 16pt gutters; the folio sits in the middle gutter at the page bottom, and the left half has one more line
    // than the right: its lowest line spans columns 1-2 as three pieces, the middle one a 14pt `[12]` over the gutter. Judged
    // against the left half's own words that line is its "footer", the short piece drops out of the gutter search and the
    // sentence is cut between two groups (milestone round 3, e779ad7 + 7946418: 4 groups).
    const col = (x: number, c: string, n: number) => Array.from({ length: n }, (_, i) => ({ x, width: 120, y: 740 - i * 12, size: 10, c }));
    const y = 740 - 20 * 12;
    const words = [
      ...col(40, 'L0', 20), ...col(176, 'L1', 20), ...col(312, 'R2', 20), ...col(448, 'R3', 20),
      { x: 40, width: 120, y, size: 10, c: 'SPAN' }, { x: 161, width: 15, y, size: 10, c: 'SPAN' }, { x: 176, width: 120, y, size: 10, c: 'SPAN' },
      { x: 300, width: 8, y: 40, size: 10, c: 'FOLIO' },
    ];
    const groups = splitColumns(words, W);
    expect(groups.filter(g => g.some(w => w.c === 'SPAN'))).toHaveLength(1);
    expect(groups.flat()).toHaveLength(words.length);
  });

  it('control: a 14pt gutter page with no spanning block is unchanged (vertical cut first, no bands)', () => {
    const words = [...block(72, 218, 20, 740, 'L'), ...block(307, 219, 20, 740, 'R')];
    expect(ids(splitColumns(words, W))).toEqual(['L', 'R']);
  });
});
