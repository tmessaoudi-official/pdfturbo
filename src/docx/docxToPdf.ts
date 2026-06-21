/**
 * DocModel → PDF renderer (#1d, Track B). The flow→PDF sibling of `flowDocWriters.ts`.
 *
 * Renders the DOCX editor's editable model (paragraphs + tables + per-run bold/italic) to a
 * selectable-text PDF using @cantoo/pdf-lib Helvetica StandardFonts: run-level word-wrap,
 * pagination, per-run font selection, and a grid table renderer (equal columns, cell text
 * wrapping, borders, row-level pagination, nested tables). Zero new dependencies.
 *
 * Fidelity (Workstream A, 2026-06-21): heading SIZES (H1–H3 → larger bold), list MARKERS
 * (WinAnsi bullet / decimal·alpha·roman ordinals + per-level indent), run UNDERLINE (drawn
 * line at the baseline) and run COLOR (`w:color` → rgb fill) ARE rendered. Tables render as
 * equal-width grids.
 *
 * Ceiling (matches the editor's own model limits): images / styles / font faces /
 * headers-footers / paragraph alignment / merged cells / per-column widths / doc page-size
 * are NOT rendered. Non-WinAnsi scripts (CJK / Arabic / emoji) are sanitized to '?' —
 * StandardFonts encode CP1252 only; font-embedding is the future path. High-fidelity raster
 * export (docx-preview) is the documented future Approach B.
 */

import { PDFDocument, StandardFonts, rgb, type Color, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import { isDocTable, type DocModel, type DocBlock, type DocParagraph, type DocTable } from './docModel';

/** Point size for a heading level relative to the body `base` size (H1>H2>H3>base). */
export function headingFontSize(level: 1 | 2 | 3, base: number): number {
  const mult = level === 1 ? 1.7 : level === 2 ? 1.4 : 1.18;
  return Math.round(base * mult);
}

const _ROMAN: [number, string][] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];
function _toRoman(n: number): string {
  let out = '';
  let x = Math.max(1, n);
  for (const [v, sym] of _ROMAN) while (x >= v) { out += sym; x -= v; }
  return out;
}
/** 1→a, 26→z, 27→aa (lower-alpha ordered-list ordinal). */
function _toAlpha(n: number): string {
  let out = '';
  let x = Math.max(1, n);
  while (x > 0) { const r = (x - 1) % 26; out = String.fromCharCode(97 + r) + out; x = Math.floor((x - 1) / 26); }
  return out;
}
/**
 * Marker glyph for a list item. Unordered → a WinAnsi-safe bullet at every level (nesting is
 * shown by indent, not glyph — '◦'/'▪' are NOT WinAnsi and would sanitize to '?'). Ordered →
 * decimal / lower-alpha / lower-roman, cycling every 3 levels, with a trailing '.'.
 */
export function listMarkerText(ordered: boolean, ordinal: number, level: number): string {
  if (!ordered) return '•';
  const fmt = ((level % 3) + 3) % 3;
  if (fmt === 1) return `${_toAlpha(ordinal)}.`;
  if (fmt === 2) return `${_toRoman(ordinal)}.`;
  return `${ordinal}.`;
}

