/**
 * EH-E — borderless (unruled) table detection.
 *
 * The worst failure mode of this feature is a FALSE POSITIVE: ordinary prose, or a two-column article
 * layout, silently reinterpreted as a table. Those two cases are therefore the first tests in this
 * file and the reason the confidence gate exists at all. A missed table costs the user nothing they
 * did not already have (today the answer is "no table found"); a phantom table corrupts their export.
 */
import { describe, it, expect } from 'vitest';
import { inferBorderlessGrid, whitespaceBands, lineClusters, listLayoutGenre } from '../../src/utils/borderlessTable';
import { gridToCsv, type TableTextItem } from '../../src/utils/tableExtract';

/** A text item with a real horizontal extent — the gap detector needs where text ENDS. */
const t = (x: number, y: number, text: string, width?: number): TableTextItem =>
  ({ x, y, text, width: width ?? text.length * 5 });

// ── the two cases that decide shippability ────────────────────────────────────────────────────────
describe('inferBorderlessGrid — REFUSES on non-tables', () => {
  it('ordinary prose is not a table (lines collectively cover the measure)', () => {
    // 6 justified-ish lines, each running the full width. No global vertical band survives.
    const items: TableTextItem[] = [];
    for (let i = 0; i < 6; i++) {
      const y = 700 - i * 14;
      items.push(t(72, y, 'Lorem ipsum dolor sit amet consectetur', 200));
      items.push(t(276, y, 'adipiscing elit sed do eiusmod tempor', 200));
    }
    expect(inferBorderlessGrid(items)).toBeNull();
  });

  it('a TWO-COLUMN PAGE layout is not a table — each line lives in exactly one column', () => {
    // The discriminator case. There IS a clean global whitespace band down the middle, so band
    // detection alone would happily call this a 2-column table. What makes it prose is that no line
    // spans both bands: the left column is one block of text, the right another.
    // NB the columns are SIDE BY SIDE in the same y-range, as a real two-column page is. An earlier
    // version of this fixture stacked them sequentially (left column above the right), which no real
    // layout does — and it passed for the wrong reason: with no shared rows, nothing spanned both bands.
    // The realistic shape DEFEATS the spanning discriminator (every line does span both), and it took a
    // real-pdf.js corpus to expose that. It is refused by the cell-density gate instead.
    const items: TableTextItem[] = [];
    for (let i = 0; i < 8; i++) {
      const y = 700 - i * 14;
      items.push(t(60, y, 'left column body text here', 180));
      items.push(t(330, y, 'right column body text here', 180));
    }
    expect(inferBorderlessGrid(items)).toBeNull();
  });

  it('too few lines to be a table', () => {
    const items = [t(60, 700, 'Name', 40), t(300, 700, 'Total', 40)];
    expect(inferBorderlessGrid(items)).toBeNull();
  });

  it('a single column of short lines is not a table', () => {
    const items = Array.from({ length: 5 }, (_, i) => t(60, 700 - i * 14, `item ${i}`, 50));
    expect(inferBorderlessGrid(items)).toBeNull();
  });
});

