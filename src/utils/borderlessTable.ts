/**
 * EH-E — borderless (unruled) table detection. Pure → jsdom-testable.
 *
 * The lattice path (`tableExtract.ts`) needs visible grid lines on both axes; a table drawn with
 * whitespace alone yields no rules and no table (ceilings C9/C13). This infers the grid from the text
 * geometry instead, then hands the inferred boundaries to `buildTableGrid` as synthetic zero-height
 * rules — so cell assignment, reading order, the empty-band pruning and every consumer (CSV, DOCX, MD,
 * TXT) are shared with the lattice path. One grid shape, one set of semantics.
 *
 * COLUMNS ARE GLOBAL WHITESPACE BANDS: an x-range that NO text item on the page crosses. That is
 * stricter than per-line gap persistence and it rejects prose by construction — prose lines
 * collectively cover the full measure, so no band survives. A row containing a spanning cell closes a
 * band and the table degrades to fewer columns, which is graceful rather than wrong.
 *
 * THE FALSE POSITIVE THIS MUST NOT MAKE is reading a two-column page layout as a two-column table:
 * that layout has exactly one clean global band, so band detection alone would accept it. The
 * discriminator is `MIN_SPANNING_RATIO` below — in a table a single line spans multiple column bands,
 * whereas in a multi-column page each line lives in exactly one. It is the load-bearing rule here.
 *
 * A miss costs the user nothing they had (today's answer is "no table found"); a phantom table corrupts
 * their export. So every gate refuses by returning null and none of them guesses.
 */
import { buildTableGrid, type CellTextFn, type TableGrid, type TableTextItem } from './tableExtract';
import type { RuleRect } from './flowDoc';

/** Baseline-clustering tolerance: items within this many points share a text line. */
const LINE_TOL = 3;
/**
 * A gap must be at least this wide to be a column break. Inter-word spaces in body text run to
 * ~0.3em (≈3–4pt at 12pt), and a deliberate column gutter is far wider, so 6pt separates the two
 * without needing font metrics we do not have here.
 */
const MIN_BAND_PT = 6;
/** Fewer lines than this is a heading or a stray pair, not a table worth claiming. */
const MIN_LINES = 3;
/**
 * Fraction of lines that must place text in ≥2 column bands. A real table's rows span columns; a
 * two-column PAGE has every line inside exactly one column, so it scores ~0 and is refused. Set at a
 * simple majority: a table may legitimately carry a full-width title row or a spanning subtotal.
 */
const MIN_SPANNING_RATIO = 0.5;
/**
 * Reject a candidate whose typical cell holds more words than this. **A table cell is a datum; a prose
 * line is a clause** — that is the semantic distinction, and it is what the number encodes.
 *
 * Added after MEASURING a realistic corpus (`tests/browser/borderless-corpus.browser.test.ts`), which
 * found two false positives the spanning-ratio rule could not catch:
 *   invoice          median 1 word/cell (max 2)
 *   bank statement   median 1          (max 2)
 *   two-column page  median 5   <- side-by-side columns: EVERY line spans both bands, so the
 *                                  multi-column discriminator passes and the layout reads as a table
 *   bulleted list    median 4   <- markers in their own column, every line spans both
 * The gap between 2 and 4 is wide, so 3 separates with margin at both ends rather than being tuned to
 * the fixtures. ACCEPTED TRADE-OFF: a genuine table with sentence-length cells (a "Description" column
 * of full sentences) is now refused. That is a false NEGATIVE — the user gets "no table found" instead
 * of mangled output — which is the direction this whole module errs in by design.
 */
const MAX_MEDIAN_CELL_WORDS = 3;

export interface WhitespaceBand { lo: number; hi: number }

/** Right edge of an item. Falls back to a hair past `x` when width is unknown, never to `x` itself. */
function itemRight(it: TableTextItem): number {
  return it.x + (typeof it.width === 'number' && it.width > 0 ? it.width : 0.1);
}

/**
 * Group items into text lines by baseline y, ordered TOP first (descending y in PDF user space), and
 * each line's items ordered left→right.
 */
