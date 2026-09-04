/**
 * FlowDoc — intermediate flow-document model reconstructed from positioned
 * PDF text runs (pdf.js getTextContent items).
 *
 * PDF is fixed-layout: glyphs painted at coordinates, no paragraph/heading/
 * reading-order semantics (unless the PDF is tagged — ~15% of real PDFs).
 * This module infers flow structure heuristically, using the tolerance
 * recipes established by pdfminer.six and pdf2docx (MIT since v0.5.13):
 * all thresholds are relative to font size, never absolute points.
 *
 * The FlowDoc model is the single source for every flow-format writer
 * (DOCX / Markdown / TXT — see flowDocWriters.ts).
 */

import { redactionRectToPageSpace } from './geometry';
import { buildTableGrid, clusterPositions, type TableGrid, type TableTextItem } from './tableExtract';
import { visualToLogical } from './bidi';

/** Shape of a pdf.js TextItem (subset we consume). */
export interface RawTextItem {
  str: string;
  dir: string; // 'ltr' | 'rtl' | 'ttb'
  transform: number[]; // [a, b, c, d, e, f] — e,f = baseline origin, y-up
  width: number;
  height: number;
  fontName: string; // pdf.js internal font id (e.g. 'g_d0_f1')
  hasEOL: boolean;
}

/** Resolved font info per pdf.js internal font id. */
export interface FontInfo {
  /** Real (PostScript) font name, e.g. 'Arial-BoldMT' — used for bold/italic sniffing. */
  name: string;
  /** CSS fallback family from pdf.js styles ('serif' | 'sans-serif' | 'monospace'). */
  family?: string;
}
export type FontInfoMap = Record<string, FontInfo>;

export interface FlowRun {
  text: string;
  bold: boolean;
  italic: boolean;
  fontSize: number;
  fontFamily: 'serif' | 'sans-serif' | 'monospace';
  rtl: boolean;
  /** PostScript font name extracted from the pdf.js internal id (used in merge key). */
  psName?: string;
  /** Hex fill color without '#' (e.g. 'FF0000' for red). Undefined = default/black. */
  color?: string;
  /** External URL when this run sits under a Link annotation (→ DOCX/MD hyperlink). */
  linkUrl?: string;
  /** Vertical alignment for super/subscript glyphs (smaller + baseline-offset). */
  vertAlign?: 'super' | 'sub';
  /** Set when a thin rule sits at this run's baseline (→ DOCX underline). */
  underline?: boolean;
  /** Set when a thin rule crosses this run's x-height (→ DOCX strikethrough). */
  strikethrough?: boolean;
}

/**
 * A thin graphic rule (filled/stroked path) in PDF user space (y-up), collected
 * from the export op-walk and matched against text runs to detect underlines and
 * strikethroughs. `y` is the bottom edge; height 0 is a pure horizontal stroke.
 */
export interface RuleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Classify a thin rule against a text run's baseline (all in PDF user space,
 * y-up). Returns 'underline' (rule sits at/just below the baseline), 'strikethrough'
 * (rule crosses mid x-height), or null (shading block, vertical bar, separator far
 * from the text, or insufficient horizontal overlap). Pure → jsdom-unit-testable.
 */
export function classifyRuleAsUnderline(
  rule: RuleRect,
  run: { x: number; y: number; width: number; size: number },
): 'underline' | 'strikethrough' | null {
  if (run.size <= 0 || run.width <= 0) return null;
  // Reject shading blocks (too tall relative to the font) and vertical bars.
  if (rule.height > 0.18 * run.size) return null;
  if (rule.width <= rule.height * 3 || rule.width <= 2) return null;
  // Require the rule to cover at least half of the run horizontally.
  const overlap = Math.min(rule.x + rule.width, run.x + run.width) - Math.max(rule.x, run.x);
  if (overlap < 0.5 * run.width) return null;
  // Vertical band relative to the baseline (positive dy = above the baseline).
  const dy = (rule.y + rule.height / 2 - run.y) / run.size;
  if (dy >= -0.35 && dy <= 0.1) return 'underline';
  if (dy >= 0.18 && dy <= 0.62) return 'strikethrough';
  return null;
}

/**
 * A Link annotation rectangle in PDF user space (y-up), used to tag words that
 * fall under it so the export carries a real hyperlink. Built from
 * `page.getAnnotations()` (subtype 'Link' with a `url`) in exportService.
 */
export interface FlowLinkRect {
  url: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FlowParagraph {
  runs: FlowRun[];
  /** 0 = body, 1–6 = heading level (assigned document-wide by assignHeadings). */
  heading: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  alignment: 'left' | 'center' | 'right' | 'justify';
  rtl: boolean;
  /** Set when the paragraph opens a list item; prefix marker stripped from first run. */
  listType?: 'bullet' | 'ordered';
  /** Nesting depth of the list item (0 = top-level). */
  listDepth?: number;
  /** Ordered-list marker number format (decimal / lower-alpha / upper-alpha). */
  listFormat?: ListFormat;
  /** Ordered-list docx level-text template, e.g. '%1.', '%1)', '(%1)'. */
  listOrdinalText?: string;
  /** Left indent of the whole block relative to its column, in PDF points (>0 when inset). */
  indentLeft?: number;
  /** First-line-only indent relative to the block left, in PDF points (>0 when inset). */
  indentFirstLine?: number;
  /** Inter-line leading (baseline gap) within the paragraph, in PDF points. */
  lineHeight?: number;
  /** Vertical gap before this paragraph (from the previous one), in PDF points. */
  spaceBefore?: number;
  /** Vertical gap after this paragraph (to the next one), in PDF points. */
  spaceAfter?: number;
  /**
   * Top y of the paragraph's first line in PDF user space (y-up), recorded so the
   * DOCX writer can interleave paragraphs with detected tables in reading order
   * (top-of-page first). Optional: undefined on paragraphs built outside the
   * page-reconstruction path (overlay text), where order falls back to insertion.
   */
  y?: number;
}

/**
 * A lattice (ruled) table detected on a page: a grid bounded by visible grid
 * lines on BOTH axes (≥2 horizontal + ≥2 vertical rules). `y` is the top edge in
 * PDF user space (y-up) — used to interleave the table with paragraphs in reading
 * order. Borderless tables are NOT detected (documented structural ceiling).
 */
export interface FlowTable {
  grid: TableGrid;
  /** Top edge of the table region in PDF user space (y-up). */
  y: number;
}

export interface FlowImage {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Raw image data as base64 (no data-URL prefix). */
  base64: string;
  mimeType: 'image/png' | 'image/jpeg';
  /** Clockwise rotation in degrees [0,360); only set when meaningfully non-zero. */
  rotation?: number;
}

/** Scale + rotation extracted from an image-draw CTM (see {@link decomposeImageCtm}). */
export interface DecomposedCtm {
  /** Horizontal scale magnitude (≈ on-page width in points for an image XObject). */
  scaleX: number;
  /** Vertical scale magnitude (≈ on-page height in points for an image XObject). */
  scaleY: number;
  /** Clockwise rotation in degrees, normalized to [0,360). */
  rotation: number;
}

/**
 * Decompose a 2D affine CTM `[a,b,c,d,e,f]` into positive scale magnitudes and a
 * rotation angle. pdf.js folds an image's scale and rotation into `[a,b,c,d]`;
 * `[e,f]` is translation and does not affect scale/rotation.
 *
 * `scaleX = hypot(a,b)`, `scaleY = hypot(c,d)`, `rotation = atan2(b,a)` (the
 * first basis vector's angle), normalized to [0,360). Scales are returned as
 * magnitudes (a flipped/negative-determinant image still reports positive size);
 * pure shear is not modelled (Word can't render it) and collapses into the scales.
 */
export function decomposeImageCtm(
  ctm: readonly [number, number, number, number, number, number],
): DecomposedCtm {
  const [a, b, c, d] = ctm;
  const scaleX = Math.hypot(a, b);
  const scaleY = Math.hypot(c, d);
  const rotation = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { scaleX, scaleY, rotation };
}

/**
 * Choose the DOCX image encoding for an extracted raster (Gap 7 — PNG bloat).
 *
 * Every extracted image used to be re-encoded as lossless PNG, turning a
 * full-page scanned photo into a multi-MB entry. JPEG is far smaller for
 * photographic content, but it cannot carry transparency — so:
 *  - any image with an alpha channel stays PNG (a JPEG would flatten the mask);
 *  - large opaque rasters (≥ 200×200 px, photographic scale) become JPEG;
 *  - small / flat / line-art images stay PNG to keep crisp edges and icons sharp.
 */
export function pickImageMime(opts: {
  width: number;
  height: number;
  hasAlpha: boolean;
}): 'image/png' | 'image/jpeg' {
  if (opts.hasAlpha) return 'image/png';
  if (opts.width * opts.height >= 200 * 200) return 'image/jpeg';
  return 'image/png';
}

/** Page margins (text-block inset from each edge), in PDF points. */
export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FlowPage {
  width: number;
  height: number;
  paragraphs: FlowParagraph[];
  /** Embedded raster images extracted from the PDF page (populated by exportService). */
  images?: FlowImage[];
  /** Text-block bounding-box margins (PDF points), derived from the main body block. */
  margins?: PageMargins;
  /**
   * Lattice (ruled) tables detected on this page, top-to-bottom. Present only when
   * the page has at least one both-axes-ruled grid; absent pages keep the existing
   * paragraph-only output byte-identical. The text consumed by these tables is
   * excluded from {@link paragraphs} (dedup).
   */
  tables?: FlowTable[];
  /**
   * B1 — set when this page's paragraphs/tables were derived from a tagged-PDF
   * struct tree (exact reading order + tag-given heading/list/table structure).
   * {@link assignHeadings} skips tagged pages so the heuristic size pass does not
   * clobber the tag-derived levels. Writers ignore this flag.
   */
  tagged?: boolean;
}

/** A flattened PDF outline (bookmark) entry: title + 1-based nesting level. */
export interface FlowOutlineItem {
  title: string;
  level: number;
}

export interface FlowDoc {
  pages: FlowPage[];
  /**
   * B3 — the source PDF's document outline (bookmarks), flattened. Present only
   * when the source carries a non-empty outline; the DOCX writer then emits a Word
   * Table-of-Contents field (referencing the detected headings). Absent → no TOC →
   * byte-identical export.
   */
  outline?: FlowOutlineItem[];
  /** B5 — running header text hoisted from a repeated top-band paragraph (Word Header). */
  header?: string;
  /** B5 — running footer text hoisted from a repeated bottom-band paragraph (Word Footer). */
  footer?: string;
}

/**
 * B3 — flatten pdf.js's nested `getOutline()` tree into `{title, level}[]` in
 * document order, 1-based level. Whitespace-only titles are skipped (their
 * children are still recursed, one level deeper). Pure → jsdom-testable.
 */
interface RawOutlineNode { title?: string; items?: RawOutlineNode[] }
export function flattenOutline(raw: RawOutlineNode[], level = 1): FlowOutlineItem[] {
  const out: FlowOutlineItem[] = [];
  for (const node of raw ?? []) {
    const title = (node.title ?? '').trim();
    if (title) out.push({ title, level });
    if (node.items?.length) out.push(...flattenOutline(node.items, level + 1));
  }
  return out;
}

/**
 * A redaction rectangle in editor/element coordinate space: page-point units,
 * TOP-LEFT origin (y grows downward) — the same space `el.x/el.y/el.width/el.height`
 * live in (see exportPipeline.rasterizePageWithRedactions, which fills
 * `ctx.fillRect(el.x*SCALE, el.y*SCALE, ...)` on a viewport-sized canvas).
 */
export interface RedactionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * The redaction element's OWN rotation in degrees, about its centre (WS4-B). Carried so that
   * `redactionRectToPageSpace` / `redactionRectToContent` can widen the rect to the footprint the
   * burn actually covers — a rotated rectangle protrudes from its upright box, and content under
   * those parts was burned yet left extractable. Absent → identity.
   */
  rotation?: number;
}

