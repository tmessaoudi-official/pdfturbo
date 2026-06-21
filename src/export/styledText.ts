import {
  PDFOperator,
  PDFOperatorNames,
  PDFNumber,
  pushGraphicsState,
  popGraphicsState,
  beginText,
  endText,
  showText,
  setFontAndSize,
  setTextMatrix,
  setFillingRgbColor,
  setStrokingRgbColor,
  setLineWidth,
  setCharacterSpacing,
  setWordSpacing,
  setTextRise,
  setTextRenderingMode,
  TextRenderingMode,
  setGraphicsState,
  type PDFPage,
  type PDFFont,
  type PDFName,
} from '@cantoo/pdf-lib';
import type { TextElement } from '../elements/textElement';

export interface StyledTextOpts {
  text: string;                 // single WinAnsi line (caller splits + excludes Arabic)
  x: number; y: number;         // baseline origin in PDF (y-up) space, post alignment + rotation anchor
  size: number;                 // already scaled (sub/superscript shrink applied by caller)
  font: PDFFont; fontKey: PDFName;
  color: { r: number; g: number; b: number };
  charSpacing?: number;         // Tc, pt
  horizontalScale?: number;     // Tz, percent (100 = none)
  strokeWidth?: number;         // > 0 → fill+stroke (stroke painted in the fill color)
  baselineRise?: number;        // Ts, pt (super +, sub −)
  wordSpacing?: number;         // Tw, pt (justify)
  gsName?: PDFName;             // opacity ExtGState (page.maybeEmbedGraphicsState)
}

/** True when an element needs the raw-operator bake (drawText can't express these). */
export function hasAdvancedText(te: Pick<TextElement,
  'strokeWidth' | 'charSpacing' | 'horizontalScale' | 'baselineShift' | 'align'>): boolean {
  return (te.strokeWidth ?? 0) > 0
    || (te.charSpacing ?? 0) !== 0
    || (te.horizontalScale ?? 100) !== 100
    || te.baselineShift !== undefined
    || te.align === 'justify';
}

/** On-page width of a line accounting for char spacing (Tc) and horizontal scale (Tz). */
export function effectiveLineWidth(font: PDFFont, line: string, size: number, charSpacing = 0, horizontalScale = 100): number {
  const base = font.widthOfTextAtSize(line, size) + charSpacing * Math.max(0, line.length - 1);
  return base * (horizontalScale / 100);
}

/**
 * Per-gap Tw word-spacing to justify a line to boxW, accounting for Tz scaling.
 *
 * PDF spec §9.4.4: the Tw operator displacement is scaled by Th = Tz/100 at render time,
 * so to fill an on-page gap G = (boxW − lineW) across `spaces` gaps the required Tw is
 * G / spaces / (Tz/100), NOT G / spaces.
 *
 * Returns 0 when there is no gap (lineW ≥ boxW) or no word gaps (spaces ≤ 0).
 */
export function justifyWordSpacing(boxW: number, lineW: number, spaces: number, horizontalScale = 100): number {
  if (spaces <= 0 || boxW <= lineW) return 0;
  const scale = (horizontalScale || 100) / 100;
  return (boxW - lineW) / spaces / scale;
}

/** Emit one styled text line via raw operators. WinAnsi only (caller guards Arabic). */
export function drawStyledTextLine(page: PDFPage, o: StyledTextOpts): void {
  const ops: PDFOperator[] = [pushGraphicsState()];
  if (o.gsName) ops.push(setGraphicsState(o.gsName));
  ops.push(beginText(), setFillingRgbColor(o.color.r, o.color.g, o.color.b));
  const strokeWidth = o.strokeWidth ?? 0;
  if (strokeWidth > 0) {
    // Outline is painted in the element's own fill color (no separate stroke color).
    const s = o.color;
    ops.push(
      setStrokingRgbColor(s.r, s.g, s.b),
      setLineWidth(strokeWidth),
      setTextRenderingMode(TextRenderingMode.FillAndOutline),
    );
  }
  ops.push(setFontAndSize(o.fontKey, o.size));
  const charSpacing = o.charSpacing ?? 0;
  if (charSpacing !== 0) ops.push(setCharacterSpacing(charSpacing));
  const wordSpacing = o.wordSpacing ?? 0;
  if (wordSpacing !== 0) ops.push(setWordSpacing(wordSpacing));
  const horizontalScale = o.horizontalScale ?? 100;
  if (horizontalScale !== 100) {
    ops.push(PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(horizontalScale)]));
  }
  const baselineRise = o.baselineRise ?? 0;
  if (baselineRise !== 0) ops.push(setTextRise(baselineRise));
  ops.push(setTextMatrix(1, 0, 0, 1, o.x, o.y), showText(o.font.encodeText(o.text)), endText(), popGraphicsState());
  page.pushOperators(...ops);
}
