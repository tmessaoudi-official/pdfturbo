import { describe, it, expect } from 'vitest';
import { clusterPositions, buildTableGrid, gridToCsv, type TableTextItem, type TableGrid } from '../../src/utils/tableExtract';
import type { RuleRect } from '../../src/utils/flowDoc';

const h = (y: number, x = 0, width = 300): RuleRect => ({ x, y, width, height: 0 });
const v = (x: number, y = 0, height = 200): RuleRect => ({ x, y, width: 0, height });
const t = (x: number, y: number, text: string): TableTextItem => ({ x, y, text });

/** Narrow a possibly-null grid (oxlint forbids `!`). */
function grid(g: TableGrid | null): TableGrid {
  if (!g) throw new Error('expected a table grid, got null');
  return g;
}

describe('clusterPositions', () => {
  it('collapses near-equal values within tolerance to their mean', () => {
    expect(clusterPositions([100, 101, 150, 200, 199], 3)).toEqual([100.5, 150, 199.5]);
  });
  it('returns [] for empty input', () => {
    expect(clusterPositions([], 3)).toEqual([]);
  });
});

describe('buildTableGrid', () => {
  // 2×2 grid: h-lines at y=100/150/200, v-lines at x=50/150/250 (PDF y-up).
  const hRules = [h(100), h(150), h(200)];
  const vRules = [v(50), v(150), v(250)];
  const items = [
    t(60, 170, 'A'), t(160, 170, 'B'),   // top row (higher y)
    t(60, 120, 'C'), t(160, 120, 'D'),   // bottom row
  ];

  it('assigns text to cells in top-to-bottom, left-to-right reading order', () => {
    expect(buildTableGrid(hRules, vRules, items)).toEqual({ rows: 2, cols: 2, cells: [['A', 'B'], ['C', 'D']] });
  });

  it('joins multiple items in one cell by reading order', () => {
    const g = grid(buildTableGrid(hRules, vRules, [t(55, 175, 'Hello'), t(90, 170, 'World'), t(160, 120, 'X')]));
    expect(g.cells[0][0]).toBe('Hello World');
    expect(g.cells[1][1]).toBe('X');
  });

  it('returns null when there are too few grid lines', () => {
    expect(buildTableGrid([h(100)], vRules, items)).toBeNull();   // <2 h-lines
    expect(buildTableGrid(hRules, [v(50)], items)).toBeNull();    // <2 v-lines
  });

  it('tolerates jittered rule coordinates (same line drawn as segments)', () => {
    expect(buildTableGrid([h(100), h(101), h(200)], [v(50), v(49), v(250)], [t(150, 150, 'Z')]))
      .toEqual({ rows: 1, cols: 1, cells: [['Z']] });
  });
});

describe('buildTableGrid — spurious empty-column pruning (QA 2026-06-18 N2)', () => {
  it('drops an interstitial empty column from an over-segmented vertical rule', () => {
    // Real 2-column table, but one logical grid line is detected twice 10pt apart
    // (150 and 160, both > tol) → a thin empty band between the real columns.
    const hR = [h(100), h(200)];
    const vR = [v(50), v(150), v(160), v(250)];
    const its = [t(60, 150, 'A'), t(200, 150, 'B')];
    expect(buildTableGrid(hR, vR, its)).toEqual({ rows: 1, cols: 2, cells: [['A', 'B']] });
  });

  it('keeps a column that carries data in at least one row', () => {
    const hR = [h(100), h(150), h(200)];
    const vR = [v(50), v(150), v(250)];
    const its = [t(60, 170, 'A'), t(60, 120, 'C'), t(160, 120, 'D')]; // right col empty up top, 'D' below
    expect(buildTableGrid(hR, vR, its)).toEqual({ rows: 2, cols: 2, cells: [['A', ''], ['C', 'D']] });
  });

  it('returns null when pruning leaves no data columns', () => {
    const hR = [h(100), h(200)];
    const vR = [v(50), v(150), v(250)];
    expect(buildTableGrid(hR, vR, [])).toBeNull(); // grid lines but no text → nothing to extract
  });
});

describe('gridToCsv', () => {
  it('joins cells with commas and rows with newlines', () => {
    expect(gridToCsv({ rows: 2, cols: 2, cells: [['A', 'B'], ['C', 'D']] })).toBe('A,B\nC,D');
  });
  it('RFC4180-quotes cells containing comma, quote, or newline', () => {
    const csv = gridToCsv({ rows: 1, cols: 3, cells: [['a,b', 'say "hi"', 'line\nbreak']] });
    expect(csv).toBe('"a,b","say ""hi""","line\nbreak"');
  });
  it('leaves plain cells unquoted', () => {
    expect(gridToCsv({ rows: 1, cols: 2, cells: [['plain', 'text']] })).toBe('plain,text');
  });
});