/**
 * True when a source text item's bounding box intersects a redaction rectangle.
 *
 * Coordinate bridge: text items are in PDF space (y-up, baseline at transform[5]);
 * redaction rects are in editor space (y-down, top-left origin). We convert the
 * glyph box into top-origin space and test for axis-aligned rectangle overlap.
 * Any intersection (not full containment) redacts the item — partial overlap of a
 * word still means part of it sits under the box, so it must not leak.
 */
/**
 * Does a text item's glyph box intersect a redaction rect?
 *
 * BOTH arguments must be expressed in the SAME frame, and that frame is the one
 * {@link redactionRectToPageSpace} produces: `red.x` in ABSOLUTE user space, `red.y` measured
 * DOWN from the crop box's top edge. `pageTopY` is the y-up user-space coordinate of that top
 * edge — i.e. `viewBox[3]`. On a `/CropBox [0 0 w h]` page that equals the page height, which is
 * why passing the height was correct right up until a page with a non-zero CropBox origin
 * appeared, and then silently matched nothing.
 */
export function isItemRedacted(item: RawTextItem, red: RedactionRect, pageTopY: number): boolean {
  const [a, b, c, d, e, f] = item.transform;
  const size = Math.hypot(a, b) || Math.abs(item.height) || 12;

  // The run's footprint comes from the TRANSFORM, not from `+x`. pdf.js's TextItem box is `width`
  // along the transform's FIRST column and `height` along its SECOND — read from
  // `pdf.worker.mjs:35812-35821`, where `if (!font.vertical)` sets `width = 0` and
  // `height = hypot(trm[2],trm[3])` (the glyph size) and then ACCUMULATES the advance into
  // `totalWidth`; for vertical writing the two roles swap. Transforming those four corners is what
  // makes a rotated Tm work: extending `+x` by `|width|` tested a box DISJOINT from the glyphs of
  // any sideways run, and this one predicate feeds the heuristic flow, the struct-tree flow and the
  // table extractor, so the leak reached DOCX, Markdown, TXT, CSV and XLSX at every page rotation
  // including 0. [WS5 P0, 2026-09-04]
  //
  // **`height` is NOT zero for horizontal text — it is the font size**, measured:
  // `{str:"1", width:6.672, height:12, transform:[12,0,0,12,100,300]}`. A first version of this fix
  // took `max(|width|,|height|)` as the advance on the strength of an inverted reading of those
  // lines, which inflated every SHORT run to a full em and silently deleted text that was clear of
  // the burn — the over-drop direction this file grades as harmful. Caught by the WS7 panel.
  // [WS7 round 1, 2026-09-04]
  const col1 = Math.hypot(a, b) || 1;
  const col2 = Math.hypot(c, d) || 1;
  const extent1 = Math.abs(item.width);
  const extent2 = Math.abs(item.height) || Math.hypot(c, d) || size;
  const ux = (a / col1) * extent1, uy = (b / col1) * extent1;
  // The box spans the DESCENDER as well as the ascender. pdf.js reports the item from its BASELINE,
  // so `[baseline, baseline+size]` stops where the descenders of g, j, p, q, y begin — and a
  // redaction covering only below the baseline left the whole run in the flow exports while
  // `SECURITY.md` said horizontal text was covered. 0.25em is a deliberate over-approximation: for
  // a LEAK filter the footprint may only grow, and no font metric is available here. It costs a
  // quarter-em of extra drop below a redacted line. [WS7 round 3, 2026-09-04]
  const desc = 0.25 * extent2;
  const vxLo = (c / col2) * -desc, vyLo = (d / col2) * -desc;
  const vxHi = (c / col2) * extent2, vyHi = (d / col2) * extent2;
  const xs = [e + vxLo, e + ux + vxLo, e + ux + vxHi, e + vxHi];
  const ys = [f + vyLo, f + uy + vyLo, f + uy + vyHi, f + vyHi];
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  // Convert to top-origin (y-down) space: topY is the box top, botY the box bottom.
  const topY = pageTopY - Math.max(...ys);
  const botY = pageTopY - Math.min(...ys);
  const redLeft = red.x;
  const redRight = red.x + red.width;
  const redTop = red.y;
  const redBottom = red.y + red.height;
  const overlapX = x0 < redRight && x1 > redLeft;
  const overlapY = topY < redBottom && botY > redTop;
  return overlapX && overlapY;
}

// ── Internal working shapes ─────────────────────────────────────────────

export interface Word {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  fontName: string;
  rtl: boolean;
  color?: string;
  linkUrl?: string;
  underline?: boolean;
  strikethrough?: boolean;
}

export interface Line {
  words: Word[];
  y: number;
  size: number; // dominant font size on the line
  x0: number;
  x1: number;
  rtl?: boolean; // line reads right-to-left (majority rtl words)
}

// Same line when baselines are within half the font size (pdfminer.six recipe).
const LINE_Y_TOL = 0.5;
// Insert a space when the horizontal gap exceeds this fraction of the font size.
const SPACE_GAP = 0.15;
// New paragraph when the baseline gap exceeds this multiple of the font size
// (normal leading is ~1.15–1.35× the size).
const PARA_GAP = 1.6;
// A heading size must exceed the body size by this ratio.
const HEADING_RATIO = 1.15;

function isBoldName(name: string): boolean {
  return /(bold|black|heavy|semibold|demibold)/i.test(name);
}
function isItalicName(name: string): boolean {
  return /(italic|oblique)/i.test(name);
}
function familyOf(info: FontInfo | undefined): FlowRun['fontFamily'] {
  const f = info?.family ?? '';
  if (f.includes('serif') && !f.includes('sans')) return 'serif';
  if (f.includes('mono')) return 'monospace';
  return 'sans-serif';
}

/**
 * Extract the PostScript name from a pdf.js internal font id.
 * Ids like 'g_d0_ABCDEF+Arial-BoldMT' become 'Arial-BoldMT'.
 * Ids without a '+' prefix are returned as-is.
 */
export function extractPsName(internalId: string): string {
  const m = internalId.match(/\+(.+)$/);
  return m ? m[1] : internalId;
}

/**
 * Detect a vertical whitespace gap that divides words into two side-by-side columns.
 * Returns the x-midpoint of the best gap found, or null if no column split is detected.
 *
 * Words are expressed as `{ x, width, y? }` so the function is pure and testable.
 * Three conditions must all hold:
 *   1. At least 4 words in the input.
 *   2. At least 2 distinct baselines — gaps between words on a single line are NOT column gaps.
 *   3. The best gap lies in the inner 20–80% zone, is ≥ 5% of page width, and has words on both sides.
 */
export function detectColumnSplit(
  words: ReadonlyArray<{ x: number; width: number; y?: number }>,
  pageWidth: number,
  // B6: restrict the gutter search to a sub-column region [min,max]. Default
  // {0,pageWidth} → byte-identical to the original full-page single cut. The
  // inner-20–80% zone and the 5%-min-gap threshold are taken relative to the
  // region width, so recursion on a narrower column scales correctly.
  bounds: { min: number; max: number } = { min: 0, max: pageWidth },
): number | null {
  if (words.length < 4) return null;

  // Require ≥ 2 distinct y-baselines: inter-word gaps on a single line are not column separators.
  const ySet = new Set(words.map(w => Math.round(w.y ?? 0)));
  if (ySet.size < 2) return null;

  const BIN = 2; // 2pt bins — fine enough for column detection
  const bins = Math.ceil(pageWidth / BIN);
  const covered = new Uint8Array(bins);
  for (const w of words) {
    const s = Math.max(0, Math.floor(w.x / BIN));
    const e = Math.min(bins - 1, Math.ceil((w.x + w.width) / BIN));
    for (let i = s; i <= e; i++) covered[i] = 1;
  }
  const regionW = bounds.max - bounds.min;
  // Search only in the inner 20–80% zone (of the region) to avoid margin false positives.
  const left = Math.floor((bounds.min + regionW * 0.2) / BIN);
  const right = Math.ceil((bounds.min + regionW * 0.8) / BIN);
  let bestLen = 0, bestMid = -1, gapStart = -1;
  for (let i = left; i <= right; i++) {
    if (covered[i] === 0) {
      if (gapStart === -1) gapStart = i;
    } else if (gapStart !== -1) {
      const len = i - gapStart;
      if (len > bestLen) { bestLen = len; bestMid = Math.round((gapStart + i - 1) / 2) * BIN; }
      gapStart = -1;
    }
  }
  if (gapStart !== -1) {
    const len = right - gapStart + 1;
    if (len > bestLen) { bestLen = len; bestMid = Math.round((gapStart + right) / 2) * BIN; }
  }
  if (bestLen * BIN < regionW * 0.05) return null;

  // Require words on both sides of the split — a gap with nothing on one side is a margin, not a column.
  const leftCount = words.filter(w => w.x + w.width / 2 < bestMid).length;
  const rightCount = words.filter(w => w.x + w.width / 2 >= bestMid).length;
  return leftCount > 0 && rightCount > 0 ? bestMid : null;
}

/** Depth cap for recursive column splitting: depth-0 cut + one further cut per
 * half → up to ~4 columns (covers the common 3-column case). Higher depths
 * over-split magazine layouts, so we stop here. */
const COLUMN_MAX_DEPTH = 2;

