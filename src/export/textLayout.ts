/**
 * Where each line of an overlay text box is drawn — the ONE layout shared by the export bake
 * (`renderText`) and the redaction drop's drawn-extent test (`textExtent.ts`).
 *
 * A text box has a fixed height and the bake never wraps or clips, so its lines can be drawn below
 * and to the right of the stored box. The drop must therefore test where the lines ARE drawn, and a
 * leak filter whose safety depends on a second copy of this arithmetic agreeing with the first is
 * this repo's most-repeated defect shape — hence one function, called by both.
 */
import type { TextElement } from '../elements/textElement';
import { applyListMarkers } from '../utils/listMarkers';
import { isArabicText } from '../utils/flowDoc';
import { effectiveLineWidth, justifyWordSpacing } from './styledText';

/** Anything that measures a string at a size — a pdf-lib `PDFFont` or a `StandardFontEmbedder`. */
export interface WidthMeasurer {
  widthOfTextAtSize(text: string, size: number): number;
}

export type TextLayoutInput = Pick<TextElement,
  'text' | 'x' | 'y' | 'width' | 'fontSize' | 'lineHeight' | 'align' | 'list' | 'charSpacing' | 'horizontalScale' | 'baselineShift'>;

/** An Arabic line is measured and placed by `drawArabicLine`, so only its baseline is laid out here. */
export interface ArabicLaidLine { index: number; line: string; baseY: number; arabic: true }
export interface LatinLaidLine {
  index: number; line: string; baseY: number; arabic: false;
  /** Offset from the box's left edge (alignment). Never negative. */
  off: number;
  /** Natural width of the line at the size it is drawn at. */
  lineW: number;
  /** Tw for a justified, non-last line; 0 otherwise. When > 0 the line is stretched to `boxW`. */
  wordSpacing: number;
  boxW: number;
}
export type LaidLine = ArabicLaidLine | LatinLaidLine;

/**
 * Lay out every non-empty line. `advanced` is the bake's own switch (`hasAdvancedText(te) && !rotation`):
 * it decides whether the line is measured at the sub/superscript size with Tc/Tz, and whether justify
 * applies. An empty line still advances the index, so the lines after it keep their positions.
 */
export function layoutTextLines(te: TextLayoutInput, font: WidthMeasurer, advanced: boolean): LaidLine[] {
  const lineHeight = te.fontSize * (te.lineHeight ?? 1.2);
  const drawSize = te.baselineShift ? te.fontSize * 0.65 : te.fontSize;
  const lines = te.list ? applyListMarkers(te.text, te.list) : te.text.split('\n');
  const out: LaidLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // 0.9 = measured Arial fontBoundingBoxAscent/fontSize ratio (avg across 8–72px);
    // aligns PDF baseline with the browser's CSS text baseline. Max residual error < 0.6pt.
    const baseY = te.y + te.fontSize * 0.9 + i * lineHeight;
    if (isArabicText(line)) { out.push({ index: i, line, baseY, arabic: true }); continue; }
    // Measure width using the effective size (drawSize accounts for sub/superscript shrink).
    const measureSize = advanced ? drawSize : te.fontSize;
    const lineW = advanced
      ? effectiveLineWidth(font, line, measureSize, te.charSpacing ?? 0, te.horizontalScale ?? 100)
      : font.widthOfTextAtSize(line, te.fontSize);
    const boxW = te.width || lineW;
    const isLast = i === lines.length - 1;
    let wordSpacing = 0;
    let off = 0;
    if (advanced && te.align === 'justify' && !isLast) {
      const spaces = (line.match(/ /g) ?? []).length;
      // PDF spec §9.4.4: the Tw word-spacing displacement is scaled by Tz/100 at render
      // time, so to fill the on-page gap we must divide by the horizontal-scale factor.
      wordSpacing = justifyWordSpacing(boxW, lineW, spaces, te.horizontalScale ?? 100);
    } else {
      off = te.align === 'center' ? Math.max(0, (boxW - lineW) / 2)
        : te.align === 'right' ? Math.max(0, boxW - lineW) : 0;
    }
    out.push({ index: i, line, baseY, arabic: false, off, lineW, wordSpacing, boxW });
  }
  return out;
}
