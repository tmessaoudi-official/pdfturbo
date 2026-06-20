/**
 * DocModel → PDF renderer (#1d, Track B). The flow→PDF sibling of `flowDocWriters.ts`.
 *
 * Renders the DOCX editor's editable model (paragraphs + per-run bold/italic) to a
 * selectable-text PDF using @cantoo/pdf-lib Helvetica StandardFonts: run-level word-wrap,
 * pagination, per-run font selection. Zero new dependencies.
 *
 * Ceiling (matches the editor's own model limits): tables / images / styles / colors /
 * font faces / headers-footers / lists / alignment / doc page-size are NOT rendered.
 * Non-WinAnsi scripts (CJK / Arabic / emoji) are sanitized to '?' — StandardFonts encode
 * CP1252 only; font-embedding is the future path. High-fidelity raster export (docx-preview)
 * is the documented future Approach B.
 */

import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import type { DocModel, DocParagraph } from './docModel';

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

interface Token {
  text: string;
  font: PDFFont;
  width: number;
  /** A space precedes this token when it is NOT the first token on its line. */
  spaceBefore: boolean;
  /** Width of a space in this token's font. */
  spaceW: number;
}

/**
 * Render the editable DocModel (paragraphs + per-run bold/italic) to a selectable-text PDF.
 * Run-level tokenization preserves inter-run spaces AND mid-word font changes; long tokens
 * are hard-broken by character. Non-WinAnsi text is sanitized to '?' (see {@link sanitizeWinAnsi}).
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

  const drawLine = (line: Token[]): void => {
    if (y - lineH < margin) newPage();
    let x = margin;
    line.forEach((tok, idx) => {
      if (idx > 0 && tok.spaceBefore) x += tok.spaceW;
      if (tok.text) page.drawText(tok.text, { x, y: y - size, size, font: tok.font });
      x += tok.width;
    });
    y -= lineH;
  };

  /** Tokenize one paragraph; preserves inter-run whitespace via a carried `pendingSpace`. */
  const tokenize = (p: DocParagraph): Token[] => {
    const toks: Token[] = [];
    let pendingSpace = false;
    for (const run of p.runs) {
      const { text, replaced } = sanitizeWinAnsi(run.text ?? '');
      if (replaced) hadUnsupportedChars = true;
      const font = fontFor(run.bold, run.italic);
      const spaceW = font.widthOfTextAtSize(' ', size);
      for (const part of text.split(/(\s+)/)) {
        if (part === '') continue;
        if (/^\s+$/.test(part)) {
          pendingSpace = true;
          continue;
        }
        // `part` is a whitespace-free word; hard-break it if wider than the content width.
        let chunk = '';
        let firstChunk = true;
        const flush = (): void => {
          toks.push({
            text: chunk,
            font,
            width: font.widthOfTextAtSize(chunk, size),
            spaceBefore: firstChunk ? pendingSpace : false,
            spaceW,
          });
          firstChunk = false;
          chunk = '';
        };
        for (const ch of part) {
          if (chunk !== '' && font.widthOfTextAtSize(chunk + ch, size) > contentW) flush();
          chunk += ch;
        }
        if (chunk !== '') flush();
        pendingSpace = false;
      }
    }
    return toks;
  };

  for (const p of model.paragraphs) {
    const toks = tokenize(p);
    if (toks.length === 0) {
      if (y - lineH < margin) newPage();
      y -= lineH;
      continue;
    }
    let line: Token[] = [];
    let lineW = 0;
    for (const tok of toks) {
      const add = (line.length > 0 && tok.spaceBefore ? tok.spaceW : 0) + tok.width;
      if (lineW + add > contentW && line.length > 0) {
        drawLine(line);
        line = [tok];
        lineW = tok.width;
      } else {
        line.push(tok);
        lineW += add;
      }
    }
    if (line.length > 0) drawLine(line);
    y -= paraGap;
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