/**
 * B6 — recursively split words into columns in left-to-right reading order.
 * Applies {@link detectColumnSplit} to each region; a region that yields no
 * clean gutter (or the depth cap) becomes one column group. A 1- or 2-column
 * page returns exactly what the prior single-cut path did (the depth-0 cut is
 * byte-identical with the default bounds), so output is unchanged unless a
 * genuine additional gutter exists. Pure → jsdom-testable.
 */
export function splitColumns<T extends { x: number; width: number; y?: number }>(
  words: T[],
  pageWidth: number,
  bounds: { min: number; max: number } = { min: 0, max: pageWidth },
  depth = 0,
): T[][] {
  const split = depth < COLUMN_MAX_DEPTH ? detectColumnSplit(words, pageWidth, bounds) : null;
  if (split === null) return [words];
  const leftWords = words.filter(w => w.x + w.width / 2 < split);
  const rightWords = words.filter(w => w.x + w.width / 2 >= split);
  return [
    ...splitColumns(leftWords, pageWidth, { min: bounds.min, max: split }, depth + 1),
    ...splitColumns(rightWords, pageWidth, { min: split, max: bounds.max }, depth + 1),
  ];
}

/**
 * B5 — detect a running header/footer: a paragraph that recurs in the top
 * (header) or bottom (footer) y-band across most pages. Returns the
 * representative text to hoist into a Word Header/Footer, or {} if none.
 *
 * Conservative on purpose (the no-false-positive guard — hoisting genuine body
 * text would DELETE content): needs ≥3 pages, ≥60% recurrence, a tight band
 * (top/bottom 12%), and digit-normalized matching so per-page page numbers still
 * collapse to one band. Pure → jsdom-testable.
 */
const _BAND_HEADER = 0.88, _BAND_FOOTER = 0.12, _BAND_MIN_FRAC = 0.6;
const _normBand = (s: string) => s.normalize('NFKC').replace(/\d+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const _inHeaderBand = (y: number, h: number) => y >= h * _BAND_HEADER;
const _inFooterBand = (y: number, h: number) => y <= h * _BAND_FOOTER;
const _paraText = (par: FlowParagraph) => par.runs.map(r => r.text).join('');

export function detectRepeatedBands(pages: FlowPage[]): { header?: string; footer?: string } {
  if (pages.length < 3) return {};
  const need = Math.ceil(pages.length * _BAND_MIN_FRAC);
  const norm = _normBand;
  const scan = (inBand: (y: number, h: number) => boolean, isMoreExtreme: (y: number, best: number) => boolean): string | undefined => {
    const counts = new Map<string, number>();
    const repr = new Map<string, string>();
    for (const p of pages) {
      let best: FlowParagraph | undefined;
      for (const par of p.paragraphs) {
        if (par.y === undefined || !inBand(par.y, p.height)) continue;
        if (!best || isMoreExtreme(par.y, best.y ?? 0)) best = par;
      }
      if (!best) continue;
      const text = _paraText(best);
      const key = norm(text);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!repr.has(key)) repr.set(key, text);
    }
    let bestKey: string | undefined, bestN = 0;
    for (const [k, n] of counts) if (n >= need && n > bestN) { bestKey = k; bestN = n; }
    return bestKey ? repr.get(bestKey) : undefined;
  };
  const header = scan(_inHeaderBand, (y, b) => y > b); // topmost
  const footer = scan(_inFooterBand, (y, b) => y < b); // bottommost
  const res: { header?: string; footer?: string } = {};
  if (header) res.header = header;
  if (footer) res.footer = footer;
  return res;
}

/**
 * B5 — detect running header/footer (via {@link detectRepeatedBands}), set
 * `doc.header`/`doc.footer`, AND remove the hoisted band paragraph from each page
 * so it is not also repeated inline. Mutates `doc`. No band found → no-op →
 * byte-identical export. Only the band paragraph whose normalized text matches the
 * detected header/footer is removed (minimal scope — never touches body text).
 */
export function applyRepeatedBands(doc: FlowDoc): void {
  const bands = detectRepeatedBands(doc.pages);
  if (!bands.header && !bands.footer) return;
  const hKey = bands.header ? _normBand(bands.header) : null;
  const fKey = bands.footer ? _normBand(bands.footer) : null;
  if (bands.header) doc.header = bands.header;
  if (bands.footer) doc.footer = bands.footer;
  for (const p of doc.pages) {
    p.paragraphs = p.paragraphs.filter(par => {
      if (par.y === undefined) return true;
      const key = _normBand(_paraText(par));
      if (hKey && key === hKey && _inHeaderBand(par.y, p.height)) return false;
      if (fKey && key === fKey && _inFooterBand(par.y, p.height)) return false;
      return true;
    });
  }
}

// Matches leading list markers: unambiguous unicode bullets or dash/asterisk, then whitespace.
const _BULLET_RE = /^[•◦▪●○→►▸-]\s+/;

/** docx LevelFormat for an ordered marker. */
export type ListFormat = 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman';

// Strict roman-numeral validator (case-insensitive caller). Rejects empty and
// malformed sequences like "iiii"/"vx" so only true romans become roman lists.
const _ROMAN_RE = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;
/** A roman numeral of length ≥2 — unambiguous vs a single-letter marker. */
function isMultiCharRoman(s: string): boolean {
  return s.length >= 2 && _ROMAN_RE.test(s.toLowerCase());
}

// Ordered markers. Each entry pairs a regex with a docx LevelFormat + level-text
// template ('%1' is the ordinal). Letter markers are matched ONLY in a paren
// form (`a)`, `(a)`) — NEVER bare-dot (`a.`, `A.`, `I.`) — to avoid author-initial
// ("A. Smith") and sentence-start false positives. Roman is intentionally not
// distinguished from letters (ambiguous per-paragraph); a parenthesized single
// letter maps to lowerLetter/upperLetter. Order: parenthesized before close-paren
// (disjoint anyway), decimal before alpha.
const _ORDERED_MARKERS: { re: RegExp; format: ListFormat; ordinalText: string }[] = [
  { re: /^(\d+)\.\s+/,    format: 'decimal',     ordinalText: '%1.'  }, // 1.
  { re: /^(\d+)\)\s+/,    format: 'decimal',     ordinalText: '%1)'  }, // 1)
  { re: /^\((\d+)\)\s+/,  format: 'decimal',     ordinalText: '(%1)' }, // (1)
  { re: /^\(([a-z])\)\s+/, format: 'lowerLetter', ordinalText: '(%1)' }, // (a)
  { re: /^([a-z])\)\s+/,  format: 'lowerLetter', ordinalText: '%1)'  }, // a)
  { re: /^\(([A-Z])\)\s+/, format: 'upperLetter', ordinalText: '(%1)' }, // (A)
  { re: /^([A-Z])\)\s+/,  format: 'upperLetter', ordinalText: '%1)'  }, // A)
];

/**
 * Detect and strip a list prefix from the start of a paragraph's text.
 * Returns `{ type, stripped, format?, ordinalText? }` when a prefix is found
 * (format/ordinalText set only for ordered markers), or null otherwise.
 */
export function detectListPrefix(
  text: string,
): { type: 'bullet' | 'ordered'; stripped: string; format?: ListFormat; ordinalText?: string } | null {
  const bm = _BULLET_RE.exec(text);
  if (bm) return { type: 'bullet', stripped: text.slice(bm[0].length) };
  // Multi-char parenthesized roman (`(ii)`, `iv)`, `(III)`) — matched BEFORE the
  // single-letter markers so it wins, but only for length ≥2 valid romans so a
  // single `(i)`/`(I)` stays an (ambiguous) letter marker, never roman.
  const romanParen = /^\(([a-zA-Z]+)\)\s+/.exec(text) ?? /^([a-zA-Z]+)\)\s+/.exec(text);
  if (romanParen && isMultiCharRoman(romanParen[1])) {
    const isUpper = romanParen[1] === romanParen[1].toUpperCase();
    const hasOpenParen = text.startsWith('(');
    return {
      type: 'ordered',
      stripped: text.slice(romanParen[0].length),
      format: isUpper ? 'upperRoman' : 'lowerRoman',
      ordinalText: hasOpenParen ? '(%1)' : '%1)',
    };
  }
  for (const { re, format, ordinalText } of _ORDERED_MARKERS) {
    const m = re.exec(text);
    if (m) return { type: 'ordered', stripped: text.slice(m[0].length), format, ordinalText };
  }
  return null;
}

/** Unicode ranges that are Arabic script (block, supplement, extended-A, presentation forms). */
const _ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/** True when the string contains any Arabic-script codepoint. */
export function isArabicText(s: string): boolean {
  return _ARABIC_RE.test(s);
}

/**
 * B7 — expand the Latin presentation-form ligatures (U+FB00–U+FB06: ﬀ ﬁ ﬂ ﬃ ﬄ
 * ﬅ ﬆ) that many PDFs encode as single glyphs back to their ASCII letters, so the
 * DOCX renders normally and word-search matches ("file", not "ﬁle").
 *
 * Deliberately a TARGETED map, NOT `normalize('NFKC')`: blanket NFKC also folds
 * CJK full-width forms, superscript/subscript digits, and other compatibility
 * characters we must NOT alter on the Latin path. A string with no FB0x codepoint
 * is returned byte-identical (the byte-identical-when-inactive invariant). The
 * long-s ligatures (ﬅ/ﬆ) fold to "st" for searchability rather than the strict
 * U+017F long-s NFKC form.
 */
const _LATIN_LIGATURES: Record<string, string> = {
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl',
  'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st',
};
export function foldLatinLigatures(s: string): string {
  // Fast path: no Latin-ligature codepoint → return the original reference.
  if (!/[ﬀ-ﬆ]/.test(s)) return s;
  return s.replace(/[ﬀ-ﬆ]/g, m => _LATIN_LIGATURES[m]);
}

/**
 * Reverse a string by codepoint (surrogate-pair-safe) and NFKC-normalize the
 * result. pdf.js returns RTL runs already visually reversed; reversing again
 * restores logical character order so Word's bidi engine can lay it out
 * correctly. (Combining-mark reordering is an accepted edge-case limitation —
 * see the Arabic-export ceiling notes.)
 *
 * NFKC runs AFTER the reversal (not before): many PDFs encode Arabic as Unicode
 * PRESENTATION FORMS (U+FB50–FDFF / U+FE70–FEFF — pre-shaped isolated/initial/
 * medial/final glyphs). Emitted verbatim into DOCX/MD they render disconnected
 * because Word shapes base letters, not pre-shaped forms. NFKC folds each
 * presentation form to its base letter (and expands ligatures like U+FEFB
 * lam-alef → ل + ا). Doing it after the per-codepoint reversal keeps a ligature's
 * internal logical order correct (one visual unit → expands in place).
 */
