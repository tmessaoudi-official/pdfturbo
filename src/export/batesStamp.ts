/**
 * Bates / page-numbering stamp (#61). A single per-page label drawn at a chosen
 * corner/edge during export — applied inside buildPageOverlays, so it lands on
 * ALL export paths (full PDF, single page, page image, redaction raster).
 *
 * The stamp number reflects the page's position in the FULL document, so a
 * single-page or range export still reads "page 5 of 10" / keeps its Bates id.
 * Pure here (text + geometry); the pdf-lib draw call lives in exportPipeline.
 */

export type BatesMode = 'bates' | 'page';
export type BatesPosition = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br';

export interface BatesSettings {
  enabled: boolean;
  mode: BatesMode;
  /** Bates prefix, e.g. "ACME-". Ignored in page mode. */
  prefix: string;
  /** Bates first number (the page-1 value). */
  startNumber: number;
  /** Zero-pad width for the Bates number. */
  digits: number;
  position: BatesPosition;
  fontSize: number;
  /** #rrggbb. */
  color: string;
}

/** Stamp text for a page at 1-based full-document position `pageNumber`. */
export function batesStampText(s: BatesSettings, pageNumber: number, pageCount: number): string {
  if (s.mode === 'page') return `${pageNumber} / ${pageCount}`;
  const n = s.startNumber + pageNumber - 1;
  return `${s.prefix}${String(n).padStart(s.digits, '0')}`;
}

/**
 * Bottom-left origin (x, y) for the stamp text in PDF user space, given the page
 * size, the measured text width, the font size and an edge margin.
 */
export function batesPosition(
  position: BatesPosition,
  pageWidth: number,
  pageHeight: number,
  textWidth: number,
  fontSize: number,
  margin: number,
): { x: number; y: number } {
  const top = position[0] === 't';
  const col = position[1]; // l | c | r
  const x = col === 'l' ? margin
    : col === 'r' ? pageWidth - margin - textWidth
      : (pageWidth - textWidth) / 2;
  const y = top ? pageHeight - margin - fontSize : margin;
  return { x, y };
}
