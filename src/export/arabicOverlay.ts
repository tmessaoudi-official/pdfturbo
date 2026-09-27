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
 * Helvetica). Brackets and guillemets at an RTL level are mirrored first (UAX#9 L4 —
 * fontkit draws a glyph as given), and a character Noto has no glyph for — `( ) [ ] •`,
 * `-`, `%` — is drawn in Helvetica instead of as a `.notdef` box (limits row 25, D17).
 * Every glyph sits where fontkit's GPOS positions put it (C19 — a vowel mark's offset is a TJ
 * adjustment plus a text rise; a line with nothing to move is emitted as before). A rotated line (element or
 * page rotation) is drawn along `rotate`.
 */
import {
  PDFArray,
  PDFHexString,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  StandardFonts,
  TextRenderingMode,
  beginText,
  degrees,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  setFillingRgbColor,
  setFontAndSize,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  setTextRenderingMode,
  setTextRise,
  showText,
  type PDFContext,
  type PDFDocument,
  type PDFFont,
  type PDFName,
  type PDFPage,
} from '@cantoo/pdf-lib';
// Vite resolves ?url to the bundled asset URL. MUST be a TTF/OTF (see header note):
// the WOFF of this font is mis-embedded by fontkit/pdf-lib (glyphs render blank).
import notoNaskhUrl from '../assets/fonts/NotoNaskhArabic-Regular.ttf?url';
import { mirrorForDisplay, visualRuns } from '../utils/bidi';
import { cosSinDeg } from '../utils/geometry';

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
    // Registered THROUGH the adapter, not raw: @cantoo/pdf-lib ≥2.8.1 feature-detects a sync
    // `subset.encode()`, which fontkit v1 has under that name with an incompatible signature — every
    // subset embed then dies in `Struct.encode`. See `utils/fontkitAdapter.ts` for the measurement.
    const { adaptFontkit } = await import('../utils/fontkitAdapter');
    pdfDoc.registerFontkit(adaptFontkit(fontkit));
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
  /**
   * Direction the line runs in, degrees CCW in page space. When set, (x, y) is the box's left end
   * of the baseline and `right − x` is the box width MEASURED ALONG that direction; the right-aligned
   * start is then offset along it. Absent = the historical axis-aligned layout, byte-for-byte.
   */
  rotate?: number;
  size: number;
  color: { r: number; g: number; b: number };
  /** Slice-2 advanced attrs, applied to the shaped Arabic (Noto) runs (Feature 4). */
  charSpacing?: number;
  horizontalScale?: number;
  strokeWidth?: number;
}

/** Advanced text style applied to a single shaped Arabic run (Feature 4). */
export interface ArabicRunStyle {
  charSpacing?: number;
  horizontalScale?: number;
  strokeWidth?: number;
}

/**
 * Operator list for ONE shaped Arabic run, mirroring `styledText.drawStyledTextLine`'s
 * ordering so the no-style path is byte-identical to the prior CID emission:
 *   q · BT · rg · [RG · w · Tr] · Tf · [Tc] · [Tz] · Tm · Tj · ET · Q
 * The outline (stroke) is painted in the element's own fill colour (the Slice-2 rule).
 */
export function buildArabicRunOps(
  fontKey: PDFName,
  hex: string,
  x: number,
  y: number,
  size: number,
  color: { r: number; g: number; b: number },
  style: ArabicRunStyle = {},
  rotate = 0,
  shaped?: ShapedRun,
): PDFOperator[] {
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    beginText(),
    setFillingRgbColor(color.r, color.g, color.b),
  ];
  const strokeWidth = style.strokeWidth ?? 0;
  if (strokeWidth > 0) {
    ops.push(
      setStrokingRgbColor(color.r, color.g, color.b), // outline = fill colour
      setLineWidth(strokeWidth),
      setTextRenderingMode(TextRenderingMode.FillAndOutline),
    );
  }
  ops.push(setFontAndSize(fontKey, size));
  const charSpacing = style.charSpacing ?? 0;
  if (charSpacing !== 0) ops.push(setCharacterSpacing(charSpacing));
  const horizontalScale = style.horizontalScale ?? 100;
  if (horizontalScale !== 100) {
    ops.push(PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(horizontalScale)]));
  }
  ops.push(
    setTextMatrix(...rotatedTm(rotate), x, y),
    ...(shaped ? shapedShowOps(hex, shaped, size) : [showText(PDFHexString.of(hex))]),
    endText(),
    popGraphicsState(),
  );
  return ops;
}

/** The linear part of a text matrix turned `deg` CCW (identity at 0). */
function rotatedTm(deg: number): [number, number, number, number] {
  const { c, s } = cosSinDeg(deg);
  return [c, s, -s, c];
}