export function reverseRtlText(s: string): string {
  // A genuinely MIXED-script word (Arabic + Latin/digits) gets char-level bidi so an
  // embedded multi-char Latin/number sub-run stays in logical (forward) order; a
  // single-script word keeps the established simple visual→logical char reversal.
  if (isArabicText(s) && /[A-Za-z0-9]/.test(s)) {
    return visualToLogical(s, 'rtl').normalize('NFKC');
  }
  return [...s].reverse().join('').normalize('NFKC');
}

/**
 * Order one line's words into LOGICAL reading order and restore logical character
 * order for RTL runs. A line is RTL when the majority of its words are rtl.
 *
 * For an RTL-base line this applies the UAX#9 L2 reorder at WORD granularity:
 * lay words out visually (ascending x), split into maximal same-direction runs,
 * then emit runs right-to-left — RTL runs reversed (and each word char-reversed
 * back to logical), but each embedded LTR run kept in forward (ascending-x) order.
 * That fixes the mixed-line bug where a Latin/number run inside Arabic (e.g.
 * "PDF" in "… PDF …") was previously order-reversed by the blanket descending-x
 * sort (AR-1). LTR lines keep ascending-x, text untouched. Pure → jsdom-testable.
 *
 * Word-level only: deeper char-level bidi (digits nested in RTL, multi-level
 * embeddings, a single token mixing scripts) remains a documented partial.
 */
export function orderLineWords<T extends { x: number; width: number; rtl: boolean; text: string }>(
  words: T[],
): { words: T[]; rtl: boolean } {
  const rtlCount = words.reduce((n, x) => n + (x.rtl ? 1 : 0), 0);
  const rtl = words.length > 0 && rtlCount * 2 > words.length;
  if (!rtl) {
    return { words: [...words].sort((a, b) => a.x - b.x), rtl: false };
  }
  const visual = [...words].sort((a, b) => a.x - b.x); // page left→right
  const runs: T[][] = [];
  for (const word of visual) {
    const last = runs[runs.length - 1];
    if (last && last[0].rtl === word.rtl) last.push(word);
    else runs.push([word]);
  }
  const out: T[] = [];
  for (let s = runs.length - 1; s >= 0; s--) {
    const run = runs[s];
    if (run[0].rtl) {
      for (let i = run.length - 1; i >= 0; i--) out.push({ ...run[i], text: reverseRtlText(run[i].text) });
    } else {
      for (const word of run) out.push(word); // embedded LTR run stays forward
    }
  }
  return { words: out, rtl: true };
}

/** Geometry kept alongside each built paragraph for the continuation-merge pass. */
interface ParaGeom { x0: number; lines: number; size: number }

/** Indent tolerance for a given font size: half a font size, but ≥ 2pt. */
function indentTolerance(size: number): number {
  return Math.max(2, size * 0.5);
}

/**
 * Stage 1 — cluster words into lines by baseline (top of page first: y desc),
 * then order each line for reading (restoring logical char order on RTL lines)
 * and finalize its x0/x1/dominant size. Mutates `words` order (sorts in place).
 */
export function clusterWordsIntoLines(words: Word[]): Line[] {
  words.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const w of words) {
    const line = lines[lines.length - 1];
    let joins = false;
    if (line) {
      const baselineClose = Math.abs(line.y - w.y) <= LINE_Y_TOL * Math.min(line.size, w.size);
      // Super/subscript: a MUCH smaller glyph whose box vertically overlaps the
      // line's body box stays on the line (its baseline is offset past the normal
      // tolerance). Gated on a real size disparity so two equal body lines that
      // merely graze each other never merge.
      const overlap = Math.min(line.y + line.size, w.y + w.size) - Math.max(line.y, w.y);
      const smaller = Math.min(line.size, w.size);
      const overlapClose =
        smaller < 0.85 * Math.max(line.size, w.size) && overlap > 0.3 * smaller;
      joins = baselineClose || overlapClose;
    }
    if (line && joins) {
      line.words.push(w);
      // Track the dominant (largest) glyph as the line's reference baseline/size
      // so super/subscript detection compares against the body text, not a
      // super/subscript that happened to be encountered first.
      if (w.size > line.size) { line.size = w.size; line.y = w.y; }
    } else {
      lines.push({ words: [w], y: w.y, size: w.size, x0: w.x, x1: w.x + w.width });
    }
  }
  for (const line of lines) {
    // Order words for reading + restore logical char order on RTL lines (Arabic):
    // pdf.js delivers RTL visually-reversed, which Word would double-reverse.
    const ordered = orderLineWords(line.words);
    line.words = ordered.words;
    line.rtl = ordered.rtl;
    line.x0 = Math.min(...line.words.map(w => w.x));
    line.x1 = Math.max(...line.words.map(w => w.x + w.width));
    line.size = line.words.reduce((m, w) => (w.text.length > m.text.length ? w : m), line.words[0]).size;
  }
  return lines;
}

/** Stage 2 — group lines into paragraphs on baseline-gap or font-size jumps. */
export function groupLinesIntoParagraphs(lines: Line[]): Line[][] {
  const paraLines: Line[][] = [];
  for (const line of lines) {
    const current = paraLines[paraLines.length - 1];
    const prev = current?.[current.length - 1];
    const sameSizeBand = prev ? Math.abs(prev.size - line.size) < 1 : false;
    const closeEnough = prev ? prev.y - line.y <= PARA_GAP * Math.max(prev.size, line.size) : false;
    if (prev && sameSizeBand && closeEnough) {
      current.push(line);
    } else {
      paraLines.push([line]);
    }
  }
  return paraLines;
}

/**
 * Stage 3 — build one FlowParagraph from a line-group: merge same-style words
 * into runs, infer alignment/bidi/list type, and measure indent + spacing
 * relative to the column edges. Returns the paragraph plus its geometry.
 */
/**
 * Merge a line group's words into styled {@link FlowRun}s: per-word bold/italic/
 * family/size/color sniffing, super/subscript detection, gap→space insertion
 * (reading-order aware on RTL lines), and adjacent same-style coalescing; lines
 * are joined with a single space. Extracted from {@link buildParagraph} so the
 * tagged-PDF struct path ({@link structTreeToFlow}) reuses the identical run
 * quality. Pure → jsdom-testable.
 */
export function buildRunsFromLines(group: Line[], fonts: FontInfoMap): FlowRun[] {
  const runs: FlowRun[] = [];
  for (let li = 0; li < group.length; li++) {
    const line = group[li];
    // Per-line reference (the body text): the largest glyph size and its
    // baseline. A word that is BOTH notably smaller AND baseline-offset from
    // this reference is a super/subscript.
    const lineRefSize = Math.max(...line.words.map(w => w.size));
    const lineRefBaseline = (line.words.find(w => w.size === lineRefSize) ?? line.words[0]).y;
    let prevWord: Word | null = null;
    for (const w of line.words) {
      const info = fonts[w.fontName];
      const psName = extractPsName(info?.name ?? w.fontName);
      const sizeRatio = lineRefSize > 0 ? w.size / lineRefSize : 1;
      const dy = w.y - lineRefBaseline;
      const vertAlign: 'super' | 'sub' | undefined =
        sizeRatio < 0.85 && Math.abs(dy) > 0.12 * lineRefSize
          ? (dy > 0 ? 'super' : 'sub')
          : undefined;
      const style: Omit<FlowRun, 'text'> = {
        bold: isBoldName(psName),
        italic: isItalicName(psName),
        fontSize: Math.round(w.size * 2) / 2,
        fontFamily: familyOf(info),
        rtl: w.rtl,
        psName,
        color: w.color,
        linkUrl: w.linkUrl,
        vertAlign,
        underline: w.underline,
        strikethrough: w.strikethrough,
      };
      let text = w.text;
      if (prevWord) {
        // Reading-order gap: on an RTL line the previous word sits to the RIGHT
        // of the current one, so measure leftward (prev.x − current right edge).
        const gap = line.rtl
          ? prevWord.x - (w.x + w.width)
          : w.x - (prevWord.x + prevWord.width);
        const needsSpace =
          gap > SPACE_GAP * Math.min(prevWord.size, w.size) &&
          !/\s$/.test(prevWord.text) &&
          !/^\s/.test(w.text);
        if (needsSpace) text = ' ' + text;
      }
      const last = runs[runs.length - 1];
      if (
        last &&
        last.bold === style.bold &&
        last.italic === style.italic &&
        last.fontFamily === style.fontFamily &&
        last.rtl === style.rtl &&
        last.psName === style.psName &&
        last.color === style.color &&
        last.linkUrl === style.linkUrl &&
        last.vertAlign === style.vertAlign &&
        last.underline === style.underline &&
        last.strikethrough === style.strikethrough &&
        Math.abs(last.fontSize - style.fontSize) < 0.6
      ) {
        last.text += text;
      } else {
        runs.push({ text, ...style });
      }
      prevWord = w;
    }
    if (li < group.length - 1) {
      const last = runs[runs.length - 1];
      if (last && !/\s$/.test(last.text)) last.text += ' ';
    }
  }
  return runs;
}