// ── the feature itself ────────────────────────────────────────────────────────────────────────────
describe('inferBorderlessGrid — extracts a genuine borderless table', () => {
  // 4 rows x 3 columns, no rules anywhere. Columns at x≈60, 250, 430; wide clean gaps between.
  const table: TableTextItem[] = [
    t(60, 700, 'Item', 40), t(250, 700, 'Qty', 30), t(430, 700, 'Price', 40),
    t(60, 686, 'Widget', 50), t(250, 686, '2', 10), t(430, 686, '9.99', 30),
    t(60, 672, 'Gadget', 50), t(250, 672, '11', 15), t(430, 672, '24.50', 35),
    t(60, 658, 'Doohickey', 60), t(250, 658, '3', 10), t(430, 658, '5.00', 30),
  ];

  it('finds 4 rows and 3 columns', () => {
    const grid = inferBorderlessGrid(table);
    expect(grid).not.toBeNull();
    expect(grid?.rows).toBe(4);
    expect(grid?.cols).toBe(3);
  });

  it('preserves reading order in the CSV', () => {
    const grid = inferBorderlessGrid(table);
    expect(gridToCsv(grid as NonNullable<typeof grid>)).toBe(
      'Item,Qty,Price\nWidget,2,9.99\nGadget,11,24.50\nDoohickey,3,5.00',
    );
  });

  it('loses no text — every input item lands in some cell', () => {
    const grid = inferBorderlessGrid(table);
    const joined = grid?.cells.flat().join(' ') ?? '';
    for (const item of table) expect(joined).toContain(item.text);
  });

  it('a multi-word cell keeps its words together in x order', () => {
    const items: TableTextItem[] = [];
    for (let i = 0; i < 4; i++) {
      const y = 700 - i * 14;
      items.push(t(60, y, 'Alpha', 30), t(95, y, 'Beta', 25));   // one cell, two fragments
      items.push(t(400, y, `v${i}`, 20));
    }
    const grid = inferBorderlessGrid(items);
    expect(grid?.cols).toBe(2);
    expect(grid?.cells[0][0]).toBe('Alpha Beta');
  });
});

// ── the primitives, so a failure localises ────────────────────────────────────────────────────────
describe('whitespaceBands / lineClusters', () => {
  it('finds the uncovered x-range between two columns', () => {
    const items = [t(10, 100, 'a', 40), t(200, 100, 'b', 40)];
    const bands = whitespaceBands(items, 6);
    expect(bands).toHaveLength(1);
    expect(bands[0].lo).toBeCloseTo(50, 5);
    expect(bands[0].hi).toBeCloseTo(200, 5);
  });

  it('ignores a gap narrower than minGap (inter-word space is not a column break)', () => {
    const items = [t(10, 100, 'a', 40), t(53, 100, 'b', 40)]; // 3pt gap
    expect(whitespaceBands(items, 6)).toHaveLength(0);
  });

  it('groups items into baseline lines, top first', () => {
    const items = [t(10, 100, 'low'), t(10, 200, 'high'), t(60, 200.5, 'high2')];
    const lines = lineClusters(items, 3);
    expect(lines).toHaveLength(2);
    expect(lines[0].map(i => i.text)).toEqual(['high', 'high2']);
    expect(lines[1].map(i => i.text)).toEqual(['low']);
  });
});

describe('listLayoutGenre — the flow gate\'s refusal of list layouts (limits row 20)', () => {
  const grid = (cells: string[][]) => ({ rows: cells.length, cols: cells[0].length, cells });

  it('an index: terms followed by page numbers, including ranges and lists of pages', () => {
    expect(listLayoutGenre(grid([
      ['Refunds 18', 'Tax 100 , 104', 'Filing status 7 , 21 - 26'],
      ['Estates 75', '( See also Estate tax )', 'Grants 73'],
    ]))).toBe('index');
  });

  it('a table of contents: dot leaders on a fifth of its rows or more', () => {
    expect(listLayoutGenre(grid([
      ['1 Introduction', '3'], ['2.1 Model . . . . . . . . .', '8'], ['3 Results', '10'], ['4 Limits', '14'], ['5 End', '15'],
    ]))).toBe('contents');
    // Four rows, none with a leader: below the share, and nothing else says index.
    expect(listLayoutGenre(grid([['1 Introduction', '3'], ['3 Results', '10'], ['4 Limits', '14'], ['5 End', '15']]))).toBeNull();
  });

  it('a data table reads as a table: labels and values in separate cells, numbers alone in theirs', () => {
    expect(listLayoutGenre(grid([
      ['Description', 'Qty', 'Unit', 'Total'], ['Widget A', '2', '9.99', '19.98'], ['Service fee', '1', '35.00', '35.00'],
    ]))).toBeNull();
  });

  it('the index share is a threshold, not "any entry": one `Box 1` label among five does not refuse a form', () => {
    expect(listLayoutGenre(grid([
      ['Payer name', 'Rents', 'Royalties'], ['Street address', 'Box 1', 'Other income'], ['City or town', 'Fishing boat', 'Medical care'],
    ]))).toBeNull();
  });
});

