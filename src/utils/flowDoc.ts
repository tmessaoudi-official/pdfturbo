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
import { inferBorderlessGridForFlow } from './borderlessTable';
import { logicalItemOrder, mirroredChar, visualToLogical } from './bidi';

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
  /**
   * Internal link (limits row 22, D11): the name of the bookmark this run jumps to, when it sits under a GoTo Link.
   * Set to a target KEY during page reconstruction and rewritten to the bookmark name (or removed, when the target
   * is not in the export) by {@link resolveLinkAnchors}.
   */
  linkAnchor?: string;
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
  /** External link target. Exactly one of `url` / `anchor` is set. */
  url?: string;
  /** Internal (GoTo) link: a target key resolved by {@link resolveLinkAnchors} after every page is built. */
  anchor?: string;
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
  /**
   * Bookmark name placed on this paragraph because an internal link points here (limits row 22). Generated —
   * letters, digits and `_` only — never taken from the PDF.
   */
  bookmark?: string;
}

/**
 * A lattice (ruled) table detected on a page: a grid bounded by visible grid
 * lines on BOTH axes (≥2 horizontal + ≥2 vertical rules). `y` is the top edge in
 * PDF user space (y-up) — used to interleave the table with paragraphs in reading
 * order. A table drawn with whitespace alone comes from `inferBorderlessGridForFlow` (C9, limits row 20).
 */