function buildParagraph(
  group: Line[],
  gi: number,
  paraLines: Line[][],
  fonts: FontInfoMap,
  pageWidth: number,
  colLeft: number,
  colRight: number,
): { para: FlowParagraph; geom: ParaGeom } {
  const runs = buildRunsFromLines(group, fonts);

  const pageCenter = pageWidth / 2;
  const centerTol = pageWidth * 0.05;
  // A genuinely centered block is also NARROW: full-width content whose center
  // merely happens to sit near the page center is justified/left, not centered.
  // Without the width cap, a flush-both-edges (justified) paragraph would be
  // misread as centered because its midpoint is, by construction, near center.
  const isCentered =
    group.every(l => Math.abs((l.x0 + l.x1) / 2 - pageCenter) < centerTol) &&
    group.every(l => l.x0 > pageWidth * 0.15) &&
    group.every(l => l.x1 - l.x0 < pageWidth * 0.6);
  const isRight =
    !isCentered &&
    group.every(l => l.x0 > pageWidth * 0.5) &&
    group.every(l => Math.abs(l.x1 - group[0].x1) < pageWidth * 0.02);

  // Justify: a multi-line block whose lines are flush at BOTH the column-left
  // and the column-right (except, conventionally, the last line which may be
  // short). Single-line blocks can't be distinguished from plain left-aligned.
  const domSize = group.reduce((m, l) => Math.max(m, l.size), 0) || 12;
  const edgeTol = indentTolerance(domSize);
  const bodyLines = group.length > 1 ? group.slice(0, -1) : group;
  const isJustified =
    !isCentered && !isRight && group.length >= 2 &&
    bodyLines.every(l => Math.abs(l.x0 - colLeft) <= edgeTol) &&
    bodyLines.every(l => Math.abs(l.x1 - colRight) <= edgeTol);

  const rtlChars = runs.reduce((n, r) => n + (r.rtl ? r.text.length : 0), 0);
  const totalChars = runs.reduce((n, r) => n + r.text.length, 0);

  const alignment: FlowParagraph['alignment'] =
    isCentered ? 'center' : isRight ? 'right' : isJustified ? 'justify' : 'left';

  const para: FlowParagraph = {
    runs,
    heading: 0 as const,
    alignment,
    rtl: totalChars > 0 && rtlChars / totalChars > 0.5,
    // Top line's baseline y (PDF y-up) — lets the DOCX writer interleave this
    // paragraph with detected tables in reading order (G9).
    y: group[0].y,
  };

  // Indentation (only meaningful for left/justify blocks). blockLeft is the
  // common left edge of the continuation lines; the first line may be further
  // inset (first-line indent) or the whole block may be inset (left indent).
  if (!isCentered && !isRight) {
    const firstLineX = group[0].x0;
    const restLines = group.length > 1 ? group.slice(1) : group;
    const blockLeft = Math.min(...restLines.map(l => l.x0));
    const left = blockLeft - colLeft;
    const firstLine = firstLineX - blockLeft;
    if (left > edgeTol) para.indentLeft = Math.round(left);
    if (firstLine > edgeTol) para.indentFirstLine = Math.round(firstLine);
  }

  // Line spacing: average baseline gap between consecutive lines in this block.
  if (group.length >= 2) {
    let sum = 0;
    for (let k = 1; k < group.length; k++) sum += group[k - 1].y - group[k].y;
    const avg = sum / (group.length - 1);
    if (avg > 0 && avg < domSize * 4) para.lineHeight = Math.round(avg * 10) / 10;
  }

  // Paragraph spacing: gap to the previous / next paragraph block, clamped to a
  // sane range so an absurd page-spanning gap doesn't emit a giant spacing value.
  const prevGroup = gi > 0 ? paraLines[gi - 1] : null;
  const nextGroup = gi < paraLines.length - 1 ? paraLines[gi + 1] : null;
  if (prevGroup) {
    const prevBottom = prevGroup[prevGroup.length - 1].y;
    const gap = prevBottom - group[0].y - domSize;
    if (gap > 0) para.spaceBefore = Math.round(Math.min(gap, domSize * 6));
  }
  if (nextGroup) {
    const gap = group[group.length - 1].y - nextGroup[0].y - domSize;
    if (gap > 0) para.spaceAfter = Math.round(Math.min(gap, domSize * 6));
  }

  // List detection: check first run for a leading bullet or ordered marker.
  if (runs.length > 0) {
    const firstText = runs[0].text;
    const trimmed = firstText.trimStart();
    const match = detectListPrefix(trimmed);
    if (match) {
      const leading = firstText.length - trimmed.length;
      runs[0].text = firstText.slice(0, leading) + match.stripped;
      para.listType = match.type;
      // Nesting depth from the item's left indent relative to the column edge,
      // in whole font-size units (Gap 4). A top-level item sits at colLeft →
      // depth 0; each ~1 font-size of extra indent advances one level. Clamped
      // to a sane max so a stray far-right item can't invent depth 50.
      para.listDepth = Math.max(0, Math.min(8, Math.round((group[0].x0 - colLeft) / Math.max(domSize, 1))));
      if (match.format) {
        para.listFormat = match.format;
        para.listOrdinalText = match.ordinalText;
      }
    }
  }

  return { para, geom: { x0: group[0].x0, lines: group.length, size: domSize } };
}

/**
 * Stage 4 — wrapped list-item continuation merge (Gap 4): step-2 splits a list
 * item whose wrap exceeds the paragraph gap/size band into a separate, marker-
 * less paragraph. Left as-is, that orphan resets the writer's numbering instance
 * (the next item restarts at 1). Re-absorb a continuation — a single-line, body-
 * sized, hanging-INDENTED (starts right of the marker), non-marker paragraph
 * directly after a list item — back into that item. The hanging-indent guard
 * keeps genuine following body paragraphs (which start at the column-left edge)
 * and real list items (which carry a marker) separate.
 */
function mergeListContinuations(paras: FlowParagraph[], paraGeom: ParaGeom[]): FlowParagraph[] {
  const result: FlowParagraph[] = [];
  const resultGeom: ParaGeom[] = [];
  for (let gi = 0; gi < paras.length; gi++) {
    const p = paras[gi];
    const g = paraGeom[gi];
    const prev = result[result.length - 1];
    const prevG = resultGeom[resultGeom.length - 1];
    const isContinuation =
      !!prev && !!prev.listType && !p.listType && p.heading === 0 &&
      g.lines === 1 && Math.abs(g.size - prevG.size) < 1 &&
      g.x0 > prevG.x0 + indentTolerance(prevG.size) &&
      p.alignment !== 'center' && p.alignment !== 'right';
    if (isContinuation && prev) {
      const lastRun = prev.runs[prev.runs.length - 1];
      const firstRun = p.runs[0];
      if (lastRun && firstRun && !/\s$/.test(lastRun.text) && !/^\s/.test(firstRun.text)) {
        lastRun.text += ' ';
      }
      prev.runs.push(...p.runs);
    } else {
      result.push(p);
      resultGeom.push(g);
    }
  }
  return result;
}

/** Build FlowParagraph[] from a pre-sorted, pre-filtered array of words. */
function reconstructColumn(
  words: Word[],
  fonts: FontInfoMap,
  pageWidth: number,
): FlowParagraph[] {
  const lines = clusterWordsIntoLines(words);
  const paraLines = groupLinesIntoParagraphs(lines);

  // Column reference edges: the robust left/right of the body block. Using a
  // 5th/95th percentile of line edges (not the raw min/max) ignores a single
  // stray-left or stray-right line — a margin glyph, a hanging marker — while
  // still tracking the leftmost real body text (so indented blocks measure as
  // insets FROM it, not vs. the indented majority).
  const colLeft = lines.length ? percentile(lines.map(l => l.x0), 0.05, 0) : 0;
  const colRight = lines.length ? percentile(lines.map(l => l.x1), 0.95, pageWidth) : pageWidth;

  const paraGeom: ParaGeom[] = [];
  const paras = paraLines.map((group, gi) => {
    const { para, geom } = buildParagraph(group, gi, paraLines, fonts, pageWidth, colLeft, colRight);
    paraGeom[gi] = geom;
    return para;
  });

  return mergeListContinuations(paras, paraGeom);
}

// Same clustering tolerance buildTableGrid uses for row/col bounds (sub-point
// jitter + multi-segment grid lines collapse into one boundary).
const TABLE_TOL = 3;

/** A table's axis-aligned region bbox in PDF user space (y-up). */
interface TableRegion {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/**
 * Detect lattice tables and return each with its region bbox (internal — the
 * bbox drives dedup in reconstructPage). See {@link detectLatticeTables} for the
 * detection contract.
 */
function _detectLatticeRegions(
  items: TableTextItem[],
  hRules: RuleRect[],
  vRules: RuleRect[],
): { table: FlowTable; region: TableRegion }[] {
  const rowBounds = clusterPositions(hRules.map(r => r.y + r.height / 2), TABLE_TOL);
  const colBounds = clusterPositions(vRules.map(r => r.x + r.width / 2), TABLE_TOL);
  if (rowBounds.length < 2 || colBounds.length < 2) return [];

  // Region bbox from the clustered boundary extents (PDF y-up).
  const region: TableRegion = {
    top: rowBounds[rowBounds.length - 1],
    bottom: rowBounds[0],
    left: colBounds[0],
    right: colBounds[colBounds.length - 1],
  };

  // Feed only the in-region text items so cell assignment ignores body text that
  // happens to share a band but sits outside the table's horizontal extent.
  const inRegion = items.filter(it => _itemInRegion(it, region));
  const grid = buildTableGrid(hRules, vRules, inRegion, TABLE_TOL);
  if (!grid) return [];
  // Reject a phantom grid drawn over empty space (no cell carries any text).
  const hasText = grid.cells.some(row => row.some(c => c.trim().length > 0));
  if (!hasText) return [];

  return [{ table: { grid, y: region.top }, region }];
}

/**
 * Detect lattice (ruled) tables on a page from its horizontal + vertical grid
 * rules and the positioned text items, all in PDF user space (y-up). Pure →
 * jsdom-testable.
 *
 * A table needs visible grid lines on BOTH axes: at least 2 clustered horizontal
 * rule positions (→ ≥1 row band) AND 2 clustered vertical rule positions (→ ≥1
 * column band). The region bbox is the extent of those clustered boundaries; the
 * grid is built by {@link buildTableGrid} from the rules + the text items whose
 * baseline origin falls inside the bbox.
 *
 * v1 scope is ONE table region per page — the global rule extent (matching
 * buildTableGrid's single-grid contract and the CSV path). Multiple disjoint
 * lattice tables on one page collapse into one grid (a documented partial, still
 * strictly better than today's zero-table output). Borderless tables are NOT
 * detected (no vertical rules → []). Returns [] when no both-axes grid is found
 * or the grid has no non-empty cell (a stray rule pair over empty space).
 *
 * `_pageHeight` is accepted for caller symmetry / future multi-region work but is
 * not needed by the current single-region detection (all inputs are y-up).
 */
export function detectLatticeTables(
  items: TableTextItem[],
  hRules: RuleRect[],
  vRules: RuleRect[],
  _pageHeight: number,
): FlowTable[] {
  return _detectLatticeRegions(items, hRules, vRules).map(r => r.table);
}

/** True when a text item's baseline origin falls inside a table region (y-up). */
function _itemInRegion(it: { x: number; y: number }, r: TableRegion): boolean {
  return it.x >= r.left && it.x <= r.right && it.y >= r.bottom && it.y <= r.top;
}

// ── B1: tagged-PDF struct-tree exact-replace ────────────────────────────────

/**
 * A marked-content boundary from `getTextContent({ includeMarkedContent: true })`.
 * pdf.js interleaves these with regular text items; only `beginMarkedContentProps`
 * carries an `id` (the MCID that struct-tree content leaves reference).
 */
export interface MarkedContentMarker {
  type: 'beginMarkedContent' | 'beginMarkedContentProps' | 'endMarkedContent';
  id?: string;
  tag?: string;
}

/**
 * C22 — translate text items from pdf.js's ABSOLUTE user space into the CROP frame.
 *
 * pdf.js reports item baselines relative to the user-space origin, while `reconstructPage` is
 * handed the CROP dimensions as the page box. The two coincide on the usual `/CropBox [0 0 w h]`
 * page and diverge by exactly the origin on any other, which shifted every position in the flow
 * model — margins, image anchors and reading order alike.
 *
 * Only `transform[4]`/`[5]` move; the linear part (size, skew, rotation) is a translation
 * invariant. Marked-content boundaries pass through untouched — they carry no geometry.
 *
 * Returns the INPUT ARRAY unchanged at a zero origin, so the ~85% of pages that have one allocate
 * nothing and produce byte-identical output. Never mutates: the items belong to pdf.js, and the
 * same objects are read again by the caller's font map and by the struct-tree path.
 */
export function translateItemsToCropOrigin<T extends RawTextItem | MarkedContentMarker>(
  items: T[],
  originX: number,
  originY: number,
): T[] {
  if (originX === 0 && originY === 0) return items;
  return items.map((it) => {
    if ('type' in it || !Array.isArray((it as RawTextItem).transform)) return it;
    const t = (it as RawTextItem).transform;
    return { ...it, transform: [t[0], t[1], t[2], t[3], t[4] - originX, t[5] - originY] };
  });
}

/**
 * Minimal shape of a pdf.js `getStructTree()` node. An ELEMENT carries a `role`
 * (e.g. 'H1','P','L','LI','Table','TR','TD','TH') and `children`; a CONTENT LEAF
 * carries `type:'content'` (or `'object'`) and an `id` matching a marked-content id.
 */
export interface StructTreeNodeLike {
  role?: string;
  type?: string;
  id?: string;
  children?: StructTreeNodeLike[];
}

/** A struct-tree leaf: a content/object node carrying an MCID. */
function _isStructLeaf(n: StructTreeNodeLike): n is StructTreeNodeLike & { id: string } {
  return typeof n.id === 'string' && (n.type === 'content' || n.type === 'object');
}

// A parent block's leaf collection stops at these roles so it never swallows a
// nested list/table (each is emitted as its own block); a table cell stops only
// at a nested Table (everything else inside a cell is its text).
const _STRUCT_BLOCK_STOP = new Set(['L', 'TABLE', 'FIGURE']);
const _STRUCT_CELL_STOP = new Set(['TABLE']);

/**
 * B1 — split a `getTextContent({ includeMarkedContent: true })` item stream into a
 * map of marked-content id → its text items. Each text item is attributed to the
 * INNERMOST enclosing MCID (the nearest non-null id on the marked-content stack); a
 * marked region with no MCID (Artifact / untagged) pushes a null spacer so the
 * stack stays balanced and its text is dropped (artifacts are not content). Pure →
 * jsdom-testable.
 */
export function buildMarkedContentMap(
  items: ReadonlyArray<RawTextItem | MarkedContentMarker>,
): Map<string, RawTextItem[]> {
  const map = new Map<string, RawTextItem[]>();
  const stack: (string | null)[] = [];
  for (const it of items) {
    if ('type' in it) {
      const m = it as MarkedContentMarker;
      if (m.type === 'endMarkedContent') stack.pop();
      else stack.push(m.id ?? null); // beginMarkedContent / beginMarkedContentProps
      continue;
    }
    let id: string | null = null;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i] !== null) { id = stack[i]; break; }
    }
    if (id === null) continue;
    const arr = map.get(id);
    if (arr) arr.push(it as RawTextItem);
    else map.set(id, [it as RawTextItem]);
  }
  return map;
}

