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
    const rowCells: string[] = [];
    for (let c = 0; c < cols; c++) {
      const xLo = colBounds[c];
      const xHi = colBounds[c + 1];
      const inCell = items.filter(it => it.x >= xLo && it.x < xHi && it.y >= lo && it.y < hi);
      inCell.sort((a, b) => (b.y - a.y) || (a.x - b.x)); // reading order: top→bottom, left→right
      rowCells.push(inCell.map(it => it.text.trim()).filter(Boolean).join(' '));
    }
    cells.push(rowCells);
  }
  return { rows, cols, cells };
}

/** One RFC 4180 CSV field: quote when it contains a comma, quote, or newline. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize a grid to CSV (comma-separated fields, newline-separated rows). */
export function gridToCsv(grid: TableGrid): string {
  return grid.cells.map(row => row.map(csvField).join(',')).join('\n');
}