export interface FlowTable {
  grid: TableGrid;
  /** Top edge of the table region in PDF user space (y-up). */
  y: number;
  /** Drawn with whitespace alone (C9, limits row 20): the DOCX writer then draws no borders the PDF never had. */
  borderless?: true;
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
 * Limits row 22 (D11) — where an internal link lands: a flow page and the top edge of the view the PDF asked for, in
 * that page's crop frame (y-up), or undefined when the destination names no height (`/Fit`, `/FitB`, a null top).
 */
export interface LinkTarget {
  page: FlowPage;
  top?: number;
}

/**
 * Turn every internal link's target KEY into a bookmark on the paragraph it lands on, after every page is built (a
 * link may point forward). The paragraph chosen is the nearest one starting at or below the view's top edge (a
 * producer puts that edge at or just above the heading it targets); when every paragraph starts above it, the lowest
 * one, which is the paragraph the edge falls in; and the page's first paragraph when the destination names no
 * height. A target that is not in the export (its page was deleted, has no paragraph, or could not be resolved)
 * leaves the run as plain text. Two links landing on one paragraph share its bookmark. Pure.
 */
export function resolveLinkAnchors(pages: FlowPage[], targets: ReadonlyMap<string, LinkTarget>): void {
  const nameOf = new Map<string, string | null>();
  let next = 0;
  const bookmarkFor = (key: string): string | null => {
    if (nameOf.has(key)) return nameOf.get(key) ?? null;
    const t = targets.get(key);
    const paras = t ? t.page.paragraphs.filter(p => p.runs.some(r => r.text.trim())) : [];
    let chosen: FlowParagraph | undefined;
    if (t && t.top !== undefined) {
      // One point of slack: producers put the view's top a hair above the heading they target.
      const placed = paras.filter(p => p.y !== undefined) as Array<FlowParagraph & { y: number }>;
      for (const p of placed) if (p.y <= t.top + 1 && (!chosen || p.y > (chosen.y as number))) chosen = p;
      if (!chosen) for (const p of placed) if (!chosen || p.y < (chosen.y as number)) chosen = p;
    }
    chosen ??= paras[0];
    const name = chosen ? (chosen.bookmark ??= `_pdfturbo_link_${++next}`) : null;
    nameOf.set(key, name);
    return name;
  };
  for (const page of pages) {
    for (const p of page.paragraphs) {
      for (const r of p.runs) {
        if (r.linkAnchor === undefined) continue;
        const name = bookmarkFor(r.linkAnchor);
        if (name) r.linkAnchor = name; else delete r.linkAnchor;
      }
    }
  }
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
  // `pdf.worker.mjs:35904-35913`, where `if (!font.vertical)` sets `width = 0` and
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
  if (item.dir === 'ttb') return verticalItemRedacted(item, red, pageTopY, col1, col2);
  const extent1 = Math.abs(item.width);
  const extent2 = Math.abs(item.height) || Math.hypot(c, d) || size;
  const ux = (a / col1) * extent1, uy = (b / col1) * extent1;
  // The box spans the DESCENDER as well as the ascender. pdf.js reports the item from its BASELINE,
  // so `[baseline, baseline+size]` stops where the descenders of g, j, p, q, y begin — and a
  // redaction covering only below the baseline left the whole run in the flow exports while
  // `SECURITY.md` said horizontal text was covered. 0.25em is a deliberate over-approximation: for
  // a LEAK filter the footprint may only grow, and no font metric is available here. It costs a
  // quarter-em of extra drop below a redacted line. [WS7 round 3, 2026-09-04]
  // A quarter of `col2` — the em along the DESCENDER direction — and neither of the two things this
  // line held before. `extent2` is the glyph size for horizontal text but the ACCUMULATED ADVANCE
  // for a vertical run, so it gave a five-glyph vertical line 15pt of band instead of 3pt. `size` is
  // `hypot(a,b)`, which pdf.js builds as `fontSize * textHScale` (`pdf.worker.mjs:35872`), so under
  // `Tz < 100` it NARROWED the band — halving it at Tz 50 — which is the one direction a leak filter
  // may never move, and it re-opened the descender leak for condensed text. `hypot(c,d)` is the em
  // in both the horizontal and the vertical case. Found by two lenses independently.
  // [WS7 round 5, 2026-09-04]
  const desc = 0.25 * col2;
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

/**
 * The footprint of a VERTICAL-writing run (pdf.js marks one with `dir: 'ttb'`,
 * `pdf.worker.mjs:32549`, only when `font.vertical`). Measured in real pdf.js 6.3.289 before
 * writing this, on dvipdfmx's `vertical.pdf` (the pdf.js test file, `Identity-V`) and on a
 * synthetic `Identity-V` run with default vertical metrics — in units of the glyph size, the ink
 * spans −0.42…+0.42, −0.46…+0.49 and −0.48…+0.05 ACROSS the column, and from −0.06…−0.15 below the
 * origin DOWN to the full advance (−4.89 of 5 glyphs, −2.96 of 3, −6.89 of 7). So a vertical run is
 * CENTRED on its origin across the column and extends DOWNWARD by its advance.
 *
 * pdf.js swaps the item's size fields for a vertical font — `width` is the glyph size and `height`
 * the advance (`pdf.worker.mjs:35909-35912`) — and the advance moves the text matrix by a NEGATIVE
 * amount along the second column (`translateTextMatrix(0, scaledDim)` with `scaledDim` from
 * `vmetric[0]` or `-glyphWidth`), which `runBidiTransform` then reports as `Math.abs(totalHeight)`
 * (`:35958`). The sign lives only in `dir`. The horizontal branch above placed this box to the RIGHT
 * of the origin and ABOVE it — the wrong side on both axes — so a redaction over the column missed
 * the text (a leak) and one drawn above the column's start removed it (data loss).
 *
 * The padding is an over-approximation, the only direction a leak filter may move: across, ±0.6 of
 * the glyph size covers a centred glyph up to 1.2 em wide and a default-metrics glyph (placed from
 * −DW/2, pdf.js's `vx`) up to 1.1 em wide; along, 0.1 em above the first origin and past the last
 * advance. A font whose per-glyph vertical metrics (`/W2`) place ink further out is not covered —
 * `getTextContent` does not expose those metrics.
 */
function verticalItemRedacted(
  item: RawTextItem,
  red: RedactionRect,
  pageTopY: number,
  col1: number,
  col2: number,
): boolean {
  const [a, b, c, d, e, f] = item.transform;
  const across = 0.6 * (Math.abs(item.width) || col1);
  const pad = 0.1 * col2;
  // A run of only zero-width diacritics has advance 0 (`if (category.isZeroWidthDiacritic) scaledDim = 0`
  // in the glyph loop), so `height` can be 0; fall back to one em along the column, the same fallback the
  // horizontal branch gives `extent2`, rather than collapse the footprint to the padding alone.
  const along = Math.abs(item.height) || col2;
  const ux = a / col1, uy = b / col1;
  const vx = c / col2, vy = d / col2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of [-across, across]) {
    for (const t of [pad, -(along + pad)]) {
      xs.push(e + ux * s + vx * t);
      ys.push(f + uy * s + vy * t);
    }
  }
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const topY = pageTopY - Math.max(...ys);
  const botY = pageTopY - Math.min(...ys);
  return x0 < red.x + red.width && x1 > red.x && topY < red.y + red.height && botY > red.y;
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
  linkAnchor?: string;
  /**
   * Limits row 22: set when links cover only part of this word's text — consecutive slices of `text` (they rejoin to
   * it), each with its own link. The word keeps its whole geometry; the parts become separate runs only when runs are
   * built, so a link can never move text (a part given its own position sorted between other items' words).
   */
  linkParts?: Array<{ text: string; linkUrl?: string; linkAnchor?: string }>;
  underline?: boolean;
  strikethrough?: boolean;
}

export interface Line {
  words: Word[];
  y: number;
  size: number; // dominant font size on the line
  x0: number;
  x1: number;
  rtl?: boolean; // line reads right-to-left (letterDirection, settled in buildParagraph when near even)
}

// Same line when baselines are within half the font size (pdfminer.six recipe).
const LINE_Y_TOL = 0.5;
// Insert a space when the horizontal gap exceeds this fraction of the font size.
const SPACE_GAP = 0.15;

/**
 * Whether a word space belongs between two consecutive words in reading order, given the empty gap between their
 * boxes: wider than `SPACE_GAP` of the smaller font size, and neither side already carries whitespace. The one rule the
 * DOCX export and the edit-text prefill share (limits row 51 — the prefill joined with '' and dropped it).
 */
export function needsWordSpace(gap: number, prev: { text: string; size: number }, next: { text: string; size: number }): boolean {
  return gap > SPACE_GAP * Math.min(prev.size, next.size) && !/\s$/.test(prev.text) && !/^\s/.test(next.text);
}
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
 *   3. A gap lies in the inner 20–80% zone, is ≥ 5% of the region's width or {@link MIN_GUTTER_PT}, whichever is
 *      smaller, and has words on both sides; of several,
 *      the one nearest the region's centre is cut (limits row 21).
 */
/**
 * A gutter this wide splits columns even when it is under 5% of the region (limits row 21). Real two-column papers
 * leave 12–17 pt (BERT, A4) — 2–3% of the page — so the 5% rule alone never split one, and their Word/Markdown/text
 * export interleaved the two columns line by line. 10 pt was measured on 408 pages: every page it newly splits is a
 * genuine multi-column layout; at 8 pt figures with a label column beside their content (GPT-3's prompt examples)
 * start to split, while Publication 17's ~8 pt gutters stay unsplit (a stated bound). The floor applies to the gap
 * measured on 2 pt bins, which loses 2–4 pt: a DRAWN gutter of 14 pt or more always splits, 11 pt or less never.
 */
const MIN_GUTTER_PT = 10;
/** The share of the page's text height, from its lowest baseline, taken as the footer band for gutter search (row 45). */
const FOOTER_BAND = 0.05;
/**
 * A gutter measured at 6–10 pt (on the 2 pt bins) splits only between two BODY blocks (limits row 46): Publication 17's
 * three-column body pages leave ~8 pt gutters (6 pt measured), and lowering the 10 pt floor for everyone also splits a
 * narrow label column beside its content (GPT-3's prompt examples, gap 4–8 pt) — a smaller number cannot tell them
 * apart. A body block has at least {@link MIN_BODY_LINES} baselines and a quarter of the region's width on EACH side of the
 * cut: a label column fails both (≤ 16 lines, 15% of the page), a body column passes both with margin (53–70+ lines; 27% at
 * the page, 40% inside a half — the width is the region's, so a 4-column page splits at its middle and then again).
 */
const NARROW_GUTTER_PT = 6;
const MIN_BODY_LINES = 20;
const MIN_BODY_WIDTH = 0.25;

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
  // Limits row 45: a page number or footer sits in the gutter of a two-column paper (ResNet: a centred `2` 14pt into a
  // 22.5pt gutter, one item of 175) and one item left a clean gap under the floor. The gutter is looked for without the
  // page's BOTTOM edge band; those words still go to a column by their centre (`sides`, `splitColumns`). The TOP band is
  // not excluded: a title block lives there and is row 44's problem, and dropping it would put a centred title in the
  // wrong column. Skipped when it would leave fewer than two baselines, or when no word is in the body.
  const yLo = Math.min(...words.map(w => w.y ?? 0)), yHi = Math.max(...words.map(w => w.y ?? 0));
  const footerCut = yLo + FOOTER_BAND * (yHi - yLo);
  const body = words.filter(w => (w.y ?? 0) > footerCut);
  const gutterWords = new Set(body.map(w => Math.round(w.y ?? 0))).size >= 2 ? body : words;
  for (const w of gutterWords) {
    const s = Math.max(0, Math.floor(w.x / BIN));
    const e = Math.min(bins - 1, Math.ceil((w.x + w.width) / BIN));
    for (let i = s; i <= e; i++) covered[i] = 1;
  }
  const regionW = bounds.max - bounds.min;
  // Search only in the inner 20–80% zone (of the region) to avoid margin false positives.
  const left = Math.floor((bounds.min + regionW * 0.2) / BIN);
  const right = Math.ceil((bounds.min + regionW * 0.8) / BIN);
  // Every clean gutter in the zone, then the one to cut at: among those at least as wide as the minimum, the one
  // nearest the region's CENTRE (limits row 21, D10). Cutting at the widest-first-found gutter bisected a
  // 4-column page 1|3, and the 3 half got one more cut before the depth cap — 3 groups. A central cut halves the
  // column count at every level, so 4 columns take two levels and 5–8 take three.
  const gaps: { len: number; mid: number }[] = [];
  let gapStart = -1;
  for (let i = left; i <= right; i++) {
    if (covered[i] === 0) {
      if (gapStart === -1) gapStart = i;
    } else if (gapStart !== -1) {
      gaps.push({ len: i - gapStart, mid: Math.round((gapStart + i - 1) / 2) * BIN });
      gapStart = -1;
    }
  }
  if (gapStart !== -1) gaps.push({ len: right - gapStart + 1, mid: Math.round((gapStart + right) / 2) * BIN });
  // A candidate needs words on BOTH sides: a gap with nothing beyond it is the margin between the text and the edge
  // of the search zone, not a gutter. Filtered before the choice, because on a page whose text stops short of the
  // zone's edge that margin can lie nearer the centre than the real gutter — choosing it and refusing afterwards
  // left such a page unsplit (measured, limits row 21: a 14pt two-column page 290pt wide).
  const sides = (mid: number) => words.some(w => w.x + w.width / 2 < mid) && words.some(w => w.x + w.width / 2 >= mid);
  const floor = Math.min(regionW * 0.05, MIN_GUTTER_PT);
  const bodyBlocks = (mid: number) => {
    const side = (ws: typeof words) => ws.length > 0
      && new Set(ws.map(w => Math.round(w.y ?? 0))).size >= MIN_BODY_LINES
      && Math.max(...ws.map(w => w.x + w.width)) - Math.min(...ws.map(w => w.x)) >= MIN_BODY_WIDTH * regionW;
    return side(words.filter(w => w.x + w.width / 2 < mid)) && side(words.filter(w => w.x + w.width / 2 >= mid));
  };
  const wide = gaps.filter(g => sides(g.mid) && (g.len * BIN >= floor || (g.len * BIN >= Math.min(floor, NARROW_GUTTER_PT) && bodyBlocks(g.mid))));
  if (!wide.length) return null;
  const centre = bounds.min + regionW / 2;
  // Ties go to the leftmost, as the first-found rule did.
  return wide.reduce((b, g) => (Math.abs(g.mid - centre) < Math.abs(b.mid - centre) ? g : b)).mid;
}