/**
 * Where a right-aligned run of `width` starts. Axis-aligned (no `rotate`): the historical
 * `max(x, right − width)`. Rotated: offset from (x, y) along the line's direction by however much
 * the box is wider than the run.
 */
function runStart(opts: ArabicLineOpts, width: number): { x: number; y: number } {
  if (opts.rotate === undefined) return { x: Math.max(opts.x, opts.right - width), y: opts.y };
  const along = Math.max(0, opts.right - opts.x - width);
  const { c, s } = cosSinDeg(opts.rotate);
  return { x: opts.x + along * c, y: opts.y + along * s };
}

/**
 * On-page width of a shaped Arabic run accounting for char spacing (Tc) and horizontal
 * scale (Tz). `glyphCount` is the number of shaped 2-byte CIDs (the real glyph units),
 * NOT `text.length`. Used for RTL right-alignment.
 */
export function effectiveArabicWidth(baseWidth: number, glyphCount: number, charSpacing = 0, horizontalScale = 100): number {
  const base = baseWidth + charSpacing * Math.max(0, glyphCount - 1);
  return base * (horizontalScale / 100);
}

/** One shaped glyph as fontkit lays it out (font units), in the visual order encodeText emits its CIDs. */
export interface ShapedGlyph { advanceWidth: number; xAdvance: number; xOffset: number; yOffset: number }

/** fontkit's positions for a run in which at least one glyph moves; see {@link shapedShowOps}. */
export interface ShapedRun { glyphs: readonly ShapedGlyph[]; upem: number; context: PDFContext }

const movedGlyph = (g: ShapedGlyph) => g.xOffset !== 0 || g.yOffset !== 0 || g.xAdvance !== g.advanceWidth;

/**
 * The show operators for a shaped run whose CIDs are `hex` (4 hex digits per glyph), placing every glyph
 * where fontkit's GPOS positions put it (limits row 25, C19). pdf-lib's embedder keeps only each glyph's
 * advance width — a PDF advances a glyph by its /W entry — so a glyph fontkit moves (a vowel mark's
 * xOffset/yOffset, or an xAdvance unlike its advance width) needs a TJ adjustment before it,
 * `-Δ·1000/upem` (the renderer scales it by Tfs·Th like the glyphs), and a vertical offset needs a text
 * rise (`Ts` is in text-space units, NOT scaled by the font size: `yOffset·size/upem`). Consecutive glyphs
 * with nothing between them share one string. The rise is scoped by the caller's `BT … ET` inside `q … Q`.
 */
export function shapedShowOps(hex: string, run: ShapedRun, size: number): PDFOperator[] {
  const { glyphs, upem } = run;
  if (glyphs.length * 4 !== hex.length || !glyphs.some(movedGlyph)) return [showText(PDFHexString.of(hex))];
  const ops: PDFOperator[] = [];
  let pen = 0; // where the PDF pen is, font units from the run start
  let at = 0;  // where fontkit's pen is
  let rise = 0;
  let arr: PDFArray | null = null;
  let str = '';
  const endString = () => { if (str && arr) arr.push(PDFHexString.of(str)); str = ''; };
  const flush = () => {
    endString();
    if (arr) ops.push(PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [arr]));
    arr = null;
  };
  glyphs.forEach((g, i) => {
    if (g.yOffset !== rise) {
      flush();
      rise = g.yOffset;
      ops.push(setTextRise((rise * size) / upem));
    }
    arr ??= PDFArray.withContext(run.context);
    const target = at + g.xOffset;
    if (target !== pen) {
      endString();
      arr.push(PDFNumber.of((-(target - pen) * 1000) / upem));
    }
    str += hex.slice(i * 4, i * 4 + 4);
    pen = target + g.advanceWidth;
    at += g.xAdvance;
  });
  flush();
  if (rise !== 0) ops.push(setTextRise(0));
  return ops;
}

interface FontkitLayout {
  glyphs: Array<{ advanceWidth: number }>;
  positions: Array<{ xAdvance: number; xOffset: number; yOffset: number }>;
}
interface FontkitLike { unitsPerEm: number; layout(text: string, features?: unknown): FontkitLayout }

/**
 * fontkit's positions for `text`, glyph for glyph with the `glyphCount` CIDs encodeText emitted (pdf-lib's
 * encodeText is `font.layout(text, fontFeatures)` mapped to subset CIDs, so the order is the same) — or
 * undefined when no glyph moves, which keeps that run's emission byte-identical to before, or when the
 * embedder is not the fontkit one this reads (a pdf-lib internal: absent → the old unpositioned output).
 */
