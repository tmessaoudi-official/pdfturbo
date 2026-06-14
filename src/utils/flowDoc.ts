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
}

export interface FlowParagraph {
  runs: FlowRun[];
  /** 0 = body, 1–3 = heading level (assigned document-wide by assignHeadings). */
  heading: 0 | 1 | 2 | 3;
  alignment: 'left' | 'center' | 'right';
  rtl: boolean;
  /** Set when the paragraph opens a list item; prefix marker stripped from first run. */
  listType?: 'bullet' | 'ordered';
  /** Nesting depth of the list item (0 = top-level). */
  listDepth?: number;
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

export interface FlowPage {
  width: number;
  height: number;
  paragraphs: FlowParagraph[];
  /** Embedded raster images extracted from the PDF page (populated by exportService). */
  images?: FlowImage[];
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
// Numeric ordered markers only — avoids false positives on "A. Firstname" author names.
const _ORDERED_RE = /^\d+[.)]\s+/;

/**
 * Detect and strip a list prefix from the start of a paragraph's text.
 * Returns `{ type, stripped }` when a prefix is found, or null otherwise.
 */
export function detectListPrefix(
  text: string,
): { type: 'bullet' | 'ordered'; stripped: string } | null {
  const bm = _BULLET_RE.exec(text);
  if (bm) return { type: 'bullet', stripped: text.slice(bm[0].length) };
  const om = _ORDERED_RE.exec(text);
  if (om) return { type: 'ordered', stripped: text.slice(om[0].length) };
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

  // 3. Build paragraphs: merge same-style words into runs, infer alignment, bidi, and list type.
  return paraLines.map(group => {
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
    const isCentered =
      group.every(l => Math.abs((l.x0 + l.x1) / 2 - pageCenter) < centerTol) &&
      group.every(l => l.x0 > pageWidth * 0.15);
    const isRight =
      !isCentered &&
      group.every(l => l.x0 > pageWidth * 0.5) &&
      group.every(l => Math.abs(l.x1 - group[0].x1) < pageWidth * 0.02);

    const rtlChars = runs.reduce((n, r) => n + (r.rtl ? r.text.length : 0), 0);
    const totalChars = runs.reduce((n, r) => n + r.text.length, 0);

    const para: FlowParagraph = {
      runs,
      heading: 0 as const,
      alignment: isCentered ? ('center' as const) : isRight ? ('right' as const) : ('left' as const),
      rtl: totalChars > 0 && rtlChars / totalChars > 0.5,
    };

    // List detection: check first run for a leading bullet or ordered marker.
    if (runs.length > 0) {
      const firstText = runs[0].text;
      const trimmed = firstText.trimStart();
      const match = detectListPrefix(trimmed);
      if (match) {
        const leading = firstText.length - trimmed.length;
        runs[0].text = firstText.slice(0, leading) + match.stripped;
        para.listType = match.type;
        para.listDepth = 0;
      }
    }

    return para;
  });
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
  redactions?: RedactionRect[]
): FlowPage {
  const words: Word[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    if (redactions?.length && redactions.some(r => isItemRedacted(it, r, pageHeight))) continue;
    const size = Math.hypot(it.transform[0], it.transform[1]) || Math.abs(it.height) || 12;
    const x = it.transform[4];
    const y = it.transform[5];
    const color = colorMap?.get(`${Math.round(x)},${Math.round(y)}`);
    words.push({ text: it.str, x, y, width: Math.abs(it.width), size, fontName: it.fontName, rtl: it.dir === 'rtl', color });
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

  return { width: pageWidth, height: pageHeight, paragraphs };
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
    .slice(0, 3);

  for (const page of doc.pages) {
    for (const p of page.paragraphs) {
      const sizes = p.runs.map(r => r.fontSize);
      const domSize = sizes.length ? Math.max(...sizes) : bodySize;
      const rank = headingSizes.indexOf(domSize);
      p.heading = rank === -1 ? 0 : ((rank + 1) as 1 | 2 | 3);
    }
  }
}