/** Depth cap for recursive column splitting: three levels of central cuts → up to 8 column groups (limits row 21 —
 * it was 2, which with first-found gutters topped out at 3 in practice). Each level still needs a clean gutter of
 * 5% of its region with words on both sides, so a depth that finds none adds nothing. */
const COLUMN_MAX_DEPTH = 3;

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
 * Reverse a string by codepoint (surrogate-pair-safe) and NFKC-normalize the result — the text search's FALLBACK
 * match only (`textSearchHandler`), tried after a raw miss. The export does NOT use it since limits row 19: pdf.js
 * already returns every RTL item in logical order (`runBidiTransform` runs UAX#9 L2 on each text chunk,
 * pdf.worker.mjs), so reversing it spelled every Arabic word backwards in DOCX / Markdown / text. A genuinely mixed
 * Arabic+Latin string gets char-level bidi instead of a blanket reversal.
 */
export function reverseRtlText(s: string): string {
  if (isArabicText(s) && /[A-Za-z0-9]/.test(s)) {
    return visualToLogical(s, 'rtl').normalize('NFKC');
  }
  return [...s].reverse().join('').normalize('NFKC');
}

/** Letters in a word — the strong characters its pdf.js `dir` speaks for. Digits, punctuation and spaces are not. */
function letterCount(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

/**
 * The base direction of a line or paragraph: RTL when its RTL items carry more LETTERS than its LTR ones. Counting
 * letters, not items, is limits row 19: `النص (RTL) هنا` is two Arabic items and three Latin/punctuation ones, and an
 * item majority read it left-to-right. `null` when nothing carries a letter (a line of digits or punctuation).
 */
export function letterDirection(parts: ReadonlyArray<{ text: string; rtl: boolean }>): boolean | null {
  let r = 0, l = 0;
  for (const p of parts) {
    const n = letterCount(p.text);
    if (p.rtl) r += n; else l += n;
  }
  return r + l === 0 ? null : r > l;
}

/**
 * The direction of a text-layer ROW of per-glyph spans or items (copy, search): RTL when more than half of the spans
 * that carry a letter are Arabic. A span with no letter — a bracket, digits, a full stop — abstains, as a letter-less
 * item does in {@link letterDirection}: counting it against RTL read `النص (RTL) هنا` (two Arabic spans, three others)
 * as English (limits row 43). Arabic marks still vote Arabic; this is a span count, not a letter count, because pdf.js
 * emits Arabic one glyph per span and a letter count would let one long Latin word outvote a whole Arabic line.
 * A row with no letter at all is not RTL.
 */
export function rowIsRtl(texts: readonly string[]): boolean {
  let rtl = 0, voters = 0;
  for (const t of texts) {
    if (isArabicText(t)) { rtl++; voters++; }
    else if (letterCount(t) > 0) voters++;
  }
  return rtl * 2 > voters;
}

/**
 * Order one line's words into LOGICAL reading order. pdf.js returns each item's text already in logical order, so
 * only the ORDER of the items is decided here; their text is left as it is (NFKC-folded when RTL, for presentation
 * forms).
 *
 * The base direction is {@link letterDirection} (falling back to an item majority when no word has a letter). Each
 * word's direction is its pdf.js `dir`, except a NEUTRAL word — no letters and not RTL: brackets, full stops,
 * digits — which takes the direction of its strong neighbours when they agree and the line's otherwise, the line
 * direction standing in past either end (UAX#9 N1/N2 at item granularity). Then {@link logicalItemOrder} applies L2 at
 * item granularity for either base: an Arabic phrase split across two items inside an English line reads right to
 * left, and a Latin run inside an Arabic line stays forward. A neutral that resolved to RTL is marked `rtl`, so it
 * joins the Arabic run it sits in.
 *
 * Not modelled: a producer that draws RTL glyphs in logical order (pdf.js then reverses them into visual order, and
 * its own copy is wrong the same way), explicit embeddings, and bidi inside one item (pdf.js has resolved it).
 */
export function orderLineWords<T extends { x: number; width: number; rtl: boolean; text: string }>(
  words: T[],
  baseRtl?: boolean,
): { words: T[]; rtl: boolean } {
  const byLetters = letterDirection(words);
  const rtl = baseRtl
    ?? byLetters
    ?? (words.length > 0 && words.reduce((n, x) => n + (x.rtl ? 1 : 0), 0) * 2 > words.length);
  const visual = [...words].sort((a, b) => a.x - b.x); // page left→right
  // A word without letters is NEUTRAL whatever its flag says: pdf.js marks Arabic-Indic digits rtl, and this function
  // marks a neutral it resolved to RTL as rtl, so a second pass over its own output (`buildParagraph`'s tiebreak) must
  // not read those back as strong.
  const letterStrong = visual.map(w => (letterCount(w.text) > 0 ? w.rtl : null));
  // UAX#9 W7 at item granularity: a number touching a Latin item belongs to it (`v` + `2.0.0` in an Arabic line is
  // `v2.0.0`, not `2.0.0v` — Chrome draws them as two items).
  const strong = letterStrong.map((d, i) =>
    d === null && /\d/.test(visual[i].text) && (letterStrong[i - 1] === false || letterStrong[i + 1] === false) ? false : d);
  const resolved = strong.map((d, i) => {
    if (d !== null) return d;
    let left: boolean | null = null, right: boolean | null = null;
    for (let k = i - 1; k >= 0 && left === null; k--) left = strong[k];
    for (let k = i + 1; k < strong.length && right === null; k++) right = strong[k];
    const a = left ?? rtl, b = right ?? rtl;
    return a === b ? a : rtl;
  });
  const dirOf = new Map(visual.map((w, i) => [w, resolved[i]]));
  const ordered = logicalItemOrder(visual, w => dirOf.get(w) as boolean, rtl)
    .map(w => (dirOf.get(w) ? { ...w, rtl: true, text: w.text.normalize('NFKC') } : { ...w, rtl: false }));
  return { words: mirrorShapeBrackets(ordered), rtl };
}

const OPENING = new Set(['(', '[', '{']);
const CLOSING = new Set([')', ']', '}']);

/** True when the brackets in `text` never close before they open and all close. */
function bracketsBalanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (OPENING.has(ch)) depth++;
    else if (CLOSING.has(ch) && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Producers disagree on what a mirrored bracket glyph MEANS. In an RTL run the glyph drawn for a logical `(` looks like
 * `)`; LibreOffice's ToUnicode maps it to the logical `(`, Chrome's (arabic-allcases.pdf) to the shape `)`. pdf.js
 * mirrors nothing. So a line whose logical bracket order closes before it opens (`)RTL(`) and balances once its
 * RTL-placed bracket-only items are mirrored came from a shape-mapping producer, and those items are mirrored;
 * a line that already balances is left alone. A bracket glued inside a larger LTR item cannot be reached here.
 */
export function mirrorShapeBrackets<T extends { rtl: boolean; text: string }>(words: T[]): T[] {
  const joined = words.map(w => w.text).join('');
  if (!/[()[\]{}]/.test(joined) || bracketsBalanced(joined)) return words;
  const isBracketOnly = (t: string) => /^[\s()[\]{}]+$/.test(t);
  const mirrored = words.map(w => (w.rtl && isBracketOnly(w.text)
    ? { ...w, text: [...w.text].map(c => (OPENING.has(c) || CLOSING.has(c) ? mirroredChar(c) ?? c : c)).join('') }
    : w));
  return bracketsBalanced(mirrored.map(w => w.text).join('')) ? mirrored : words;
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
    // Order words for reading (items only — pdf.js already gives each RTL item's text in logical order).
    const ordered = orderLineWords(line.words);
    line.words = ordered.words;
    line.rtl = ordered.rtl;
    line.x0 = Math.min(...line.words.map(w => w.x));
    line.x1 = Math.max(...line.words.map(w => w.x + w.width));
    line.size = line.words.reduce((m, w) => (w.text.length > m.text.length ? w : m), line.words[0]).size;
  }
  return lines;
}

/** A gap past `PARA_GAP` within this factor of the column's typical in-paragraph gap is still a wrap (limits row 41). */
const WRAP_SLACK = 1.1;
const sizeKey = (size: number) => Math.round(size * 2) / 2;

/**
 * The typical in-paragraph baseline gap per font size (half-point key) in one column: the lower median of the gaps
 * between consecutive same-size lines that `PARA_GAP` already calls a wrap. A size with fewer than two such gaps has
 * no typical gap.
 */
function typicalLineGaps(lines: Line[]): Map<number, number> {
  const gaps = new Map<number, number[]>();
  for (let k = 1; k < lines.length; k++) {
    const a = lines[k - 1], b = lines[k];
    if (Math.abs(a.size - b.size) >= 1) continue;
    const size = Math.max(a.size, b.size), gap = a.y - b.y;
    if (gap <= 0 || gap > PARA_GAP * size) continue;
    const key = sizeKey(size);
    const list = gaps.get(key);
    if (list) list.push(gap); else gaps.set(key, [gap]);
  }
  const out = new Map<number, number>();
  for (const [key, list] of gaps) {
    if (list.length < 2) continue;
    list.sort((x, y) => x - y);
    out.set(key, list[Math.floor((list.length - 1) / 2)]);
  }
  return out;
}

/** The widest a uniformly leaded wrap may sit past `PARA_GAP` (limits row 52: Chrome's `line-height: 1.6` is 1.608). */
const UNIFORM_WRAP_MAX = 1.75;
/** Two consecutive gaps are the same leading when they differ by at most this fraction... */
const UNIFORM_TOL = 0.01;
/** ...and a later gap is that leading when it is within this fraction of it (rounding slack, NOT WRAP_SLACK's 10%). */
const UNIFORM_ACCEPT = 0.02;
/**
 * The widest line must span at least this share of the page for "fills the measure" to mean anything: in a column of
 * equal-width single-line items (dates, an address block, a sidebar) those lines ARE the widest, so each is full by
 * construction. A wrapped paragraph's column is well over this on a one-column page and on each side of a two-column one.
 */
const MIN_MEASURE_SHARE = 0.3;
/** A line "fills the measure" — it ran out of room, so the text continues below — at this share of the column width. */
const FULL_LINE = 0.85;

/** A gap inside one line wider than this many sizes is a COLUMN gap (a table row), not a word space (limits row 52). */
const COLUMN_GAP = 1.0;

/** Whether a line has a column-sized gap between two of its words — prose wraps do not; table rows do. */
function hasColumnGap(line: Line): boolean {
  const w = [...line.words].sort((p, q) => p.x - q.x);
  for (let i = 1; i < w.length; i++) if (w[i].x - (w[i - 1].x + w[i - 1].width) > COLUMN_GAP * line.size) return true;
  return false;
}

/**
 * Limits row 52: the uniform leading of a size that has NO typical gap. A paragraph set at `line-height: 1.6` has every
 * wrap gap at 1.608 sizes, just past `PARA_GAP`, so {@link typicalLineGaps} (which counts only gaps up to it) finds
 * nothing to compare with. Two CONSECUTIVE same-size gaps (three lines in a row) in (PARA_GAP, UNIFORM_WRAP_MAX] sizes that
 * agree within `UNIFORM_TOL` are that page's leading. Only a size with no typical gap gets one, and it is honoured only where the line
 * above fills the measure and neither line holds a column gap ({@link groupLinesIntoParagraphs}) — one gap, or unequal
 * ones, is not evidence of a wrap, and equal-spaced table rows would otherwise read as one.
 */
function uniformLineGaps(lines: Line[], typical: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  let prevGap = 0, prevKey = NaN;
  for (let k = 1; k < lines.length; k++) {
    const a = lines[k - 1], b = lines[k];
    let gap = 0, key = NaN;
    if (Math.abs(a.size - b.size) < 1) {
      const size = Math.max(a.size, b.size), g = a.y - b.y;
      if (g > PARA_GAP * size && g <= UNIFORM_WRAP_MAX * size && !typical.has(sizeKey(size))) { gap = g; key = sizeKey(size); }
    }
    if (gap > 0 && key === prevKey && Math.abs(gap - prevGap) <= UNIFORM_TOL * prevGap && !out.has(key)) out.set(key, prevGap);
    prevGap = gap; prevKey = key;
  }
  return out;
}

/**
 * Stage 2 — group lines into paragraphs on baseline-gap or font-size jumps.
 *
 * Limits row 41: `PARA_GAP` alone split a wrapped line whose box grew — a Latin fallback font inside an Arabic
 * paragraph (Chrome print-to-PDF) put it 22.50pt under its predecessor against a 22.38pt threshold. A gap past the
 * threshold is still a wrap when it is within `WRAP_SLACK` of the column's typical in-paragraph gap at that size,
 * unless the line opens with a list marker. A tightly spaced page keeps its breaks: LaTeX papers put paragraphs 1.613
 * sizes apart on lines 1.2 apart (measured). Measured on 22 PDFs, 6 boundaries change: 4 wraps rejoin (the Arabic
 * line, a Schedule C sentence, two table captions) and 2 IRS 1040 form rows now join the row below — a bound.
 */
export function groupLinesIntoParagraphs(lines: Line[], pageWidth?: number): Line[][] {
  const typical = typicalLineGaps(lines);
  // Limits row 52 needs the page width: without one there is nothing to say a line "fills the measure", so it is off.
  const measure = Math.max(0, ...lines.map(l => l.x1 - l.x0));
  const uniform = pageWidth !== undefined && measure >= MIN_MEASURE_SHARE * pageWidth
    ? uniformLineGaps(lines, typical) : new Map<number, number>();
  const paraLines: Line[][] = [];
  for (const line of lines) {
    const current = paraLines[paraLines.length - 1];
    const prev = current?.[current.length - 1];
    const sameSizeBand = prev ? Math.abs(prev.size - line.size) < 1 : false;
    let closeEnough = false;
    if (prev) {
      const size = Math.max(prev.size, line.size), gap = prev.y - line.y;
      const t = typical.get(sizeKey(size));
      const u = uniform.get(sizeKey(size));
      closeEnough = gap <= PARA_GAP * size ||
        (t !== undefined && gap <= WRAP_SLACK * t && !detectListPrefix(line.words.map(w => w.text).join(' '))) ||
        // Limits row 52: a uniformly leaded wrap, read only off a line that fills the measure.
        (u !== undefined && Math.abs(gap - u) <= UNIFORM_ACCEPT * u && prev.x1 - prev.x0 >= FULL_LINE * measure &&
          !hasColumnGap(prev) && !hasColumnGap(line) && !detectListPrefix(line.words.map(w => w.text).join(' ')));
    }
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
    // Consecutive same-direction words form a segment; its union box is what sits next to the segment before it. At a
    // direction change the logical neighbour is at the FAR end of the previous segment (the last Arabic glyph of
    // `نظام` read left to right is its leftmost), so the space is measured between the two segments' boxes.
    const segOf: number[] = [];
    const segBox: { x0: number; x1: number }[] = [];
    line.words.forEach((w, i) => {
      if (i === 0 || w.rtl !== line.words[i - 1].rtl) segBox.push({ x0: w.x, x1: w.x + w.width });
      const b = segBox[segBox.length - 1];
      b.x0 = Math.min(b.x0, w.x); b.x1 = Math.max(b.x1, w.x + w.width);
      segOf.push(segBox.length - 1);
    });
    const boxGap = (a: { x0: number; x1: number }, b: { x0: number; x1: number }) => Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
    for (const [wi, w] of line.words.entries()) {
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
        linkAnchor: w.linkAnchor,
        vertAlign,
        underline: w.underline,
        strikethrough: w.strikethrough,
      };
      let text = w.text;
      if (prevWord) {
        // The empty space between the two boxes, whichever side each is on: consecutive words in reading order
        // advance leftward in an RTL run and rightward in an LTR one, on a line of either direction (limits row 19 —
        // a direction-keyed formula lost the space inside an embedded run: 'MicrosoftWord').
        const gap = segOf[wi] !== segOf[wi - 1]
          ? boxGap(segBox[segOf[wi - 1]], segBox[segOf[wi]])
          : boxGap({ x0: prevWord.x, x1: prevWord.x + prevWord.width }, { x0: w.x, x1: w.x + w.width });
        const needsSpace = needsWordSpace(gap, prevWord, w);
        if (needsSpace) text = ' ' + text;
      }
      const parts = w.linkParts ?? [{ text: w.text, linkUrl: w.linkUrl, linkAnchor: w.linkAnchor }];
      parts.forEach((part, pi) => {
        const partStyle = { ...style, linkUrl: part.linkUrl, linkAnchor: part.linkAnchor };
        const partText = pi === 0 ? text.slice(0, text.length - w.text.length) + part.text : part.text;
        const last = runs[runs.length - 1];
        if (
          last &&
          last.bold === partStyle.bold &&
          last.italic === partStyle.italic &&
          last.fontFamily === partStyle.fontFamily &&
          last.rtl === partStyle.rtl &&
          last.psName === partStyle.psName &&
          last.color === partStyle.color &&
          last.linkUrl === partStyle.linkUrl &&
          last.linkAnchor === partStyle.linkAnchor &&
          last.vertAlign === partStyle.vertAlign &&
          last.underline === partStyle.underline &&
          last.strikethrough === partStyle.strikethrough &&
          Math.abs(last.fontSize - partStyle.fontSize) < 0.6
        ) {
          last.text += partText;
        } else {
          runs.push({ text: partText, ...partStyle });
        }
      });
      prevWord = w;
    }
    if (li < group.length - 1) {
      const last = runs[runs.length - 1];
      if (last && !/\s$/.test(last.text)) last.text += ' ';
    }
  }
  return runs;
}

