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

/**
 * Largest start number (limits row 28): twelve digits, the widest the panel pads to. It keeps every stamped
 * number an exact integer that `String()` writes in digits — past 2^53 it would round, and past 1e21 it would
 * print in exponent form.
 */
export const BATES_MAX_START = 999_999_999_999;

const MODES: readonly BatesMode[] = ['bates', 'page'];
const POSITIONS: readonly BatesPosition[] = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];

/** A finite number truncated to an integer and clamped to [lo, hi], or `fallback` when it is not a finite number. */
function intIn(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.trunc(v)));
}

/**
 * Bates settings as the stamp may use them (limits row 28). Every field of `raw` that has the wrong type or lies
 * outside its set falls back to `fallback`'s field; numbers are clamped into range. A restored session blob and
 * the panel's form both go through here, so nothing reaches the export that the panel could not have produced.
 */
export function normalizeBatesSettings(raw: unknown, fallback: BatesSettings): BatesSettings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...fallback };
  const r = raw as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : fallback.enabled,
    mode: MODES.includes(r.mode as BatesMode) ? r.mode as BatesMode : fallback.mode,
    prefix: typeof r.prefix === 'string' ? r.prefix : fallback.prefix,
    startNumber: intIn(r.startNumber, 0, BATES_MAX_START, fallback.startNumber),
    digits: intIn(r.digits, 1, 12, fallback.digits),
    position: POSITIONS.includes(r.position as BatesPosition) ? r.position as BatesPosition : fallback.position,
    fontSize: intIn(r.fontSize, 6, 72, fallback.fontSize),
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : fallback.color,
  };
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