function shapeOf(font: PDFFont, text: string, glyphCount: number): ShapedRun | undefined {
  const emb = (font as unknown as { embedder?: { font?: FontkitLike; fontFeatures?: unknown } }).embedder;
  const fk = emb?.font;
  if (!fk || typeof fk.layout !== 'function' || !fk.unitsPerEm) return undefined;
  const { glyphs, positions } = fk.layout(text, emb?.fontFeatures);
  if (glyphs.length !== glyphCount || positions.length !== glyphCount) return undefined;
  const shaped = glyphs.map((g, i): ShapedGlyph => ({
    advanceWidth: g.advanceWidth, xAdvance: positions[i].xAdvance, xOffset: positions[i].xOffset, yOffset: positions[i].yOffset,
  }));
  return shaped.some(movedGlyph) ? { glyphs: shaped, upem: fk.unitsPerEm, context: font.doc.context } : undefined;
}

const _coverage = new WeakMap<PDFFont, Set<number>>();

/** The code points the embedded Arabic font has a glyph for (read once per font). */
function coverageOf(font: PDFFont): Set<number> {
  let set = _coverage.get(font);
  if (!set) { set = new Set(font.getCharacterSet()); _coverage.set(font, set); }
  return set;
}

/**
 * Whether a line needs the segmented path: a Bidi_Mirrored character at an RTL level (UAX#9 L4), or a
 * character Noto Naskh has no glyph for — `( ) [ ] •` among them, which drew as `.notdef` boxes and
 * extracted as U+0000. A line needing neither keeps its old emission byte for byte.
 */
function needsSegmentation(arFont: PDFFont, text: string): boolean {
  if (mirrorForDisplay(text) !== text) return true;
  const covered = coverageOf(arFont);
  for (const ch of text) if (!covered.has(ch.codePointAt(0) ?? 0)) return true;
  return false;
}

/**
 * A run drawn in Noto: its CIDs, fontkit's positions when a glyph moves, and the width it is drawn at —
 * the shaped advance (Σ xAdvance) when positioned, else pdf-lib's own width, as before. The one formula
 * drawing and measuring both use, pure-Arabic line or bidi piece.
 */
function notoSeg(arFont: PDFFont, text: string, size: number, cs: number, hs: number): Seg {
  const hex = arFont.encodeText(text).toString().replace(/^<|>$/g, '');
  const shaped = shapeOf(arFont, text, hex.length / 4);
  const base = shaped
    ? (shaped.glyphs.reduce((sum, g) => sum + g.xAdvance, 0) * size) / shaped.upem
    : arFont.widthOfTextAtSize(text, size);
  return { text, useLatin: false, hex, width: effectiveArabicWidth(base, hex.length / 4, cs, hs), shaped };
}

/** Helvetica can draw `text` (WinAnsi), measured the way the bake draws it; null when it cannot. */
function latinSeg(latFont: PDFFont, text: string, size: number): Seg | null {
  try {
    return { text, useLatin: true, hex: '', width: latFont.widthOfTextAtSize(text, size) };
  } catch {
    return null;
  }
}

interface Seg { text: string; useLatin: boolean; hex: string; width: number; shaped?: ShapedRun }

/**
 * Split a line into segments in visual L→R order and measure each one exactly as {@link drawBidiLine}
 * draws it. Shared with {@link measureArabicLine} so the redaction drop tests the width that is drawn.
 *
 * The text is mirrored first (UAX#9 L4, {@link mirrorForDisplay}); `visualRuns` then orders it. An LTR
 * run is drawn in Helvetica (Noto when Helvetica cannot encode it). An RTL run is drawn in Noto, except
 * the characters Noto lacks that Helvetica has: those split off into Helvetica pieces. Inside an RTL run
 * the pieces are laid out right to left, so their ORDER is reversed and so are the characters of each
 * Helvetica piece (`)]` drawn LTR); a Noto piece is not, because fontkit already emits it in visual order.
 * Without mirrored or uncovered characters this is exactly the unsplit run-per-font layout of before.
 */
function measureBidiRuns(arFont: PDFFont, latFont: PDFFont, text: string, size: number, cs: number, hs: number): Seg[] {
  const covered = coverageOf(arFont);
  return visualRuns(mirrorForDisplay(text)).flatMap((r): Seg[] => {
    // non-WinAnsi neutral → render via Noto instead of throwing the whole line.
    if (!r.rtl) return [latinSeg(latFont, r.text, size) ?? notoSeg(arFont, r.text, size, cs, hs)];
    const pieces: Array<{ text: string; latin: boolean }> = [];
    for (const ch of r.text) {
      const latin = !covered.has(ch.codePointAt(0) ?? 0) && latinSeg(latFont, ch, size) !== null;
      const last = pieces[pieces.length - 1];
      if (last && last.latin === latin) last.text += ch;
      else pieces.push({ text: ch, latin });
    }
    return pieces.reverse().map((p) => (p.latin
      ? (latinSeg(latFont, [...p.text].reverse().join(''), size) as Seg)
      : notoSeg(arFont, p.text, size, cs, hs)));
  });
}