export function lineClusters(items: TableTextItem[], tol = LINE_TOL): TableTextItem[][] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const lines: TableTextItem[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = lines[lines.length - 1];
    // Compare against the line's FIRST baseline, not the previous item's: comparing pairwise lets a
    // run of slightly-drifting baselines chain into one enormous line.
    if (Math.abs(prev[0].y - sorted[i].y) <= tol) prev.push(sorted[i]);
    else lines.push([sorted[i]]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

/**
 * Global uncovered x-ranges wider than `minGap`, from the union of every item's [x, right] extent.
 * Only interior gaps are returned — the margins outside the content are not column breaks.
 */
export function whitespaceBands(items: TableTextItem[], minGap = MIN_BAND_PT): WhitespaceBand[] {
  if (items.length < 2) return [];
  const spans = items
    .map(it => ({ lo: it.x, hi: itemRight(it) }))
    .sort((a, b) => a.lo - b.lo);

  const bands: WhitespaceBand[] = [];
  let cursor = spans[0].hi;
  for (let i = 1; i < spans.length; i++) {
    const s = spans[i];
    if (s.lo - cursor >= minGap) bands.push({ lo: cursor, hi: s.lo });
    // `cursor` must be the running MAXIMUM right edge, not this span's: a long item can enclose
    // several short ones, and taking s.hi would reopen a gap that is actually covered.
    if (s.hi > cursor) cursor = s.hi;
  }
  return bands;
}

export interface BorderlessOpts {
  lineTol?: number;
  minBand?: number;
  minLines?: number;
  minSpanningRatio?: number;
  maxMedianCellWords?: number;
  /** Limits row 42: the cell text for a grid holding right-to-left items (see `buildTableGrid`). */
  cellText?: CellTextFn;
}

/**
 * Infer a table grid from text geometry alone. Returns null — never a guess — when the confidence gate
 * is not met.
 */
export function inferBorderlessGrid(
  items: TableTextItem[],
  opts: BorderlessOpts = {},
): TableGrid | null {
  const lineTol = opts.lineTol ?? LINE_TOL;
  const minBand = opts.minBand ?? MIN_BAND_PT;
  const minLines = opts.minLines ?? MIN_LINES;
  const minSpanning = opts.minSpanningRatio ?? MIN_SPANNING_RATIO;

  const withText = items.filter(it => it.text.trim().length > 0);
  const lines = lineClusters(withText, lineTol);
  if (lines.length < minLines) return null;

  const bands = whitespaceBands(withText, minBand);
  if (!bands.length) return null; // one column — nothing tabular to report

  // Column boundaries: band midpoints, plus outer edges placed clear of the content so the synthetic
  // grid encloses every item (buildTableGrid assigns by the item's ORIGIN, and its outermost bounds
  // are inclusive since 753c639, but a margin keeps this independent of that detail).
  const minX = Math.min(...withText.map(it => it.x));
  const maxX = Math.max(...withText.map(itemRight));
  const colBounds = [minX - 1, ...bands.map(b => (b.lo + b.hi) / 2), maxX + 1];

  // THE DISCRIMINATOR: how many lines actually straddle a column boundary?
  const spanning = lines.filter((line) => {
    const hit = new Set<number>();
    for (const it of line) {
      for (let c = 0; c < colBounds.length - 1; c++) {
        if (it.x >= colBounds[c] && it.x <= colBounds[c + 1]) { hit.add(c); break; }
      }
    }
    return hit.size >= 2;
  }).length;
  if (spanning / lines.length < minSpanning) return null;

  // Row boundaries: midpoints between adjacent baselines (lines are top-first, so y descends), with an
  // outer margin above the first and below the last. Half the median line pitch keeps the outer bands
  // proportional to the type size instead of guessing an absolute.
  const baselines = lines.map(l => l[0].y);
  const pitches: number[] = [];
  for (let i = 1; i < baselines.length; i++) pitches.push(Math.abs(baselines[i - 1] - baselines[i]));
  pitches.sort((a, b) => a - b);
  const pad = (pitches[Math.floor(pitches.length / 2)] ?? 12) / 2;

  const rowBounds: number[] = [baselines[0] + pad];
  for (let i = 1; i < baselines.length; i++) rowBounds.push((baselines[i - 1] + baselines[i]) / 2);
  rowBounds.push(baselines[baselines.length - 1] - pad);

  // Hand the inferred boundaries over as synthetic zero-height rules. A tight tolerance because these
  // bounds are already exact — the default 3pt would merge two legitimately close boundaries.
  const hRules: RuleRect[] = rowBounds.map(y => ({ x: minX, y, width: maxX - minX, height: 0 }));
  const vRules: RuleRect[] = colBounds.map(x => ({ x, y: rowBounds[rowBounds.length - 1], width: 0, height: rowBounds[0] - rowBounds[rowBounds.length - 1] }));

  const grid = buildTableGrid(hRules, vRules, withText, 0.5, opts.cellText);
  if (!grid) return null;

  // FINAL GATE: is this tabular DATA, or is it prose that happens to align? See
  // MAX_MEDIAN_CELL_WORDS — measured, not tuned.
  const counts = grid.cells.flat()
    .map(c => c.trim())
    .filter(Boolean)
    .map(c => c.split(/\s+/).length)
    .sort((a, b) => a - b);
  if (!counts.length) return null;
  const median = counts[Math.floor(counts.length / 2)];
  if (median > (opts.maxMedianCellWords ?? MAX_MEDIAN_CELL_WORDS)) return null;

  return grid;
}

/**
 * Share of LETTERED cells at or above which a grid is read as a book INDEX: an index entry is a term followed by the
 * pages it appears on (`Refunds 18`, `Tax 100 , 104`), and a page of them flows in 3–4 aligned columns that pass every
 * geometric gate above. Measured on the C9 corpus (limits row 20): 0.52–0.62 on all 9 index pages of Publication 17,
 * at most 0.05 on every genuine table (the 1099-MISC box grids, the W-4 wage table, a Pub 17 rate worksheet).
 */
export const INDEX_ENTRY_SHARE = 0.3;
/**
 * Share of non-empty ROWS carrying a dot leader (`. . . .`) at or above which a grid is read as a table of CONTENTS.
 * Measured: 0.47 on the corpus's contents page, 0 on every other firing.
 */
export const LEADER_ROW_SHARE = 0.2;

const INDEX_ENTRY = /[A-Za-z][^\t]*?\s\d{1,4}(\s*[,-]\s*\d{1,4})*\s*$/;
const DOT_LEADER = /(\.\s?){4,}/;

/**
 * Why a geometric grid is a list LAYOUT rather than a table, or null when it reads as a table. The two genres the C9
 * corpus found passing every geometric gate: an index (`'index'`) and a table of contents (`'contents'`) — short
 * entries in aligned columns are geometrically a table, so the refusal reads what the cells SAY. Pure.
 */
export function listLayoutGenre(grid: TableGrid): 'index' | 'contents' | null {
  const cells = grid.cells.flat().map(c => c.trim()).filter(Boolean);
  const lettered = cells.filter(c => /[A-Za-z]/.test(c));
  if (lettered.length && lettered.filter(c => INDEX_ENTRY.test(c)).length / lettered.length >= INDEX_ENTRY_SHARE) return 'index';
  const rows = grid.cells.filter(r => r.some(c => c.trim()));
  if (rows.length && rows.filter(r => DOT_LEADER.test(r.join(' '))).length / rows.length >= LEADER_ROW_SHARE) return 'contents';
  return null;
}

/**
 * The gate for the Word / Markdown / text flow (C9, limits row 20): {@link inferBorderlessGrid} plus
 * {@link listLayoutGenre}. Stricter than the CSV/XLSX gate on purpose — there the user asked for a table and a wrong
 * answer costs one discardable file, while in the flow a table REMOVES its words from the paragraphs, so a phantom
 * one turns an index into a grid of unrelated cells.
 */
export function inferBorderlessGridForFlow(items: TableTextItem[], opts: BorderlessOpts = {}): TableGrid | null {
  const grid = inferBorderlessGrid(items, opts);
  return grid && !listLayoutGenre(grid) ? grid : null;
}