/** Collect content-leaf ids under a node in document order, NOT descending into
 * nested separately-emitted blocks (per {@link _STRUCT_BLOCK_STOP}/cell stop). */
function _collectLeafIds(node: StructTreeNodeLike, stopRoles: Set<string>): string[] {
  const out: string[] = [];
  const walk = (n: StructTreeNodeLike) => {
    for (const c of n.children ?? []) {
      if (_isStructLeaf(c)) { out.push(c.id); continue; }
      if (stopRoles.has((c.role ?? '').toUpperCase())) continue;
      walk(c);
    }
  };
  walk(node);
  return out;
}

/** Resolve the (redaction-filtered) text items for a list of MCIDs into Words. */
function _structItemsToWords(
  ids: string[],
  mcMap: Map<string, RawTextItem[]>,
  redactions: RedactionRect[] | undefined,
  pageTopY: number,
): Word[] {
  const words: Word[] = [];
  for (const id of ids) {
    const arr = mcMap.get(id);
    if (!arr) continue;
    for (const it of arr) {
      if (!it.str || !it.str.trim()) continue;
      if (redactions?.length && redactions.some(r => isItemRedacted(it, r, pageTopY))) continue;
      const size = Math.hypot(it.transform[0], it.transform[1]) || Math.abs(it.height) || 12;
      words.push({
        text: foldLatinLigatures(it.str),
        x: it.transform[4], y: it.transform[5],
        width: Math.abs(it.width), size, fontName: it.fontName, rtl: it.dir === 'rtl',
      });
    }
  }
  return words;
}

/** Build one FlowParagraph for a block (heading/body/list item) from its MCIDs. */
function _structBlockParagraph(
  ids: string[],
  mcMap: Map<string, RawTextItem[]>,
  fonts: FontInfoMap,
  heading: FlowParagraph['heading'],
  listCtx: { depth: number } | null,
  redactions: RedactionRect[] | undefined,
  pageTopY: number,
): FlowParagraph | null {
  const words = _structItemsToWords(ids, mcMap, redactions, pageTopY);
  if (!words.length) return null;
  const lines = clusterWordsIntoLines(words);
  const runs = buildRunsFromLines(lines, fonts);
  if (!runs.some(r => r.text.trim())) return null;
  const rtlChars = runs.reduce((n, r) => n + (r.rtl ? r.text.length : 0), 0);
  const totalChars = runs.reduce((n, r) => n + r.text.length, 0);
  const rtl = totalChars > 0 && rtlChars / totalChars > 0.5;
  const para: FlowParagraph = {
    runs,
    heading,
    alignment: rtl ? 'right' : 'left',
    rtl,
    y: lines.length ? lines[0].y : undefined,
  };
  if (listCtx) {
    // The tag says this is a list item: strip an inline/Lbl marker and pick
    // ordered vs bullet from it; default bullet when no recognizable marker.
    const first = runs[0];
    const trimmed = first.text.trimStart();
    const match = detectListPrefix(trimmed);
    if (match) {
      const leading = first.text.length - trimmed.length;
      first.text = first.text.slice(0, leading) + match.stripped;
      para.listType = match.type;
      if (match.format) { para.listFormat = match.format; para.listOrdinalText = match.ordinalText; }
    } else {
      para.listType = 'bullet';
    }
    para.listDepth = Math.max(0, Math.min(8, listCtx.depth));
  }
  return para;
}

/** Build a FlowTable from a Table struct node (TR rows of TH/TD cells). */
function _structTable(
  node: StructTreeNodeLike,
  mcMap: Map<string, RawTextItem[]>,
  fonts: FontInfoMap,
  redactions: RedactionRect[] | undefined,
  pageTopY: number,
): FlowTable | null {
  const rows: string[][] = [];
  let topY = -Infinity;
  const cellText = (cell: StructTreeNodeLike): string => {
    const words = _structItemsToWords(_collectLeafIds(cell, _STRUCT_CELL_STOP), mcMap, redactions, pageTopY);
    for (const w of words) topY = Math.max(topY, w.y);
    if (!words.length) return '';
    return buildRunsFromLines(clusterWordsIntoLines(words), fonts).map(r => r.text).join('').trim();
  };
  const collectRows = (n: StructTreeNodeLike) => {
    for (const c of n.children ?? []) {
      if (_isStructLeaf(c)) continue;
      const role = (c.role ?? '').toUpperCase();
      if (role === 'TR') {
        const cells: string[] = [];
        for (const cell of c.children ?? []) {
          if (_isStructLeaf(cell)) continue;
          const cr = (cell.role ?? '').toUpperCase();
          if (cr === 'TH' || cr === 'TD') cells.push(cellText(cell));
        }
        rows.push(cells);
      } else if (role === 'THEAD' || role === 'TBODY' || role === 'TFOOT') {
        collectRows(c); // row groups wrap the TRs
      }
    }
  };
  collectRows(node);
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (rows.length === 0 || cols === 0) return null;
  const cells = rows.map(r => {
    const row = [...r];
    while (row.length < cols) row.push('');
    return row;
  });
  if (!cells.some(r => r.some(c => c.length > 0))) return null; // all-empty grid → skip
  return { grid: { rows: cells.length, cols, cells }, y: topY === -Infinity ? 0 : topY };
}

/**
 * B1 — reconstruct a tagged PDF page's flow straight from its `getStructTree()`,
 * using marked-content ids to tie struct leaves to text items. Walks the role tree
 * in document reading order emitting H1–6 → heading, P/Note/Caption/Quote → body,
 * L+LI → list items (depth + ordered/bullet from the marker), Table+TR+TH/TD →
 * FlowTable. Figures are skipped (the raster image path handles them). Returns null
 * when the tree is absent or resolves no text (caller falls back to the heuristic
 * path → byte-identical for untagged PDFs). Pure → jsdom-testable.
 *
 * Alignment/indent/spacing are not tag-derived (left, or right for RTL); the value
 * is the exact reading order + correct heading/list/table structure the heuristics
 * can only guess. `redactions` are CONTENT-space rects (already un-rotated by the
 * caller) so redacted text never leaks here either.
 */
export function structTreeToFlow(
  tree: StructTreeNodeLike | null | undefined,
  mcMap: Map<string, RawTextItem[]>,
  fonts: FontInfoMap,
  pageWidth: number,
  pageTopY: number,
  redactions?: RedactionRect[],
): { paragraphs: FlowParagraph[]; tables: FlowTable[] } | null {
  if (!tree) return null;
  const paragraphs: FlowParagraph[] = [];
  const tables: FlowTable[] = [];

  const pushPara = (node: StructTreeNodeLike, heading: FlowParagraph['heading'], listCtx: { depth: number } | null) => {
    const p = _structBlockParagraph(
      _collectLeafIds(node, _STRUCT_BLOCK_STOP), mcMap, fonts, heading, listCtx, redactions, pageTopY,
    );
    if (p) paragraphs.push(p);
  };

  const walk = (node: StructTreeNodeLike, listDepth: number) => {
    const role = (node.role ?? '').toUpperCase();
    const hMatch = /^H([1-6])$/.exec(role);
    if (hMatch) { pushPara(node, Number(hMatch[1]) as FlowParagraph['heading'], null); return; }
    if (role === 'H' || role === 'TITLE') { pushPara(node, 1, null); return; }
    if (role === 'P' || role === 'NOTE' || role === 'CAPTION' || role === 'BLOCKQUOTE' || role === 'QUOTE') {
      pushPara(node, 0, null); return;
    }
    if (role === 'LI') {
      pushPara(node, 0, { depth: listDepth });
      for (const c of node.children ?? []) {
        if (!_isStructLeaf(c) && (c.role ?? '').toUpperCase() === 'L') walk(c, listDepth + 1);
      }
      return;
    }
    if (role === 'L') {
      for (const c of node.children ?? []) if (!_isStructLeaf(c)) walk(c, listDepth);
      return;
    }
    if (role === 'TABLE') {
      const t = _structTable(node, mcMap, fonts, redactions, pageTopY);
      if (t) tables.push(t);
      return;
    }
    if (role === 'FIGURE') return; // raster handled by the image extraction path
    for (const c of node.children ?? []) if (!_isStructLeaf(c)) walk(c, listDepth); // container → recurse
  };

  walk(tree, 0);
  if (paragraphs.length === 0 && tables.length === 0) return null;
  return { paragraphs, tables };
}