/**
 * The width {@link drawArabicLine} gives a line — pure Arabic or mixed — measured through the same
 * font and the same arithmetic. `pdfDoc` only hosts the font embed (a throwaway document is fine).
 * Rejects when the Arabic font cannot be loaded; the caller decides what that means.
 */
export async function measureArabicLine(
  pdfDoc: PDFDocument,
  opts: { text: string; size: number; charSpacing?: number; horizontalScale?: number },
): Promise<number> {
  const arFont = await getArabicFont(pdfDoc);
  const cs = opts.charSpacing ?? 0, hs = opts.horizontalScale ?? 100;
  if (/[A-Za-z0-9]/.test(opts.text) || needsSegmentation(arFont, opts.text)) {
    const latFont = await getLatinFont(pdfDoc);
    return measureBidiRuns(arFont, latFont, opts.text, opts.size, cs, hs).reduce((s, r) => s + r.width, 0);
  }
  return notoSeg(arFont, opts.text, opts.size, cs, hs).width;
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
  const font = await getArabicFont(pdfDoc);
  // Lines with a mirrored bracket or a glyph Noto lacks take the segmented path too (row 25, D17).
  if (/[A-Za-z0-9]/.test(opts.text) || needsSegmentation(font, opts.text)) {
    return drawBidiLine(pdfDoc, page, opts);
  }
  // encodeText shapes (fontkit GSUB) + registers subset glyphs, returning 2-byte
  // CIDs ALREADY in visual right-to-left order — emit them straight to Tj. Do NOT
  // reverse: encodeText is not logical-order here, so reversing mirrors the line.
  const seg = notoSeg(font, opts.text, opts.size, opts.charSpacing ?? 0, opts.horizontalScale ?? 100);
  if (!seg.hex) return;

  const style: ArabicRunStyle = {
    charSpacing: opts.charSpacing, horizontalScale: opts.horizontalScale, strokeWidth: opts.strokeWidth,
  };
  // Right-align within the element box (RTL convention); never overflow left.
  const start = runStart(opts, seg.width);

  const fontKey = page.node.newFontDictionary(font.name, font.ref);
  page.pushOperators(...buildArabicRunOps(fontKey, seg.hex, start.x, start.y, opts.size, opts.color, style, opts.rotate ?? 0, seg.shaped));
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
 * defect. Brackets are mirrored and uncovered characters drawn in Helvetica by
 * {@link measureBidiRuns}, and every Noto piece is positioned by fontkit's GPOS (C19).
 */
async function drawBidiLine(pdfDoc: PDFDocument, page: PDFPage, opts: ArabicLineOpts): Promise<void> {
  const arFont = await getArabicFont(pdfDoc);
  const latFont = await getLatinFont(pdfDoc);
  // Slice-2 attrs apply to the shaped Arabic (Noto) runs; the Latin runs keep drawText
  // (no Tc/Tz/stroke — documented partial), so their width stays unscaled.
  const style: ArabicRunStyle = {
    charSpacing: opts.charSpacing, horizontalScale: opts.horizontalScale, strokeWidth: opts.strokeWidth,
  };
  const measured = measureBidiRuns(arFont, latFont, opts.text, opts.size, opts.charSpacing ?? 0, opts.horizontalScale ?? 100);
  const total = measured.reduce((s, r) => s + r.width, 0);
  const start = runStart(opts, total);
  const rot = opts.rotate ?? 0;
  const { c, s } = cosSinDeg(rot);
  let cx = start.x, cy = start.y;
  const arKey = page.node.newFontDictionary(arFont.name, arFont.ref);
  for (const r of measured) { // ALREADY in visual L→R order — no reverse
    if (r.useLatin) {
      page.drawText(r.text, {
        x: cx, y: cy, size: opts.size, font: latFont,
        color: rgb(opts.color.r, opts.color.g, opts.color.b),
        ...(opts.rotate === undefined ? {} : { rotate: degrees(rot) }),
      });
    } else if (r.hex) {
      page.pushOperators(...buildArabicRunOps(arKey, r.hex, cx, cy, opts.size, opts.color, style, rot, r.shaped));
    }
    // Advance along the line's own direction (identity when unrotated: y stays put).
    if (opts.rotate === undefined) cx += r.width;
    else { cx += r.width * c; cy += r.width * s; }
  }
}
