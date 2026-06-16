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

import { redactionRectToContent } from './geometry';

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
}

export interface FlowDoc {
  pages: FlowPage[];
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
export function isItemRedacted(item: RawTextItem, red: RedactionRect, pageHeight: number): boolean {
  const size = Math.hypot(item.transform[0], item.transform[1]) || Math.abs(item.height) || 12;
  const x0 = item.transform[4];
  const x1 = x0 + Math.abs(item.width);
  // Baseline in y-up PDF space; glyph box spans roughly [baseline, baseline+size].
  const baseline = item.transform[5];
  // Convert to top-origin (y-down) space: topY is the box top, botY the box bottom.
  const topY = pageHeight - (baseline + size);
  const botY = pageHeight - baseline;
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
  // Search only in the inner 20–80% zone to avoid false positives at page margins.
  const left = Math.floor(pageWidth * 0.2 / BIN);
  const right = Math.ceil(pageWidth * 0.8 / BIN);
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
  if (bestLen * BIN < pageWidth * 0.05) return null;

  // Require words on both sides of the split — a gap with nothing on one side is a margin, not a column.
  const leftCount = words.filter(w => w.x + w.width / 2 < bestMid).length;
  const rightCount = words.filter(w => w.x + w.width / 2 >= bestMid).length;
  return leftCount > 0 && rightCount > 0 ? bestMid : null;
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
 * Reverse a string by codepoint (surrogate-pair-safe). pdf.js returns RTL runs
 * already visually reversed; reversing again restores logical character order so
 * Word's bidi engine can lay it out correctly. (Combining-mark reordering is an
 * accepted edge-case limitation — see the Arabic-export ceiling notes.)
 */
export function reverseRtlText(s: string): string {
  return [...s].reverse().join('');
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
function buildParagraph(
  group: Line[],
  gi: number,
  paraLines: Line[][],
  fonts: FontInfoMap,
  pageWidth: number,
  colLeft: number,
  colRight: number,
): { para: FlowParagraph; geom: ParaGeom } {
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
  pageRotation = 0
): FlowPage {
  // Redaction rects arrive in editor DISPLAYED space; text items are reported in
  // UNROTATED content space. Un-rotate the rects once so the intersection test in
  // isItemRedacted compares like-for-like (identity at rotation 0). CORE-P0-1.
  const contentRedactions = redactions?.length
    ? redactions.map(r => redactionRectToContent(r, pageWidth, pageHeight, pageRotation))
    : undefined;
  const words: Word[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    if (contentRedactions?.length && contentRedactions.some(r => isItemRedacted(it, r, pageHeight))) continue;
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
    words.push({ text: it.str, x, y, width: Math.abs(it.width), size, fontName: it.fontName, rtl: it.dir === 'rtl', color, linkUrl, underline, strikethrough });
  }

  const split = detectColumnSplit(words, pageWidth);
  let paragraphs: FlowParagraph[];
  if (split !== null) {
    const mid = split;
    const leftWords  = words.filter(w => w.x + w.width / 2 < mid);
    const rightWords = words.filter(w => w.x + w.width / 2 >= mid);
    paragraphs = [
      ...reconstructColumn(leftWords, fonts, pageWidth),
      ...reconstructColumn(rightWords, fonts, pageWidth),
    ];
  } else {
    paragraphs = reconstructColumn(words, fonts, pageWidth);
  }

  const margins = computeMargins(words, pageWidth, pageHeight);
  const page: FlowPage = { width: pageWidth, height: pageHeight, paragraphs };
  if (margins) page.margins = margins;
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
    for (const p of page.paragraphs) {
      const sizes = p.runs.map(r => r.fontSize);
      const domSize = sizes.length ? Math.max(...sizes) : bodySize;
      const rank = headingSizes.indexOf(domSize);
      p.heading = rank === -1 ? 0 : ((rank + 1) as 1 | 2 | 3 | 4 | 5 | 6);
    }
  }
}
