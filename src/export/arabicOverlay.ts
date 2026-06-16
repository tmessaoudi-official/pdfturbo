/**
 * Arabic overlay rendering for the PDF export path (Phase C).
 *
 * pdf-lib `drawText` cannot render correct RTL Arabic: fontkit shapes only in
 * logical order, and drawText then places the glyphs LEFT-to-right → correct
 * joining but mirrored direction. The fix bypasses drawText:
 *
 *   font.encodeText(logical)  →  pdf-lib shapes (fontkit GSUB) + emits 2-byte
 *                                subset CIDs in logical order
 *   reverse the CID PAIRS     →  visual right-to-left order (joining preserved)
 *   raw Tj via pushOperators  →  the embedded Type0/CID font's W-array advances
 *                                each glyph; setTextMatrix anchors the run
 *
 * The Noto Naskh Arabic face is bundled (OFL) as a .woff and lazy-fetched, so it
 * is a browser-only path (jsdom can't fetch the asset); guard callers with
 * isArabicText() and only invoke in the real export/browser environment.
 *
 * Known limits (documented ceiling): mixed LTR+RTL within one line is treated as
 * a single RTL run; tashkeel/diacritic GPOS positioning is fontkit's weak spot;
 * rotated Arabic elements are drawn upright (rotation not applied here).
 */
import {
  PDFHexString,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFillingRgbColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
} from '@cantoo/pdf-lib';
// Vite resolves ?url to the bundled asset URL (arabic subset, ~small woff).
import notoNaskhUrl from '@fontsource/noto-naskh-arabic/files/noto-naskh-arabic-arabic-400-normal.woff?url';

const _fontCache = new WeakMap<PDFDocument, Promise<PDFFont>>();
let _notoBytes: Promise<Uint8Array> | null = null;

// Bound the font fetch so a hung/slow network can't wedge an export indefinitely.
const FONT_FETCH_TIMEOUT_MS = 15_000;

function loadNotoBytes(): Promise<Uint8Array> {
  if (_notoBytes) return _notoBytes;
  const p = (async () => {
    // M0 #10 — abort a hung fetch instead of awaiting forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FONT_FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(notoNaskhUrl, { signal: controller.signal });
      // A 404/5xx resolves with ok=false; without this check we'd embed an HTML
      // error page as font bytes and fail opaquely downstream.
      if (!r.ok) throw new Error(`Failed to load Arabic font: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  })();
  // M0 #10 — never cache a rejected fetch: a failed promise here would poison every
  // future retry. Clear the slot on failure so the next call fetches afresh.
  p.catch(() => { if (_notoBytes === p) _notoBytes = null; });
  _notoBytes = p;
  return p;
}

/** Embed (once per document) the bundled Arabic font, registering fontkit. */
export function getArabicFont(pdfDoc: PDFDocument): Promise<PDFFont> {
  const existing = _fontCache.get(pdfDoc);
  if (existing) return existing;
  const cached = (async () => {
    const fontkit = (await import('@pdf-lib/fontkit')).default;
    pdfDoc.registerFontkit(fontkit);
    return pdfDoc.embedFont(await loadNotoBytes(), { subset: true });
  })();
  // Same anti-poison rule per document: drop a failed embed so a retry can succeed.
  cached.catch(() => { if (_fontCache.get(pdfDoc) === cached) _fontCache.delete(pdfDoc); });
  _fontCache.set(pdfDoc, cached);
  return cached;
}

/**
 * Reverse the 2-byte CID groups of a pdf-lib encodeText hex string. Input may be
 * the raw hex or the `<...>`-wrapped form; output is bare hex (logical→visual for
 * a single RTL run). Pure → unit-testable.
 */
export function reverseCidHex(hex: string): string {
  const clean = hex.replace(/^</, '').replace(/>$/, '');
  const groups = clean.match(/.{1,4}/g) ?? [];
  return groups.reverse().join('');
}

export interface ArabicLineOpts {
  text: string;
  /** Left edge of the element box (PDF points, y-up page space). */
  x: number;
  /** Baseline y (PDF points, y-up). */
  y: number;
  /** Right edge of the element box; the run is right-aligned to it when wider than the text. */
  right: number;
  size: number;
  color: { r: number; g: number; b: number };
}

/**
 * Draw one Arabic line onto a pdf-lib page in correct shaped, right-to-left order.
 * Must run in a browser (font asset is fetched). Call only for isArabicText lines.
 */
export async function drawArabicLine(
  pdfDoc: PDFDocument,
  page: PDFPage,
  opts: ArabicLineOpts,
): Promise<void> {
  const font = await getArabicFont(pdfDoc);
  // encodeText shapes (fontkit GSUB) + registers glyphs for the subset, returning
  // logical-order CIDs. Reverse the pairs for visual RTL placement.
  const logicalHex = font.encodeText(opts.text).toString();
  const visualHex = reverseCidHex(logicalHex);
  if (!visualHex) return;

  const textWidth = font.widthOfTextAtSize(opts.text, opts.size);
  // Right-align within the element box (RTL convention); never overflow left.
  const startX = Math.max(opts.x, opts.right - textWidth);

  const fontKey = page.node.newFontDictionary(font.name, font.ref);
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setFillingRgbColor(opts.color.r, opts.color.g, opts.color.b),
    setFontAndSize(fontKey, opts.size),
    setTextMatrix(1, 0, 0, 1, startX, opts.y),
    showText(PDFHexString.of(visualHex)),
    endText(),
    popGraphicsState(),
  );
}