/** Share of a line's letters that are right-to-left, or null when it has none. */
function rtlShare(words: ReadonlyArray<{ text: string; rtl: boolean }>): number | null {
  let r = 0, l = 0;
  for (const w of words) {
    const n = letterCount(w.text);
    if (w.rtl) r += n; else l += n;
  }
  return r + l ? r / (r + l) : null;
}
const AMBIGUOUS = (share: number | null) => share !== null && share >= 0.35 && share <= 0.65;

/**
 * Direction is a PARAGRAPH property (UAX#9 P2), but lines are ordered before they are grouped. A line whose letters
 * are near even (35–65% right-to-left) takes the direction of its paragraph's letters; when those are near even too,
 * the side it is flush with decides — flush right and ragged left reads right to left (limits row 19: a wrapped line
 * `support@example.com … v2.0.0 … 2026.` of an Arabic paragraph is 18 Latin letters against 17 Arabic). A line flush
 * on BOTH sides — a full line, a justified body line — takes the side the paragraph's other lines are flush with when
 * those that are flush on one side only all agree (limits row 42: a wrapped `برنامج PDFturbo` above a flush-right
 * `الجديد` in a table cell); when they disagree or there are none, it keeps its own reading.
 */
function settleAmbiguousLines(group: Line[], colLeft: number, colRight: number): void {
  const groupShare = rtlShare(group.flatMap(l => l.words));
  const flush = (l: Line) => {
    const tol = indentTolerance(l.size);
    return { left: Math.abs(l.x0 - colLeft) <= tol, right: Math.abs(l.x1 - colRight) <= tol };
  };
  for (const line of group) {
    if (!AMBIGUOUS(rtlShare(line.words))) continue;
    let want: boolean | null = null;
    if (groupShare !== null && !AMBIGUOUS(groupShare)) want = groupShare > 0.5;
    else {
      const f = flush(line);
      if (f.right && !f.left) want = true;
      else if (f.left && !f.right) want = false;
      else if (f.left && f.right) {
        const sides = new Set(group.filter(l => l !== line).map(flush).filter(o => o.left !== o.right).map(o => o.right));
        if (sides.size === 1) want = [...sides][0];
      }
    }
    if (want !== null && want !== line.rtl) {
      const ordered = orderLineWords(line.words, want);
      line.words = ordered.words;
      line.rtl = ordered.rtl;
    }
  }
}