/**
 * Normalize a pdf.js fill-color operator's args to an uppercase 6-hex color
 * string (no leading '#'), or `null` if it can't be resolved (e.g. a pattern
 * fill, or malformed args).
 *
 * pdf.js v6's `PartialEvaluator.getOperatorList` pre-resolves EVERY non-pattern
 * fill color space (RGB / Gray / CMYK / Separation / spot / ICC) and re-emits a
 * single `setFillRGBColor` op whose arg is a `"#rrggbb"` STRING (getRgbHex →
 * Util.makeHexColor). The legacy float-component shapes are still accepted here
 * for resilience across pdf.js versions:
 *   - 'rgb'  : `["#rrggbb"]` | `["#rgb"]` | `[r, g, b]` (each 0..1)
 *   - 'gray' : `[g]` (0..1) | `["#rrggbb"]`
 *   - 'cmyk' : `[c, m, y, k]` (each 0..1)
 */
export function fillOpToHex(
  op: 'rgb' | 'gray' | 'cmyk',
  args: readonly unknown[]
): string | null {
  const byte = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  const fromHexString = (s: string): string | null => {
    const h = s.replace(/^#/, '').toUpperCase();
    if (/^[0-9A-F]{6}$/.test(h)) return h;
    if (/^[0-9A-F]{3}$/.test(h)) return h.split('').map((c) => c + c).join('');
    return null;
  };
  if (op === 'rgb') {
    const a0 = args[0];
    if (typeof a0 === 'string') return fromHexString(a0);
    if (typeof a0 === 'number' && typeof args[1] === 'number' && typeof args[2] === 'number') {
      return byte(a0 * 255) + byte(args[1] * 255) + byte(args[2] * 255);
    }
    return null;
  }
  if (op === 'gray') {
    const g = args[0];
    if (typeof g === 'string') return fromHexString(g);
    if (typeof g === 'number') {
      const h = byte(g * 255);
      return h + h + h;
    }
    return null;
  }
  // cmyk
  const [c, m, y, k] = args;
  if ([c, m, y, k].every((v) => typeof v === 'number')) {
    return (
      byte((1 - (c as number)) * (1 - (k as number)) * 255) +
      byte((1 - (m as number)) * (1 - (k as number)) * 255) +
      byte((1 - (y as number)) * (1 - (k as number)) * 255)
    );
  }
  return null;
}

/**
 * Reconstruct the flow structure of one page from its positioned text items.
 * Pure function — fully unit-testable without pdf.js.
 *
 * Automatically detects two-column layouts via XY-cut and annotates list items.
 *
 * @param colorMap  Optional map from `"${Math.round(x)},${Math.round(y)}"` → hex color
 *                  (6 uppercase chars, no '#'). Built from getOperatorList() in the caller.
 * @param redactions  Optional redaction rectangles (editor space, top-left origin).
 *                  Any source text item intersecting a rectangle is dropped so redacted
 *                  text never leaks into the DOCX/MD/TXT flow export.
 * @param vRules    Optional thin VERTICAL grid rules (PDF user space, y-up). When
 *                  present alongside `rules` (horizontal), a both-axes-ruled region
 *                  is detected as a lattice table (G9) — its text is removed from the
 *                  reconstructed paragraphs (dedup) and emitted on `page.tables`.
 *                  Omitted (the default) → no table detection, output unchanged.
 */
export function reconstructPage(
  items: RawTextItem[],
  fonts: FontInfoMap,
  pageWidth: number,
  pageHeight: number,
  colorMap?: Map<string, string>,
  redactions?: RedactionRect[],
  links?: FlowLinkRect[],
  rules?: RuleRect[],
  pageRotation = 0,
  vRules?: RuleRect[],
  // B1: when the page is tagged, `struct.tree` + the marked-content item stream
  // drive an exact-replace flow (correct reading order + tag structure); a tree
  // that resolves no text falls through to the heuristic path below.
  struct?: { tree: StructTreeNodeLike | null; markedItems: ReadonlyArray<RawTextItem | MarkedContentMarker> },
  /**
   * The page's pdf.js `viewBox` (CropBox) `[x0, y0, x1, y1]` at rotation 0. Needed because text
   * items are reported in ABSOLUTE user space while redaction rects are relative to the rendered
   * (crop) box — see {@link redactionRectToPageSpace}. Omitting it assumes an origin of (0,0),
   * which is what every caller effectively did before and is correct for almost every page.
   */
  viewBox?: readonly number[],
): FlowPage {
  // Redaction rects arrive in editor DISPLAYED space; text items are reported in ABSOLUTE user
  // space. One mapping brings the rects into the items' frame, handling BOTH the rotation
  // (CORE-P0-1) and the CropBox origin. The default below is exactly the old behaviour.
  const vb = viewBox ?? [0, 0, pageWidth, pageHeight];
  const pageTopY = vb[3];
  const contentRedactions = redactions?.length
    ? redactions.map(r => redactionRectToPageSpace(r, vb, pageRotation))
    : undefined;
  const words: Word[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    if (contentRedactions?.length && contentRedactions.some(r => isItemRedacted(it, r, pageTopY))) continue;
    const size = Math.hypot(it.transform[0], it.transform[1]) || Math.abs(it.height) || 12;
    const x = it.transform[4];
    const y = it.transform[5];
    const color = colorMap?.get(`${Math.round(x)},${Math.round(y)}`);
    // Underline / strikethrough: match thin rules to this glyph run (b).
    let underline: boolean | undefined;
    let strikethrough: boolean | undefined;
    if (rules?.length) {
      const runGeom = { x, y, width: Math.abs(it.width), size };
      for (const r of rules) {
        const kind = classifyRuleAsUnderline(r, runGeom);
        if (kind === 'underline') underline = true;
        else if (kind === 'strikethrough') strikethrough = true;
        if (underline && strikethrough) break;
      }
    }
    // Hyperlink tagging: a word belongs to a Link annotation when its mid-glyph
    // centre (PDF y-up space) falls inside the link rectangle. Centre (not the
    // baseline origin) avoids edge words at a rect boundary being missed.
    let linkUrl: string | undefined;
    if (links?.length) {
      const cx = x + Math.abs(it.width) / 2;
      const cy = y + size * 0.4;
      for (const ln of links) {
        if (cx >= ln.x0 && cx <= ln.x1 && cy >= ln.y0 && cy <= ln.y1) { linkUrl = ln.url; break; }
      }
    }
    words.push({ text: foldLatinLigatures(it.str), x, y, width: Math.abs(it.width), size, fontName: it.fontName, rtl: it.dir === 'rtl', color, linkUrl, underline, strikethrough });
  }

  // B1: tagged-PDF struct-tree exact-replace. A usable tree yields paragraphs/
  // tables straight from the tags (correct reading order + heading/list/table
  // structure) and SKIPS the heuristic column/heading path. structTreeToFlow
  // returns null when the tree resolves no text → heuristic fallback below
  // (byte-identical for untagged PDFs). Redactions are applied via the same
  // un-rotated contentRedactions the heuristic path uses.
  if (struct?.tree) {
    const flow = structTreeToFlow(
      struct.tree, buildMarkedContentMap(struct.markedItems), fonts, pageWidth, pageTopY, contentRedactions,
    );
    if (flow) {
      const taggedPage: FlowPage = { width: pageWidth, height: pageHeight, paragraphs: flow.paragraphs, tagged: true };
      if (flow.tables.length) taggedPage.tables = flow.tables;
      const taggedMargins = computeMargins(words, pageWidth, pageHeight);
      if (taggedMargins) taggedPage.margins = taggedMargins;
      return taggedPage;
    }
  }

  // G9: lattice-table detection. Only when BOTH axes carry grid rules. The text
  // consumed by a detected table is removed from the words fed to paragraph
  // reconstruction (dedup), so it appears once — inside the table — never also as
  // a stray paragraph. No vRules (or no both-axes grid) → regions is empty and
  // every downstream step is byte-identical to the pre-G9 path.
  const tableInput: TableTextItem[] = words.map(w => ({ x: w.x, y: w.y, text: w.text }));
  const detected = rules?.length && vRules?.length
    ? _detectLatticeRegions(tableInput, rules, vRules)
    : [];
  const regions = detected.map(d => d.region);
  const flowWords = regions.length ? words.filter(w => !regions.some(r => _itemInRegion(w, r))) : words;

  // B6: recursive column split (≤2 columns is byte-identical to the prior single
  // cut; a genuine 3rd gutter now yields a 3rd column in reading order).
  const columns = splitColumns(flowWords, pageWidth);
  const paragraphs: FlowParagraph[] = columns.flatMap(colWords => reconstructColumn(colWords, fonts, pageWidth));

  const margins = computeMargins(flowWords, pageWidth, pageHeight);
  const page: FlowPage = { width: pageWidth, height: pageHeight, paragraphs };
  if (margins) page.margins = margins;
  if (detected.length) page.tables = detected.map(d => d.table);
  return page;
}

/** Nearest-rank percentile of a numeric array (p in [0,1]). Empty → fallback. */
function percentile(values: number[], p: number, fallback: number): number {
  if (!values.length) return fallback;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))));
  return s[idx];
}

/**
 * Derive page margins (PDF points) from the text-block bounding box.
 *
 * Robustness: uses the 1st-quartile / 3rd-quartile of glyph edges rather than the
 * raw min/max, so a minority of outlier elements — a running head pinned to the
 * corner, a page-number glyph in the far margin — cannot collapse a margin to ~0
 * (or, after the non-negative clamp, leave the page looking edge-to-edge).
 * Quartiles (vs. 5th/95th percentile) survive very small word counts, where a
 * single outlier is still >5% of the sample. Failure mode prevented: one stray
 * item at x≈0 → left margin ≈ 0 → Word renders body text flush to the page edge,
 * WORSE drift than the 1" default this fix replaces.
 *
 * All four margins are clamped to [0, 40% of the corresponding page dimension].
 */
