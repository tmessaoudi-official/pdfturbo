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

interface Word {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  fontName: string;
  rtl: boolean;
  color?: string;
  linkUrl?: string;
}

interface Line {
  words: Word[];
  y: number;
  size: number; // dominant font size on the line
  x0: number;
  x1: number;
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
export type ListFormat = 'decimal' | 'lowerLetter' | 'upperLetter';

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
  for (const { re, format, ordinalText } of _ORDERED_MARKERS) {
    const m = re.exec(text);
    if (m) return { type: 'ordered', stripped: text.slice(m[0].length), format, ordinalText };
  }
  return null;
}

/** Build FlowParagraph[] from a pre-sorted, pre-filtered array of words. */
function reconstructColumn(
  words: Word[],
  fonts: FontInfoMap,
  pageWidth: number,
): FlowParagraph[] {
  // 1. Group words into lines by baseline clustering (top of page first: y descending).
  words.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const w of words) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - w.y) <= LINE_Y_TOL * Math.min(line.size, w.size)) {
      line.words.push(w);
    } else {
      lines.push({ words: [w], y: w.y, size: w.size, x0: w.x, x1: w.x + w.width });
    }
  }
  for (const line of lines) {
    line.words.sort((a, b) => a.x - b.x);
    line.x0 = Math.min(...line.words.map(w => w.x));
    line.x1 = Math.max(...line.words.map(w => w.x + w.width));
    line.size = line.words.reduce((m, w) => (w.text.length > m.text.length ? w : m), line.words[0]).size;
  }

  // 2. Group lines into paragraphs on baseline-gap or font-size jumps.
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

  // Column reference edges: the robust left/right of the body block. Using a
  // 5th/95th percentile of line edges (not the raw min/max) ignores a single
  // stray-left or stray-right line — a margin glyph, a hanging marker — while
  // still tracking the leftmost real body text (so indented blocks measure as
  // insets FROM it, not vs. the indented majority).
  // Failure mode prevented: one outlier line dragging the column edge, which
  // would either hide a real indent or invent a false one.
  const colLeft = lines.length ? percentile(lines.map(l => l.x0), 0.05, 0) : 0;
  const colRight = lines.length ? percentile(lines.map(l => l.x1), 0.95, pageWidth) : pageWidth;
  const indentTol = (s: number) => Math.max(2, s * 0.5); // half a font size, ≥2pt

  // 3. Build paragraphs: merge same-style words into runs, infer alignment, bidi, and list type.
  const paras: FlowParagraph[] = paraLines.map((group, gi) => {
    const runs: FlowRun[] = [];
    for (let li = 0; li < group.length; li++) {
      const line = group[li];
      let prevWord: Word | null = null;
      for (const w of line.words) {
        const info = fonts[w.fontName];
        const psName = extractPsName(info?.name ?? w.fontName);
        const style: Omit<FlowRun, 'text'> = {
          bold: isBoldName(psName),
          italic: isItalicName(psName),
          fontSize: Math.round(w.size * 2) / 2,
          fontFamily: familyOf(info),
          rtl: w.rtl,
          psName,
          color: w.color,
          linkUrl: w.linkUrl,
        };
        let text = w.text;
        if (prevWord) {
          const gap = w.x - (prevWord.x + prevWord.width);
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
    const edgeTol = indentTol(domSize);
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

    return para;
  });

  return paras;
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
  links?: FlowLinkRect[]
): FlowPage {
  const words: Word[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    if (redactions?.length && redactions.some(r => isItemRedacted(it, r, pageHeight))) continue;
    const size = Math.hypot(it.transform[0], it.transform[1]) || Math.abs(it.height) || 12;
    const x = it.transform[4];
    const y = it.transform[5];
    const color = colorMap?.get(`${Math.round(x)},${Math.round(y)}`);
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
    words.push({ text: it.str, x, y, width: Math.abs(it.width), size, fontName: it.fontName, rtl: it.dir === 'rtl', color, linkUrl });
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