/**
 * The text of one table cell, built like a paragraph: lines, their reading order, the near-even line settled against
 * the cell's own extent (the item extent, so the lattice and tagged paths agree by construction), spaces from the gaps
 * between boxes (limits row 42).
 */
function cellLinesText(words: Word[], fonts: FontInfoMap): string {
  if (!words.length) return '';
  const lines = clusterWordsIntoLines(words);
  settleAmbiguousLines(lines, Math.min(...words.map(w => w.x)), Math.max(...words.map(w => w.x + w.width)));
  return buildRunsFromLines(lines, fonts).map(r => r.text).join('').replace(/\s+/g, ' ').trim();
}

/** {@link cellLinesText} for the grid builders' items (`buildTableGrid`'s injected cell text, limits row 42). */
export function bidiCellText(items: TableTextItem[]): string {
  return cellLinesText(items.map(it => ({
    text: it.text, x: it.x, y: it.y, width: Math.abs(it.width ?? 0), size: it.size ?? 12, fontName: '', rtl: it.rtl === true,
  })), {});
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
  settleAmbiguousLines(group, colLeft, colRight);
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


  const alignment: FlowParagraph['alignment'] =
    isCentered ? 'center' : isRight ? 'right' : isJustified ? 'justify' : 'left';

  const para: FlowParagraph = {
    runs,
    heading: 0 as const,
    alignment,
    // Letters, not characters (spaces and punctuation have no direction); lines that all read one way — after
    // settleAmbiguousLines — carry the paragraph with them.
    rtl: group.every(l => l.rtl) ? true : group.every(l => !l.rtl) ? false : letterDirection(runs) ?? false,
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
  const paraLines = groupLinesIntoParagraphs(lines, pageWidth);

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
  const grid = buildTableGrid(hRules, vRules, inRegion, TABLE_TOL, bidiCellText);
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
 * strictly better than today's zero-table output). Borderless tables are not
 * detected HERE (no vertical rules → []) — `reconstructPage` asks `inferBorderlessGridForFlow` when this returns
 * nothing (C9, limits row 20). Returns [] when no both-axes grid is found
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
  const rtl = letterDirection(runs) ?? false; // same rule as the untagged path (limits row 19)
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
    return cellLinesText(words, fonts);
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
/**
 * Limits row 22 — cut a text item where a link rectangle's left or right edge crosses it, so a link covering part of an
 * item tags only that part. pdf.js merges abutting text runs into one item, so a citation or "see Section 3" link
 * usually sits INSIDE a longer item, and tagging by the item's centre either linked the whole line or none of it
 * (measured on the corpus: 792 of 4,434 links landed on no item centre, most of the links in the arXiv papers).
 *
 * pdf.js gives no per-glyph positions, so an edge becomes a character index proportionally to the item's width, then
 * snaps within two characters to a token start (left edge) or end (right edge) — a link covers whole tokens. Only called on text that
 * survived the redaction filter: a boundary estimated a character off can move text between two pieces of a
 * surviving item, never out from under a redaction. Returns one piece — the item as it was — when no edge crosses it.
 */
export function splitItemAtLinks(
  str: string, x: number, width: number, cy: number, links: ReadonlyArray<FlowLinkRect>,
): Array<{ text: string; x: number; width: number }> {
  const n = str.length;
  if (n < 2 || width <= 0) return [{ text: str, x, width }];
  const isWord = (c: string) => /[\p{L}\p{N}]/u.test(c);
  const cuts = new Set<number>();
  for (const ln of links) {
    if (cy < ln.y0 || cy > ln.y1 || ln.x1 <= x || ln.x0 >= x + width) continue;
    for (const [edge, opens] of [[ln.x0, true], [ln.x1, false]] as const) {
      if (edge <= x || edge >= x + width) continue;
      let idx = Math.round(((edge - x) / width) * n);
      // A left edge snaps to where a token STARTS, a right edge to where one ENDS — so the space beside a linked word
      // stays outside the link whichever side of it the proportional estimate fell.
      const fits = (i: number) => i > 0 && i < n && (opens ? !isWord(str[i - 1]) && isWord(str[i]) : isWord(str[i - 1]) && !isWord(str[i]));
      let best = -1;
      for (let d = 0; d <= 2 && best < 0; d++) {
        for (const i of [idx - d, idx + d]) if (fits(i)) { best = i; break; }
      }
      if (best > 0) idx = best;
      if (idx > 0 && idx < n) cuts.add(idx);
    }
  }
  if (!cuts.size) return [{ text: str, x, width }];
  const bounds = [0, ...[...cuts].sort((a, b) => a - b), n];
  const pieces: Array<{ text: string; x: number; width: number }> = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const [a, b] = [bounds[k], bounds[k + 1]];
    pieces.push({ text: str.slice(a, b), x: x + (width * a) / n, width: (width * (b - a)) / n });
  }
  return pieces;
}

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
    // Limits row 22: an LTR, horizontal item is cut where a link's edge crosses it (`splitItemAtLinks`) and the centre
    // test runs per piece. The pieces become `linkParts` of ONE word with the item's geometry, colour and rules.
    const w = Math.abs(it.width);
    const cy = y + size * 0.4;
    const pieces = links?.length && it.dir !== 'rtl' && !it.transform[1] && !it.transform[2]
      ? splitItemAtLinks(it.str, x, w, cy, links)
      : [{ text: it.str, x, width: w }];
    const tagged = pieces.map(pc => {
      let linkUrl: string | undefined;
      let linkAnchor: string | undefined;
      if (links?.length) {
        const cx = pc.x + pc.width / 2;
        for (const ln of links) {
          if (cx >= ln.x0 && cx <= ln.x1 && cy >= ln.y0 && cy <= ln.y1) { linkUrl = ln.url; linkAnchor = ln.anchor; break; }
        }
      }
      return { text: foldLatinLigatures(pc.text), linkUrl, linkAnchor };
    });
    const uniform = tagged.every(t => t.linkUrl === tagged[0].linkUrl && t.linkAnchor === tagged[0].linkAnchor);
    words.push({
      text: foldLatinLigatures(it.str), x, y, width: w, size, fontName: it.fontName, rtl: it.dir === 'rtl', color,
      linkUrl: uniform ? tagged[0].linkUrl : undefined, linkAnchor: uniform ? tagged[0].linkAnchor : undefined,
      linkParts: uniform ? undefined : tagged, underline, strikethrough,
    });
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
  // `width` is read only by the borderless detector below: it cannot find a column without knowing where text ENDS.
  const tableInput: TableTextItem[] = words.map(w => ({ x: w.x, y: w.y, text: w.text, width: w.width, rtl: w.rtl, size: w.size }));
  const detected = rules?.length && vRules?.length
    ? _detectLatticeRegions(tableInput, rules, vRules)
    : [];
  // C9 (limits row 20): with no ruled table, a table drawn with whitespace alone. Its grid is built from EVERY word on
  // the page, so the whole page is the table and no word is left to the paragraphs — the flow gate refuses indexes and
  // contents pages, which pass the geometric one.
  if (!detected.length) {
    const grid = inferBorderlessGridForFlow(tableInput, { cellText: bidiCellText });
    if (grid) {
      const page: FlowPage = { width: pageWidth, height: pageHeight, paragraphs: [], tables: [{ grid, y: Math.max(...words.map(w => w.y + w.size)), borderless: true }] };
      const margins = computeMargins(words, pageWidth, pageHeight);
      if (margins) page.margins = margins;
      return page;
    }
  }
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