function computeMargins(words: Word[], pageWidth: number, pageHeight: number): PageMargins | null {
  if (!words.length) return null;
  const lefts = words.map(w => w.x);
  const rights = words.map(w => w.x + w.width);
  // Glyph top in y-up PDF space ≈ baseline + size; bottom ≈ baseline.
  const tops = words.map(w => w.y + w.size);
  const bottoms = words.map(w => w.y);

  // Inner quartiles ignore a minority of margin outliers; the true body block
  // sits between Q1 and Q3 of the edge distributions.
  const leftEdge = percentile(lefts, 0.25, 0);
  const rightEdge = percentile(rights, 0.75, pageWidth);
  const topEdge = percentile(tops, 0.75, pageHeight);
  const bottomEdge = percentile(bottoms, 0.25, 0);

  const clampW = (v: number) => Math.round(Math.max(0, Math.min(v, pageWidth * 0.4)));
  const clampH = (v: number) => Math.round(Math.max(0, Math.min(v, pageHeight * 0.4)));

  return {
    left: clampW(leftEdge),
    right: clampW(pageWidth - rightEdge),
    top: clampH(pageHeight - topEdge),
    bottom: clampH(bottomEdge),
  };
}

/**
 * Document-wide heading inference (pymupdf4llm recipe): the modal font size
 * weighted by text length is the body; distinct larger sizes rank to H1–H3.
 * Mutates the FlowDoc in place.
 */
export function assignHeadings(doc: FlowDoc): void {
  const weight = new Map<number, number>();
  for (const page of doc.pages) {
    if (page.tagged) continue; // B1: tag-derived headings; don't skew the body-size vote
    for (const p of page.paragraphs) {
      for (const r of p.runs) {
        weight.set(r.fontSize, (weight.get(r.fontSize) ?? 0) + r.text.length);
      }
    }
  }
  if (weight.size === 0) return;
  const bodySize = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const headingSizes = [...weight.keys()]
    .filter(s => s >= bodySize * HEADING_RATIO)
    .sort((a, b) => b - a)
    .slice(0, 6);

  for (const page of doc.pages) {
    if (page.tagged) continue; // B1: keep the tag-derived heading levels
    for (const p of page.paragraphs) {
      const sizes = p.runs.map(r => r.fontSize);
      const domSize = sizes.length ? Math.max(...sizes) : bodySize;
      const rank = headingSizes.indexOf(domSize);
      p.heading = rank === -1 ? 0 : ((rank + 1) as 1 | 2 | 3 | 4 | 5 | 6);
    }
  }

  // ── Heuristic style-based promotion (G11) ─────────────────────────────────
  // Tagged-PDF StructTree heading tags are a separate ceiling; here we recover
  // headings that authors distinguish by WEIGHT or CASE rather than size — very
  // common in real documents (e.g. a bold or ALL-CAPS section label set at the
  // body font size). The size pass above leaves these at heading 0.
  //
  // This pass is DELIBERATELY CONSERVATIVE — it favors precision over recall, so
  // it will miss some real headings rather than mis-promote bold emphasis or an
  // all-caps acronym sitting inside body text. A paragraph already promoted by
  // size, or any document with no qualifying line, is left byte-identical. Only
  // paragraphs still at heading 0 whose dominant run size ≈ bodySize (within 5%)
  // are eligible, and ALL of the following must hold:
  //   • short        — ≤ 8 words (headings are short);
  //   • ≥ 3 letters  — skips "OK", "I", single glyphs / 2-letter acronyms;
  //   • NOT a list item, and no run underlined/struck (those are body emphasis);
  //   • AND ( fully-bold: every run bold ) OR ( all-caps: every cased letter is
  //          uppercase and at least one A–Z is present ).
  // Promoted BELOW the size-derived headings so genuine size headings keep
  // H1..HN: level = min(6, headingSizes.length + 1), defaulting to 3 when there
  // are no size headings at all.
  const HEADING_SIZE_TOLERANCE = 0.05;
  const promotionLevel = (headingSizes.length ? Math.min(6, headingSizes.length + 1) : 3) as
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6;
  for (const page of doc.pages) {
    if (page.tagged) continue; // B1: tagged pages carry their own heading levels
    for (const p of page.paragraphs) {
      if (p.heading !== 0 || p.listType || p.runs.length === 0) continue;
      const domSize = Math.max(...p.runs.map(r => r.fontSize));
      if (Math.abs(domSize - bodySize) > bodySize * HEADING_SIZE_TOLERANCE) continue;
      if (p.runs.some(r => r.underline || r.strikethrough)) continue;
      const text = p.runs.map(r => r.text).join('').trim();
      const letters = text.replace(/[^A-Za-z]/g, '');
      if (letters.length < 3) continue;
      if (text.split(/\s+/).filter(Boolean).length > 8) continue;
      const fullyBold = p.runs.every(r => r.bold);
      const allCaps = text === text.toUpperCase() && /[A-Z]/.test(text);
      if (fullyBold || allCaps) p.heading = promotionLevel;
    }
  }
}

/** Minimal shape of a typed (overlay) text element for flow conversion. */
export interface OverlayTextLike {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  /** '#rrggbb' fill color. */
  color?: string;
  /** Concrete family name (e.g. 'Arial', 'Times New Roman'). */
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
}

/** Map a concrete font family name to the generic category the flow model uses. */
function _genericFamily(name?: string): 'serif' | 'sans-serif' | 'monospace' {
  const n = (name ?? '').toLowerCase();
  if (/courier|consol|mono|menlo/.test(n)) return 'monospace';
  if (/times|georgia|serif|garamond|minion|cambria/.test(n)) return 'serif';
  return 'sans-serif';
}

/**
 * Convert text the user TYPED in-app (overlay TextElements) into flow paragraphs
 * for DOCX/MD export (#4). `el.text` is already LOGICAL Unicode (what the user
 * typed), so Arabic passes through unchanged with rtl=true + right alignment —
 * Word's own bidi lays it out correctly. Do NOT apply reverseRtlText here: that
 * un-reverses pdf.js VISUAL-order *source* text, which would corrupt logical input.
 * Multiline text splits on '\n'; elements are ordered top-to-bottom then L→R.
 * Pure → jsdom-testable.
 *
 * When `pageHeight` (the source page height, PDF points) is supplied, each emitted
 * paragraph gets a reading-order `y` in PDF user space (y-UP) so it can interleave
 * with source paragraphs (G12): `el.y` is editor DISPLAY space (top-left origin,
 * y-DOWN), so the box top in PDF space is `pageHeight - el.y`. Successive lines of
 * a multi-line element step DOWN by one font size (`- lineIdx * el.fontSize`) so
 * they keep their top-to-bottom order after a descending-y sort. When `pageHeight`
 * is omitted (the blank-page caller), NO `y` is set and behaviour is unchanged —
 * those paragraphs sort by insertion order in the writer's `?? -Infinity` fallback.
 */
export function textElementsToFlowParagraphs(
  els: ReadonlyArray<OverlayTextLike>,
  pageHeight?: number,
): FlowParagraph[] {
  const ordered = [...els].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: FlowParagraph[] = [];
  for (const el of ordered) {
    if (typeof el.text !== 'string') continue;
    const color =
      el.color && el.color.toUpperCase() !== '#000000' ? el.color.replace(/^#/, '').toUpperCase() : undefined;
    const fontFamily = _genericFamily(el.fontFamily);
    let lineIdx = 0;
    for (const line of el.text.split('\n')) {
      if (!line.trim()) continue;
      const rtl = isArabicText(line);
      const para: FlowParagraph = {
        runs: [{ text: line, bold: !!el.bold, italic: !!el.italic, fontSize: el.fontSize, fontFamily, rtl, color }],
        heading: 0,
        alignment: rtl ? 'right' : 'left',
        rtl,
      };
      if (pageHeight !== undefined) para.y = pageHeight - el.y - lineIdx * el.fontSize;
      out.push(para);
      lineIdx++;
    }
  }
  return out;
}

/**
 * Build a minimal single-page {@link FlowDoc} from a block of recognized OCR text
 * (tesseract's `data.text`, newline-separated). Each non-blank line becomes one
 * body paragraph; an Arabic (RTL) line is right-aligned. Used by the "OCR → Word"
 * export so a scanned page becomes a clean, EDITABLE `.docx` of plain reading-order
 * text. Pure → jsdom-unit-testable.
 *
 * Page size defaults to US-Letter points (612×792); the DOCX reflows text, so the
 * exact page box only affects margins, not the recovered text. The original scan's
 * COLUMN / TABLE layout is NOT reconstructed (documented ceiling) — this is a
 * faithful linear transcription, not a layout clone.
 */
export function ocrTextToFlowDoc(text: string): FlowDoc {
  const paragraphs: FlowParagraph[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const rtl = isArabicText(line);
    paragraphs.push({
      runs: [{ text: line, bold: false, italic: false, fontSize: 11, fontFamily: 'serif', rtl }],
      heading: 0,
      alignment: rtl ? 'right' : 'left',
      rtl,
    });
  }
  return { pages: [{ width: 612, height: 792, paragraphs }] };
}

/**
 * Merge source paragraphs with typed-overlay paragraphs into one reading-order
 * sequence (G12). Reading order is DESCENDING PDF y-up (top of page first); this
 * mirrors the table-interleave convention in flowDocWriters (`p.y ?? -Infinity`,
 * stable on ties). A paragraph with no `y` sinks to the end, keeping its relative
 * order. The sort is made stable explicitly via an insertion-order tiebreaker so
 * a source paragraph and an overlay paragraph at the SAME y keep source-first.
 *
 * Identity fast-path: when there is no overlay text the SOURCE array is returned
 * UNCHANGED (same reference) so a page with no typed text stays byte-identical to
 * the pre-G12 output — source paragraphs are never re-sorted on their own (which
 * matters for multi-column pages, where reconstructPage's column-concatenation
 * order is NOT globally descending-y and must be preserved).
 */
export function interleaveByReadingOrder(
  source: FlowParagraph[],
  overlay: FlowParagraph[],
): FlowParagraph[] {
  if (overlay.length === 0) return source;
  const yOf = (p: FlowParagraph) => p.y ?? -Infinity; // y-less paragraphs sink to the end
  const tagged = [...source, ...overlay].map((node, order) => ({ node, order, y: yOf(node) }));
  tagged.sort((a, b) => b.y - a.y || a.order - b.order);
  return tagged.map(t => t.node);
}