/** Parse a #rrggbb hex string into a pdf-lib Color, or undefined (→ default black). */
function _hexColor(hex?: string): Color | undefined {
  if (!hex) return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

export interface DocxToPdfOptions {
  pageWidth?: number;
  pageHeight?: number;
  margin?: number;
  fontSize?: number;
  /** Multiple of fontSize (1.15 ≈ Word default). */
  lineHeight?: number;
  /** Points of vertical space after each paragraph. */
  paragraphGap?: number;
}

export interface DocxToPdfResult {
  bytes: Uint8Array;
  hadUnsupportedChars: boolean;
}

const A4_W = 595.28;
const A4_H = 841.89;
const CELL_PAD = 4;
const CELL_BORDER = 0.5;
const CELL_BORDER_COLOR = rgb(0.6, 0.6, 0.6);

interface Token {
  text: string;
  font: PDFFont;
  /** Point size for this token (heading paragraphs use a larger size). */
  size: number;
  /** Fill color (undefined → default black). */
  color?: Color;
  /** Draw an underline under this token. */
  underline?: boolean;
  width: number;
  /** A space precedes this token when it is NOT the first token on its line. */
  spaceBefore: boolean;
  /** Width of a space in this token's font. */
  spaceW: number;
}

type Line = Token[];

const INDENT_PER_LEVEL = 18; // pt of left indent per list nesting level

/**
 * Per-container list ordinal counter (ordered items restart per contiguous run, broken by a
 * non-list paragraph or a shallower/unordered item). Returns the marker for a paragraph, or
 * null when it is not a list item.
 */
function makeListState(): { markerFor: (p: DocParagraph) => string | null } {
  const counts: number[] = [];
  return {
    markerFor(p: DocParagraph): string | null {
      if (!p.list) { counts.length = 0; return null; }
      const lvl = Math.max(0, p.list.level);
      for (let k = lvl + 1; k < counts.length; k++) counts[k] = 0; // reset deeper levels
      if (p.list.ordered) {
        counts[lvl] = (counts[lvl] ?? 0) + 1;
        return listMarkerText(true, counts[lvl], lvl);
      }
      counts[lvl] = 0; // an unordered item breaks the ordered run at its level
      return '•';
    },
  };
}

/**
 * Render the editable DocModel (paragraphs + tables + per-run bold/italic) to a selectable-text
 * PDF. Run-level tokenization preserves inter-run spaces AND mid-word font changes; long tokens
 * are hard-broken by character. Tables render as equal-column grids with wrapped cell text and
 * borders. Non-WinAnsi text is sanitized to '?' (see {@link sanitizeWinAnsi}).
 */
export async function docModelToPdfBytes(
  model: DocModel,
  opts: DocxToPdfOptions = {},
): Promise<DocxToPdfResult> {
  const pageWidth = opts.pageWidth ?? A4_W;
  const pageHeight = opts.pageHeight ?? A4_H;
  const margin = opts.margin ?? 72;
  const size = opts.fontSize ?? 11;
  const lineH = (opts.lineHeight ?? 1.15) * size;
  const paraGap = opts.paragraphGap ?? 6;
  const contentW = pageWidth - 2 * margin;
  const minRowH = lineH + 2 * CELL_PAD;
  const maxRowH = pageHeight - 2 * margin; // a row taller than this can't be paginated cleanly

  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique);
  const boldItal = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const fontFor = (b?: boolean, i?: boolean): PDFFont =>
    b && i ? boldItal : b ? bold : i ? ital : reg;

  let hadUnsupportedChars = false;
  let page: PDFPage = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const newPage = (): void => {
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  const lineHeightMult = opts.lineHeight ?? 1.15;
  /** Effective font size for a paragraph (headings are larger). */
  const effSize = (p: DocParagraph): number => (p.heading ? headingFontSize(p.heading, size) : size);
  const effLineH = (p: DocParagraph): number => lineHeightMult * effSize(p);
  /** Left indent (pt) of a list item's text — a fixed hanging indent per nesting level. */
  const textIndentFor = (p: DocParagraph): number => (p.list ? (p.list.level + 1) * INDENT_PER_LEVEL : 0);

  /**
   * Tokenize one paragraph for a given TEXT width (already net of any list indent). Preserves
   * inter-run whitespace and carries each run's color / underline + the paragraph's effective
   * size (heading paragraphs are bold). Long tokens are hard-broken by character.
   */
  const tokenize = (p: DocParagraph, textW: number): Token[] => {
    const toks: Token[] = [];
    const ps = effSize(p);
    const headingBold = p.heading !== undefined;
    let pendingSpace = false;
    for (const run of p.runs) {
      const { text, replaced } = sanitizeWinAnsi(run.text ?? '');
      if (replaced) hadUnsupportedChars = true;
      const font = fontFor(run.bold || headingBold, run.italic);
      const color = _hexColor(run.color);
      const underline = run.underline === true;
      const spaceW = font.widthOfTextAtSize(' ', ps);
      for (const part of text.split(/(\s+)/)) {
        if (part === '') continue;
        if (/^\s+$/.test(part)) {
          pendingSpace = true;
          continue;
        }
        let chunk = '';
        let firstChunk = true;
        const flush = (): void => {
          toks.push({
            text: chunk,
            font,
            size: ps,
            color,
            underline,
            width: font.widthOfTextAtSize(chunk, ps),
            spaceBefore: firstChunk ? pendingSpace : false,
            spaceW,
          });
          firstChunk = false;
          chunk = '';
        };
        for (const ch of part) {
          if (chunk !== '' && font.widthOfTextAtSize(chunk + ch, ps) > textW) flush();
          chunk += ch;
        }
        if (chunk !== '') flush();
        pendingSpace = false;
      }
    }
    return toks;
  };

  /** Wrap a paragraph into lines for a given content `width` (list indent applied internally). */
  const layoutParagraph = (p: DocParagraph, width: number): Line[] => {
    const textW = Math.max(8, width - textIndentFor(p));
    const toks = tokenize(p, textW);
    if (toks.length === 0) return [[]];
    const lines: Line[] = [];
    let line: Line = [];
    let lineW = 0;
    for (const tok of toks) {
      const add = (line.length > 0 && tok.spaceBefore ? tok.spaceW : 0) + tok.width;
      if (lineW + add > textW && line.length > 0) {
        lines.push(line);
        line = [tok];
        lineW = tok.width;
      } else {
        line.push(tok);
        lineW += add;
      }
    }
    if (line.length > 0) lines.push(line);
    return lines;
  };

  const colCount = (t: DocTable): number =>
    Math.max(1, ...t.rows.map(r => r.cells.length));

  /** Height a list of blocks occupies within `width` (no drawing) — for cell sizing. */
  const measureBlocks = (blocks: DocBlock[], width: number): number => {
    let h = 0;
    for (const b of blocks) {
      if (isDocTable(b)) h += measureTable(b, width);
      else h += layoutParagraph(b, width).length * effLineH(b) + paraGap;
    }
    return h;
  };

  const measureTable = (t: DocTable, width: number): number => {
    const colW = width / colCount(t);
    let h = 0;
    for (const row of t.rows) {
      let rowH = minRowH;
      for (const cell of row.cells) {
        rowH = Math.max(rowH, measureBlocks(cell.blocks, colW - 2 * CELL_PAD) + 2 * CELL_PAD);
      }
      h += rowH;
    }
    return h;
  };

  /** Draw one wrapped line; its baseline sits at lineTopY−lineSize. Per-token color + underline. */
  const drawLine = (line: Line, textX: number, lineTopY: number, lineSize: number): void => {
    let x = textX;
    const baseline = lineTopY - lineSize;
    line.forEach((tok, idx) => {
      if (idx > 0 && tok.spaceBefore) x += tok.spaceW;
      if (tok.text) {
        page.drawText(tok.text, { x, y: baseline, size: tok.size, font: tok.font, ...(tok.color ? { color: tok.color } : {}) });
        if (tok.underline) {
          const uy = baseline - Math.max(1, tok.size * 0.1);
          page.drawLine({
            start: { x, y: uy }, end: { x: x + tok.width, y: uy },
            thickness: Math.max(0.5, tok.size * 0.06), ...(tok.color ? { color: tok.color } : {}),
          });
        }
      }
      x += tok.width;
    });
  };

  /** Draw a list marker glyph in the gutter to the left of a paragraph's text, at its first line. */
  const drawMarker = (marker: string, xLeft: number, level: number, lineTopY: number, ps: number): void => {
    page.drawText(marker, { x: xLeft + level * INDENT_PER_LEVEL, y: lineTopY - ps, size: ps, font: reg });
  };

  /**
   * Draw blocks within a fixed band starting at `topY`, flowing downward WITHOUT pagination
   * (used inside table cells). Returns the y after the last block. Nested tables recurse.
   */
  const drawBlocksInBand = (blocks: DocBlock[], xLeft: number, topY: number, width: number): number => {
    let cy = topY;
    const list = makeListState();
    for (const b of blocks) {
      if (isDocTable(b)) {
        cy = drawTableInBand(b, xLeft, cy, width);
      } else {
        const marker = list.markerFor(b);
        const ps = effSize(b);
        const lh = effLineH(b);
        const textX = xLeft + textIndentFor(b);
        layoutParagraph(b, width).forEach((line, li) => {
          if (li === 0 && marker) drawMarker(marker, xLeft, b.list?.level ?? 0, cy, ps);
          drawLine(line, textX, cy, ps);
          cy -= lh;
        });
        cy -= paraGap;
      }
    }
    return cy;
  };

  /** Draw a table within a band at absolute `topY` (cell-internal: no pagination). Returns end y. */
  const drawTableInBand = (t: DocTable, xLeft: number, topY: number, width: number): number => {
    const cols = colCount(t);
    const colW = width / cols;
    let cy = topY;
    for (const row of t.rows) {
      let rowH = minRowH;
      for (const cell of row.cells) {
        rowH = Math.max(rowH, measureBlocks(cell.blocks, colW - 2 * CELL_PAD) + 2 * CELL_PAD);
      }
      for (let c = 0; c < cols; c++) {
        const cx = xLeft + c * colW;
        page.drawRectangle({
          x: cx, y: cy - rowH, width: colW, height: rowH,
          borderWidth: CELL_BORDER, borderColor: CELL_BORDER_COLOR,
        });
        const cell = row.cells[c];
        if (cell) drawBlocksInBand(cell.blocks, cx + CELL_PAD, cy - CELL_PAD, colW - 2 * CELL_PAD);
      }
      cy -= rowH;
    }
    return cy;
  };

  /** Top-level paragraph: paginate per line. `marker` (or null) comes from the shared list state. */
  const drawParagraphFlow = (p: DocParagraph, marker: string | null): void => {
    const ps = effSize(p);
    const lh = effLineH(p);
    const textX = margin + textIndentFor(p);
    layoutParagraph(p, contentW).forEach((line, li) => {
      if (y - lh < margin) newPage();
      if (li === 0 && marker) drawMarker(marker, margin, p.list?.level ?? 0, y, ps);
      drawLine(line, textX, y, ps);
      y -= lh;
    });
    y -= paraGap;
  };

  /** Top-level table: paginate per ROW (a row that won't fit moves to a fresh page). */
  const drawTableFlow = (t: DocTable): void => {
    const cols = colCount(t);
    const colW = contentW / cols;
    for (const row of t.rows) {
      let rowH = minRowH;
      for (const cell of row.cells) {
        rowH = Math.max(rowH, measureBlocks(cell.blocks, colW - 2 * CELL_PAD) + 2 * CELL_PAD);
      }
      // Move the whole row to a new page if it won't fit and CAN fit on a blank page.
      if (y - rowH < margin && rowH <= maxRowH) newPage();
      for (let c = 0; c < cols; c++) {
        const cx = margin + c * colW;
        page.drawRectangle({
          x: cx, y: y - rowH, width: colW, height: rowH,
          borderWidth: CELL_BORDER, borderColor: CELL_BORDER_COLOR,
        });
        const cell = row.cells[c];
        if (cell) drawBlocksInBand(cell.blocks, cx + CELL_PAD, y - CELL_PAD, colW - 2 * CELL_PAD);
      }
      y -= rowH;
    }
    y -= paraGap;
  };

  const topList = makeListState();
  for (const block of model.blocks) {
    if (isDocTable(block)) drawTableFlow(block);
    else drawParagraphFlow(block, topList.markerFor(block));
  }

  const bytes = await doc.save();
  return { bytes, hadUnsupportedChars };
}

/** CP1252 high chars (the 0x80–0x9F slots) mapped to their Unicode codepoints. */
const WINANSI_EXTRA = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** True when pdf-lib's WinAnsi StandardFonts can encode this codepoint. */
function _isWinAnsi(cp: number): boolean {
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRA.has(cp);
}

/**
 * Replace every non-WinAnsi codepoint with '?'. Tab/newline/CR are preserved (the caller
 * tokenizes on whitespace). `replaced` is true iff any character was substituted.
 */
export function sanitizeWinAnsi(s: string): { text: string; replaced: boolean } {
  let out = '';
  let replaced = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d || _isWinAnsi(cp)) {
      out += ch;
    } else {
      out += '?';
      replaced = true;
    }
  }
  return { text: out, replaced };
}
