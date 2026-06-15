/**
 * Searchable-OCR layer — invisible-text mechanism (validation spike, 2026-06-15).
 *
 * Today the OCR pipeline inserts VISIBLE `TextElement`s (see `ocrHandler.ts`).
 * The searchable-OCR layer instead lays the recognized words as INVISIBLE text
 * (PDF text render mode 3, `3 Tr`) precisely over the scanned image, so a scan
 * becomes selectable / searchable / screen-reader-accessible with zero visible
 * change — the canonical "OCR a scan" deliverable.
 *
 * This module is the validated mechanism only: a pure pixel→point transform plus
 * the raw invisible-text operator emission (same `pushOperators` pattern as
 * `src/export/arabicOverlay.ts`, with `setTextRenderingMode(Invisible)` added).
 * App/UI wiring (toggle, SourcePdf swap, undo, export) is a separate follow-up.
 *
 * Spec: docs/superpowers/specs/2026-06-15-searchable-ocr-spike-design.md
 */
import {
  PDFDocument,
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  type PDFFont,
  type PDFName,
  type PDFOperator,
} from '@cantoo/pdf-lib';
import { hasNonWinAnsi } from '../utils/contentStreamEditor';
import { isArabicText } from '../utils/flowDoc';

/** An OCR word bbox in image-pixel space, top-left origin, at the render scale. */
export interface OcrBBoxLike {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A recognized word: text plus its image-pixel bbox. */
export interface OcrWordLike {
  text: string;
  bbox: OcrBBoxLike;
}

/** Where one word's invisible text is placed, in PDF points (bottom-left origin). */
export interface TextPlacement {
  /** Left edge of the text run (PDF points). */
  x: number;
  /** Text baseline y (PDF points, y-up). */
  baselineY: number;
  /** Font size (PDF points). */
  size: number;
}

export interface InvisibleTextLayerOpts {
  /** The OCR render scale the bboxes were captured at (image px ÷ scale = points). */
  scale: number;
  /** Target PDF page height in points (for the top-left → bottom-left y flip). */
  pageHeight: number;
  /** Embedded font used to encode the show-text payload. */
  font: PDFFont;
  /** The page resource key for `font` (`page.node.newFontDictionary(font.name, font.ref)`). */
  fontKey: PDFName;
}

/** Smallest font size we will emit; guards degenerate zero-height OCR boxes. */
const MIN_SIZE = 1;

/**
 * Convert one OCR word bbox (image pixels, top-left origin, at `scale`) into a
 * PDF text placement (points, bottom-left origin). The bbox bottom is used as the
 * baseline — descenders are negligible at the placement granularity OCR provides,
 * and selection accuracy depends on the run's left/baseline anchor, not the cap
 * height. Pure → unit-testable without pdf-lib.
 */
export function wordToTextPlacement(
  bbox: OcrBBoxLike,
  scale: number,
  pageHeight: number,
): TextPlacement {
  const x = bbox.x0 / scale;
  const baselineY = pageHeight - bbox.y1 / scale;
  const size = Math.max(MIN_SIZE, (bbox.y1 - bbox.y0) / scale);
  return { x, baselineY, size };
}

/**
 * Build the flat operator list that paints `words` as invisible (`3 Tr`) text at
 * their OCR positions. Hand the result to `page.pushOperators(...ops)`.
 *
 * Per word: `BT · Tr(3) · Tf · Tm · Tj · ET`. Empty / whitespace-only words are
 * skipped so the layer never carries selectable blanks.
 */
export function buildInvisibleTextLayerOps(
  words: ReadonlyArray<OcrWordLike>,
  opts: InvisibleTextLayerOpts,
): PDFOperator[] {
  const { scale, pageHeight, font, fontKey } = opts;
  const ops: PDFOperator[] = [];
  for (const word of words) {
    const text = word.text.trim();
    if (text.length === 0) continue;
    const { x, baselineY, size } = wordToTextPlacement(word.bbox, scale, pageHeight);
    ops.push(
      beginText(),
      setTextRenderingMode(TextRenderingMode.Invisible),
      setFontAndSize(fontKey, size),
      setTextMatrix(1, 0, 0, 1, x, baselineY),
      showText(font.encodeText(text)),
      endText(),
    );
  }
  return ops;
}

/** Which embedded font a recognized word's invisible text should use. */
export interface WordPartition {
  /** Latin-script words encodable by the standard WinAnsi Helvetica font. */
  latin: OcrWordLike[];
  /** Arabic words — emitted via the embedded Noto Naskh CID font (logical order). */
  arabic: OcrWordLike[];
  /** Words dropped from the layer (empty, or a script no bundled font covers). */
  skipped: OcrWordLike[];
}

/**
 * Split recognized words by the font their invisible text needs. Helvetica/WinAnsi
 * covers 7 of the 8 advertised OCR languages (eng/fra/deu/spa/ita/por/nld — their
 * accents are all WinAnsi); Arabic uses the bundled Noto Naskh. Anything neither
 * Arabic nor WinAnsi-safe (e.g. CJK/Cyrillic) is skipped rather than painted as
 * '?'. Empty/whitespace words are skipped. Pure → unit-testable.
 */
export function partitionWordsByFont(words: ReadonlyArray<OcrWordLike>): WordPartition {
  const out: WordPartition = { latin: [], arabic: [], skipped: [] };
  for (const word of words) {
    const text = word.text.trim();
    if (text.length === 0) out.skipped.push(word);
    else if (isArabicText(text)) out.arabic.push(word);
    else if (hasNonWinAnsi(text)) out.skipped.push(word);
    else out.latin.push(word);
  }
  return out;
}

export type SearchableLayerErrorCode = 'ROTATED_PAGE';

/** Typed failure from {@link applySearchableLayerToPdf}; carries a stable `code`. */
export class SearchableLayerError extends Error {
  constructor(readonly code: SearchableLayerErrorCode) {
    super(code);
    this.name = 'SearchableLayerError';
  }
}

/**
 * Lay an invisible, selectable text layer over one source-PDF page at the OCR word
 * positions, returning the rewritten PDF bytes (or `null` when no word survives
 * partitioning). The caller swaps these bytes in via `_applySourcePdfEdit` so the
 * change is undoable and persisted.
 *
 * Latin words use a standard Helvetica; Arabic words use the bundled Noto Naskh
 * (lazily imported — it fetches a font asset, so the Arabic path is browser-only)
 * and are emitted in LOGICAL order: invisible text only needs to be search/select
 * matchable via ToUnicode, NOT visually shaped RTL, so the CID-pair reversal the
 * visible overlay performs is deliberately omitted here.
 *
 * @param sourcePageNum 1-based page number (matches `DocumentPage.sourcePageNum`).
 * @throws SearchableLayerError('ROTATED_PAGE') when the page has a non-zero
 *   `/Rotate` — OCR bboxes are in the rotated render space and would be mis-placed
 *   against pdf-lib's unrotated page coords. Rotated-page support is a follow-up.
 */
export async function applySearchableLayerToPdf(
  srcBytes: Uint8Array,
  sourcePageNum: number,
  words: ReadonlyArray<OcrWordLike>,
  scale: number,
): Promise<Uint8Array | null> {
  const doc = await PDFDocument.load(srcBytes);
  const page = doc.getPage(sourcePageNum - 1);

  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  if (angle !== 0) throw new SearchableLayerError('ROTATED_PAGE');

  const { latin, arabic } = partitionWordsByFont(words);
  if (latin.length === 0 && arabic.length === 0) return null;

  const pageHeight = page.getHeight();
  const ops: PDFOperator[] = [];

  if (latin.length > 0) {
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const fontKey = page.node.newFontDictionary(helv.name, helv.ref);
    ops.push(...buildInvisibleTextLayerOps(latin, { scale, pageHeight, font: helv, fontKey }));
  }

  if (arabic.length > 0) {
    // Browser-only: getArabicFont fetches the bundled Noto Naskh .woff. Lazy so the
    // Latin/jsdom path never pulls the asset.
    const { getArabicFont } = await import('../export/arabicOverlay');
    const arFont = await getArabicFont(doc);
    const fontKey = page.node.newFontDictionary(arFont.name, arFont.ref);
    // Emitted in logical order (no CID reversal). Recovers as real Arabic Unicode
    // (selectable + screen-reader-accessible); exact full-word search is imperfect
    // because fontkit GSUB shaping yields contextual glyphs whose pdf-lib ToUnicode
    // is incomplete — a documented partial, the same ceiling as the visible overlay.
    // A clean-ToUnicode PoC (per-codepoint isolated encoding) was tried and rejected:
    // it traded the artifact for RTL order reversal in pdf.js getTextContent.
    ops.push(...buildInvisibleTextLayerOps(arabic, { scale, pageHeight, font: arFont, fontKey }));
  }

  page.pushOperators(...ops);
  return doc.save();
}
