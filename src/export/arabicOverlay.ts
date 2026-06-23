/**
 * Arabic overlay rendering for the PDF export path (Phase C).
 *
 * pdf-lib `drawText` cannot render correct RTL Arabic: it lays glyphs out
 * left-to-right, mirroring the line. The fix bypasses drawText and emits a raw Tj
 * from the shaped CIDs:
 *
 *   font.encodeText(text)     →  pdf-lib/fontkit shapes (GSUB) and emits 2-byte
 *                                subset CIDs ALREADY in visual right-to-left order
 *                                — do NOT reverse them. (Reversing renders the line
 *                                mirror-backwards; verified 2026-06-17 against a
 *                                native dir=rtl render: 0.98 correlation when drawn
 *                                straight vs −0.06 when reversed.)
 *   raw Tj via pushOperators  →  the embedded Type0/CID font's W-array advances
 *                                each glyph; setTextMatrix anchors the run
 *
 * The Noto Naskh Arabic face is bundled (OFL) as a .ttf and lazy-fetched, so it
 * is a browser-only path (jsdom can't fetch the asset); guard callers with
 * isArabicText() and only invoke in the real export/browser environment.
 *
 * IMPORTANT — must be a TTF/OTF (SFNT), NOT a WOFF. fontkit/@cantoo-pdf-lib
 * mis-embeds the WOFF1 of this font: only the `ا` glyph outline survives the
 * subset and every other glyph renders blank (verified 2026-06-17 — pdf-lib's
 * own drawText fails identically, so this is the font container, not RTL code).
 * The equivalent TTF embeds cleanly. Do NOT switch this back to a .woff/.woff2.
 *
 * Mixed Arabic + Latin/digit lines get char-level bidi via the shared UAX#9 engine
 * (visualRuns in utils/bidi → drawBidiLine): the engine resolves embedding levels and
 * returns runs already in visual L→R order, each drawn with its own font (Noto vs
 * Helvetica). Known limits (documented ceiling): bracket display-mirroring inside the
 * overlay (fontkit draws the logical glyph); tashkeel/diacritic GPOS positioning is
 * fontkit's weak spot; rotated Arabic elements are drawn upright.
 */
import {
  PDFHexString,
  StandardFonts,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingRgbColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
} from '@cantoo/pdf-lib';
// Vite resolves ?url to the bundled asset URL. MUST be a TTF/OTF (see header note):
// the WOFF of this font is mis-embedded by fontkit/pdf-lib (glyphs render blank).
import notoNaskhUrl from '../assets/fonts/NotoNaskhArabic-Regular.ttf?url';
import { visualRuns } from '../utils/bidi';

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

const _latinFontCache = new WeakMap<PDFDocument, Promise<PDFFont>>();

/** Embed (once per document) Helvetica for the Latin/digit runs of a mixed line. */
function getLatinFont(pdfDoc: PDFDocument): Promise<PDFFont> {
  const existing = _latinFontCache.get(pdfDoc);
  if (existing) return existing;
  const p = pdfDoc.embedFont(StandardFonts.Helvetica);
  _latinFontCache.set(pdfDoc, p);
  return p;
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
  // Mixed Arabic + Latin/Western-digit lines: render per-script with bidi run
  // ordering (#3b) — Noto has no Latin glyphs, so the whole-line path tofu'd them.
  // Pure Arabic falls through to the fast single-run path below, preserving the
  // verified RTL glyph order (#3).
  if (/[A-Za-z0-9]/.test(opts.text)) {
    return drawBidiLine(pdfDoc, page, opts);
  }
  const font = await getArabicFont(pdfDoc);
  // encodeText shapes (fontkit GSUB) + registers subset glyphs, returning 2-byte
  // CIDs ALREADY in visual right-to-left order — emit them straight to Tj. Do NOT
  // reverse: encodeText is not logical-order here, so reversing mirrors the line.
  const cidHex = font.encodeText(opts.text).toString().replace(/^<|>$/g, '');
  if (!cidHex) return;

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
    showText(PDFHexString.of(cidHex)),
    endText(),
    popGraphicsState(),
  );
}

/**
 * Draw a mixed Arabic + Latin/digit line with per-script fonts, ordered by the shared
 * UAX#9 bidi engine. `visualRuns(text)` resolves embedding levels and returns runs
 * ALREADY in visual L→R order (each run's text in LOGICAL order); an RTL run is shaped
 * RTL via Noto (fontkit emits visual glyphs from logical input), an LTR run drawn via
 * Helvetica. No local reversal — the engine owns ordering.
 *
 * A Latin run that Helvetica can't encode (a non-WinAnsi neutral) falls back to the
 * Arabic font so the whole line never throws: pdf-lib base-14 fonts reject non-WinAnsi
 * codepoints (WinAnsiEncoding throws) — an inherent base-14 limit, not a maskable
 * defect. Bracket display-mirroring inside the overlay and tashkeel GPOS positioning
 * remain documented partials.
 */
async function drawBidiLine(pdfDoc: PDFDocument, page: PDFPage, opts: ArabicLineOpts): Promise<void> {
  const arFont = await getArabicFont(pdfDoc);
  const latFont = await getLatinFont(pdfDoc);
  const measured = visualRuns(opts.text).map((r) => {
    if (!r.rtl) {
      try {
        return { text: r.text, useLatin: true, width: latFont.widthOfTextAtSize(r.text, opts.size) };
      } catch {
        // non-WinAnsi neutral → render via Noto instead of throwing the whole line.
        return { text: r.text, useLatin: false, width: arFont.widthOfTextAtSize(r.text, opts.size) };
      }
    }
    return { text: r.text, useLatin: false, width: arFont.widthOfTextAtSize(r.text, opts.size) };
  });
  const total = measured.reduce((s, r) => s + r.width, 0);
  let cx = Math.max(opts.x, opts.right - total);
  const arKey = page.node.newFontDictionary(arFont.name, arFont.ref);
  for (const r of measured) { // ALREADY in visual L→R order — no reverse
    if (r.useLatin) {
      page.drawText(r.text, {
        x: cx, y: opts.y, size: opts.size, font: latFont,
        color: rgb(opts.color.r, opts.color.g, opts.color.b),
      });
    } else {
      const hex = arFont.encodeText(r.text).toString().replace(/^<|>$/g, '');
      if (hex) {
        page.pushOperators(
          pushGraphicsState(),
          beginText(),
          setFillingRgbColor(opts.color.r, opts.color.g, opts.color.b),
          setFontAndSize(arKey, opts.size),
          setTextMatrix(1, 0, 0, 1, cx, opts.y),
          showText(PDFHexString.of(hex)),
          endText(),
          popGraphicsState(),
        );
      }
    }
    cx += r.width;
  }
}
