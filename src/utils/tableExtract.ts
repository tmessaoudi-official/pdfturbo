/**
 * Ruled-table extraction (Wave 2 #56) — cluster the horizontal + vertical grid
 * rules of a lattice table into a cell grid and emit CSV. Pure: operates on
 * already-extracted rules + positioned text items (the export op-walk supplies
 * both). Borderless tables are NOT detected (documented ceiling) — this needs
 * visible grid lines on at least two axes.
 *
 * Coordinates are PDF user space (y-up). Output rows are top-to-bottom and
 * columns left-to-right (reading order).
 */
import type { RuleRect } from './flowDoc';

/** A positioned text fragment in PDF user space (y-up). */
export interface TableTextItem {
  x: number;
  y: number;
  text: string;
  /**
   * Advance width in user-space units, when the extractor knows it. OPTIONAL and ignored by the
   * lattice path (which assigns cells by origin alone, so existing behaviour is byte-identical). It
   * exists for the borderless detector in `borderlessTable.ts`, which cannot find a whitespace column
   * without knowing where text ENDS.
   */
  width?: number;
}

export interface TableGrid {
  rows: number;
  cols: number;
  cells: string[][];
}

const DEFAULT_TOL = 3;

/**
 * Collapse near-equal coordinate values (a grid line drawn as several segments,
 * or with sub-point jitter) into one representative per cluster (the cluster
 * mean). Input order-independent; output ascending.
 */
export function clusterPositions(values: number[], tol: number): number[] {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  let group: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] <= tol) {
      group.push(sorted[i]);
    } else {
      out.push(group.reduce((s, v) => s + v, 0) / group.length);
      group = [sorted[i]];
    }
  }
  out.push(group.reduce((s, v) => s + v, 0) / group.length);
  return out;
}

/**
 * Build a cell grid from the table's horizontal + vertical rules and the text
 * items inside it. Returns null when there aren't enough lines to form at least
 * one cell (≥2 boundaries on each axis).
 */
export function buildTableGrid(
  hRules: RuleRect[],
  vRules: RuleRect[],
  items: TableTextItem[],
  tol = DEFAULT_TOL,
): TableGrid | null {
  const rowBounds = clusterPositions(hRules.map(r => r.y + r.height / 2), tol);
  const colBounds = clusterPositions(vRules.map(r => r.x + r.width / 2), tol);
  if (rowBounds.length < 2 || colBounds.length < 2) return null;

  const rows = rowBounds.length - 1;
  const cols = colBounds.length - 1;
  const cells: string[][] = [];

  for (let r = 0; r < rows; r++) {
    // Top row first → descending y. rowBounds is ascending, so the top band is
    // the highest pair.
    const lo = rowBounds[rows - 1 - r];
    const hi = rowBounds[rows - r];
    // The bands are half-open so adjacent cells cannot both claim an item — EXCEPT at the outermost
    // edge, where the upper bound must be INCLUSIVE. flowDoc's `_itemInRegion` accepts the region
    // bbox inclusively on all four sides, and reconstructPage then REMOVES every in-region word from
    // the paragraph flow; a word sitting exactly on the top or right boundary would therefore be
    // deleted from the flow AND land in no cell, vanishing from DOCX/MD/TXT/CSV with no warning.
    // (Measured before the fix: with such a word as the only text, every cell came out empty and the
    // whole table was discarded as phantom — `buildTableGrid` returned null.) The top band is r === 0
    // because rows are emitted top-first.
    const topBand = r === 0;
    const rowCells: string[] = [];
    for (let c = 0; c < cols; c++) {
      const xLo = colBounds[c];
      const xHi = colBounds[c + 1];
      const lastCol = c === cols - 1;
      const inCell = items.filter(it =>
        it.x >= xLo && (lastCol ? it.x <= xHi : it.x < xHi)
        && it.y >= lo && (topBand ? it.y <= hi : it.y < hi));
      inCell.sort((a, b) => (b.y - a.y) || (a.x - b.x)); // reading order: top→bottom, left→right
      rowCells.push(inCell.map(it => it.text.trim()).filter(Boolean).join(' '));
    }
    cells.push(rowCells);
  }

  // Prune bands that are empty across their whole extent, on BOTH axes. A doubled / over-segmented
  // rule (one logical grid line detected as two bounds >tol apart) creates a thin band that catches
  // no text; left in, it emits a spurious empty CSV column (",,") or a blank CSV record, and an empty
  // row in the exported DOCX table. Only the COLUMN half of this existed until 2026-07-31 — rows have
  // the identical failure mode and were not pruned, which is the asymmetry that was the bug.
  //
  // This never drops real data: a band survives if ANY cell in it holds text, so a deliberate blank
  // spacer row in the source (whose cells DO carry text elsewhere in the band) is preserved. If
  // nothing survives at all there is no table to extract.
  const keepRows: number[] = [];
  for (let r = 0; r < rows; r++) {
    if (cells[r].some(v => v !== '')) keepRows.push(r);
  }
  const keepCols: number[] = [];
  for (let c = 0; c < cols; c++) {
    if (keepRows.some(r => cells[r][c] !== '')) keepCols.push(c);
  }
  if (!keepRows.length || !keepCols.length) return null;
  if (keepRows.length === rows && keepCols.length === cols) return { rows, cols, cells };

  return {
    rows: keepRows.length,
    cols: keepCols.length,
    cells: keepRows.map(r => keepCols.map(c => cells[r][c])),
  };
}

/**
 * One RFC 4180 CSV field. Cells come from an arbitrary opened PDF (untrusted), so a value
 * beginning with `= + - @` or a tab/CR is neutralised against spreadsheet formula injection
 * (#QA-2026-06-23 P2) by prefixing a single quote before the normal RFC-4180 quoting.
 */
function csvField(value: string): string {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Serialize a grid to CSV (comma-separated fields, newline-separated rows). */
export function gridToCsv(grid: TableGrid): string {
  return grid.cells.map(row => row.map(csvField).join(',')).join('\n');
}
