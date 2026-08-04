/**
 * Edge-case defects in the lattice-table extraction, found by reading the code on 2026-07-31 while
 * scoping EH-E (borderless detection) — this is the path EH-E will build on.
 *
 * Two independent findings, both in buildTableGrid:
 *
 * 1. BOUNDARY MISMATCH → silent data loss. `_itemInRegion` (flowDoc.ts) is INCLUSIVE on all four
 *    sides, while the cell bands here are HALF-OPEN (`>= lo && < hi`) and tile only
 *    [left,right) × [bottom,top). An item sitting exactly on the region's top or right boundary is
 *    therefore "in region" but in NO cell. That is not merely a CSV cosmetic: reconstructPage
 *    (flowDoc.ts:1542) REMOVES every in-region word from the paragraph flow, so such a word is
 *    deleted from the flow AND never appears in the grid — it vanishes from DOCX/MD/TXT/CSV with no
 *    warning. Exact float equality makes it rare, but "rare and silent" is how the redaction-crop
 *    leak looked too, and the fix is a one-line clamp on the last band.
 *
 * 2. ROW/COLUMN ASYMMETRY. Empty COLUMNS are pruned, with a comment explaining exactly why (an
 *    over-segmented vertical rule creates a thin text-free band that would emit a spurious `,,`).
 *    Rows have the identical failure mode — a 2px line drawn as two 1px strokes >tol apart yields a
 *    thin empty row band — and are NOT pruned, so the CSV gains a blank record and the DOCX table
 *    gains an empty row. The asymmetry is the bug; the column comment is the specification.
 */
import { describe, it, expect } from 'vitest';
import { buildTableGrid, gridToCsv } from '../../src/utils/tableExtract';
import type { RuleRect } from '../../src/utils/flowDoc';

/** A zero-thickness rule, so `y + height/2` is exactly `y` and the fixtures stay readable. */
const hRule = (y: number): RuleRect => ({ x: 0, y, width: 100, height: 0 });
const vRule = (x: number): RuleRect => ({ x, y: 0, width: 0, height: 100 });

describe('buildTableGrid — text exactly on the region boundary must not vanish', () => {
  // A 1×1 grid spanning x [0,100], y [0,100]. The region bbox (flowDoc) includes x=100 and y=100.
  const h = [hRule(0), hRule(100)];
  const v = [vRule(0), vRule(100)];

  it('keeps an item on the TOP boundary (y === top bound)', () => {
    const grid = buildTableGrid(h, v, [{ x: 50, y: 100, text: 'header' }]);
    expect(grid).not.toBeNull();
    expect(grid?.cells.flat().join(' ')).toContain('header');
  });

  it('keeps an item on the RIGHT boundary (x === right bound)', () => {
    const grid = buildTableGrid(h, v, [{ x: 100, y: 50, text: 'total' }]);
    expect(grid).not.toBeNull();
    expect(grid?.cells.flat().join(' ')).toContain('total');
  });

  it('still keeps interior items (no regression)', () => {
    const grid = buildTableGrid(h, v, [{ x: 50, y: 50, text: 'middle' }]);
    expect(grid?.cells.flat().join(' ')).toContain('middle');
  });

  it('does NOT pull in an item genuinely outside the grid', () => {
    // Beyond the boundary by more than rounding — must stay out, or the clamp would be swallowing
    // body text that reconstructPage rightly leaves in the paragraph flow.
    const grid = buildTableGrid(h, v, [
      { x: 50, y: 50, text: 'inside' },
      { x: 140, y: 50, text: 'outside' },
    ]);
    expect(grid?.cells.flat().join(' ')).toContain('inside');
    expect(grid?.cells.flat().join(' ')).not.toContain('outside');
  });
});

describe('buildTableGrid — an over-segmented HORIZONTAL rule must not emit an empty row', () => {
  // One logical grid line at y≈52 detected as two bounds 4pt apart (> the default 3pt tolerance),
  // exactly the doubled-rule case the column pruning already documents.
  const h = [hRule(0), hRule(50), hRule(54), hRule(100)];
  const v = [vRule(0), vRule(50), vRule(100)];
  const items = [
    { x: 10, y: 70, text: 'A' }, { x: 60, y: 70, text: 'B' },
    { x: 10, y: 20, text: 'C' }, { x: 60, y: 20, text: 'D' },
  ];

  it('drops the text-free row band', () => {
    const grid = buildTableGrid(h, v, items);
    expect(grid).not.toBeNull();
    expect(grid?.rows).toBe(2);
    expect(grid?.cells).toEqual([['A', 'B'], ['C', 'D']]);
  });

  it('the CSV carries no blank record', () => {
    const grid = buildTableGrid(h, v, items);
    expect(gridToCsv(grid as NonNullable<typeof grid>)).toBe('A,B\nC,D');
  });

  it('a genuinely empty row between two populated ones is PRESERVED', () => {
    // The prune must key on "this band caught no text at all", not on "the row looks empty to me" —
    // a real blank spacer row in the source table is content, and dropping it would shift the data.
    // Here the middle band is wide and deliberately blank, but a cell in it does hold text.
    const grid = buildTableGrid(h, v, [...items, { x: 10, y: 52, text: 'spacer' }]);
    expect(grid?.rows).toBe(3);
    expect(grid?.cells[1]).toEqual(['spacer', '']);
  });
});
