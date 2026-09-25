/**
 * A5 (real Chrome) — the drawn-extent footprint contains every pixel the bake actually inks.
 *
 * `textDrawnFootprint` (src/export/textExtent.ts) shares its LINE layout with the bake, but not the
 * glyph band around each line: that comes from font metrics, plus one measured constant (how far a
 * glyph's ink runs past its advance on the right, which pdf-lib's base-14 data does not carry). This
 * file is the pin on those numbers. Each config is exported through the real blank-page bake,
 * rendered by pdf.js, and the bounding box of every non-white pixel must lie inside the footprint.
 *
 * The second half pins the drop's decisions on both sides: overflow into a redaction drops, and the
 * KEPT controls — text that fits beside a redaction, a short Arabic line beside one — stay. Control (b)
 * is what proves Arabic lines are measured: if the font-load fallback (treat the line as reaching the
 * page edge) became the implementation, every Arabic drop case would still pass, for the wrong reason.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { ExportService, dropElementsUnderRedactions, type IExportContext } from '../../src/export/exportService';
import { TextElement, type TextOptions } from '../../src/elements/textElement';
import { RedactionElement } from '../../src/elements/redactionElement';
import { textDrawnFootprint } from '../../src/export/textExtent';
import { measureArabicLine } from '../../src/export/arabicOverlay';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W = 500, H = 400, SCALE = 4;

const measure = async (text: string, size: number, cs?: number, hs?: number) => {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  return measureArabicLine(await PDFDocument.create(), { text, size, charSpacing: cs, horizontalScale: hs });
};

function mk(x: number, y: number, text: string, o: TextOptions & { rotation?: number } = {}): TextElement {
  const { rotation, ...opts } = o;
  const te = new TextElement(x, y, 'p1', { width: 120, height: 20, fontSize: 14, ...opts });
  te.text = text;
  if (rotation) te.rotation = rotation;
  return te;
}

function ctxFor(elements: PDFElement[], rotation = 0): IExportContext {
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  return {
    documentModel: {
      pageCount: 1, currentPageIndex: 0,
      pages: [{ id: 'p1', sourcePdfId: 'blank', sourcePageNum: 0, rotation, blankWidth: W, blankHeight: H }],
      sourcePdfs: new Map(), watermark: { enabled: false }, bates: { enabled: false },
    },
    elements, formValues: {}, currentFilename: 'x.pdf', exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: { info() {}, warn() {}, error(k: string, e?: unknown) { throw new Error(`export error ${k}: ${String(e)}`); }, silent() {} },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {}, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
  } as unknown as IExportContext;
}

/** Bounding box, in DISPLAY points, of every pixel darker than near-white on the exported page. */
async function inkBox(te: TextElement, rotation = 0): Promise<{ x0: number; y0: number; x1: number; y1: number } | null> {
  const bytes = await new ExportService(ctxFor([te as unknown as PDFElement], rotation)).assemblePdfBytes();
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: SCALE });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const cx = c.getContext('2d') as CanvasRenderingContext2D;
  await page.render({ canvas: c, viewport: vp }).promise;
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let py = 0; py < c.height; py++) {
    for (let px = 0; px < c.width; px++) {
      const i = (py * c.width + px) * 4;
      if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) {
        x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px + 1); y1 = Math.max(y1, py + 1);
      }
    }
  }
  if (x0 === Infinity) return null;
  return { x0: x0 / SCALE, y0: y0 / SCALE, x1: x1 / SCALE, y1: y1 / SCALE };
}

const CONFIGS: Array<[string, TextElement, number?]> = [
  ['Helvetica, three lines overflowing a 20pt box', mk(40, 40, 'Line one\nLine two gjpqy\nLine THREE Åj')],
  ['italic, one long line past the right edge', mk(40, 40, 'Italic overflow ffff WWWW', { italic: true })],
  ['bold italic Times', mk(40, 40, 'Times BoldItalic ÅÉÎ fj', { fontFamily: 'Times New Roman', bold: true, italic: true })],
  ['Courier', mk(40, 40, 'Courier monospace text', { fontFamily: 'Courier New' })],
  ['Arabic, longer than its box', mk(40, 40, 'مرحبا بالعالم هذا نص عربي طويل', { width: 60 })],
  ['mixed Arabic and digits', mk(40, 40, 'الرقم 12345 هنا', { width: 50 })],
  ['superscript', mk(40, 40, 'Superscript text', { baselineShift: 'super' })],
  ['subscript', mk(40, 40, 'Subscript gjpqy', { baselineShift: 'sub' })],
  // Two lines of ALL-CAPS: no descenders, so the ink below the last line is the UNDERLINE alone —
  // this config pins the rule's band, not the glyphs'.
  ['underline below the last line', mk(40, 40, 'UNDERLINED\nTWO LINES', { underline: true })],
  ['ordered list', mk(40, 40, 'first\nsecond\nthird', { list: 'ordered' })],
  ['char spacing 5 and width 150%', mk(40, 40, 'Spaced wide', { charSpacing: 5, horizontalScale: 150 })],
  ['negative char spacing', mk(40, 40, 'Tight tracking', { charSpacing: -2 })],
  ['outline stroke 2', mk(40, 40, 'Outlined', { strokeWidth: 2, fontSize: 24 })],
  ['justified, multi-line', mk(40, 40, 'a b c\nd e f\ng', { align: 'justify', width: 200 })],
  ['right-aligned line longer than the box', mk(40, 40, 'Right aligned too long for its box', { align: 'right' })],
  ['centred', mk(40, 40, 'Centred', { align: 'center', width: 200 })],
  ['element rotated 30°', mk(200, 150, 'Rotated line\nand another', { rotation: 30 })],
  ['element rotated 200°', mk(200, 150, 'Upside down', { rotation: 200 })],
  ['page rotated 90°', mk(40, 40, 'On a rotated page\nsecond'), 90],
  ['CJK typed into a box (drawn as ?)', mk(40, 40, '机密文件内容', { width: 20 })],
  // Kerning: pdf-lib's widthOfTextAtSize applies the AFM kerning pairs, but the bake draws plain Tj
  // with none, so a kerned line inks WIDER than its measured width (up to ~0.55 em for Times-Bold
  // "AVAVA" at 40pt). These pin the footprint to the un-kerned drawn advance.
  ['kerning pairs, Times bold, large', mk(40, 40, 'AVAVAVAVA', { fontFamily: 'Times New Roman', bold: true, fontSize: 40 })],
  ['kerning pairs, Arial, large', mk(40, 40, 'AWAY To VAT', { fontSize: 40 })],
  // A first glyph whose ink starts LEFT of its origin (italic j's descender curl): the only config
  // where the ink crosses the box's left edge, so it is what pins the FontBBox left bound.
  ['left-overhanging first glyph (Times italic j)', mk(40, 40, 'jfjf', { fontFamily: 'Times New Roman', italic: true, fontSize: 40 })],
  // The worst UPRIGHT right overhang of a 240-case sweep (0.014 em, 0.56pt here): the case that pins
  // the upright constant, which the kerning term otherwise absorbs in every other config. The box is
  // narrow so the line's end is not already inside the stored footprint.
  ['upright right overhang (Helvetica underscores, 40pt)', mk(40, 40, '_____', { fontSize: 40, width: 10 })],
  // A MIXED Arabic + Latin line is measured by measureBidiRuns, whose Latin runs are measured WITH
  // kerning and drawn (drawText) without — so a long kerned run at the visual right end inks past the
  // measured line by far more than the Arabic band (the excess grows with the number of pairs). Kept
  // short on purpose: a line running off the 500pt page is clipped there and the case cannot fail.
  ['mixed line, kerned Latin run at the right end', mk(40, 40, 'Tى AVAVAVAVA', { fontSize: 40, width: 10 })],
  ['kerning pairs, right-aligned into a narrow box', mk(40, 40, 'WAVY AVAVA', { fontSize: 30, align: 'right', width: 60 })],
];

describe('A5 — every inked pixel lies inside the drawn-extent footprint', () => {
  for (const [name, te, pageRot] of CONFIGS) {
    it(name, async () => {
      const ink = await inkBox(te, pageRot ?? 0);
      expect(ink, 'the bake drew nothing — the case would be vacuous').not.toBeNull();
      const f = await textDrawnFootprint(te, measure);
      const tol = 1 / SCALE; // one rendered pixel of anti-aliasing
      const msg = `ink ${JSON.stringify(ink)} vs footprint ${JSON.stringify(f)}`;
      if (!ink) return;
      expect(ink.x0, msg).toBeGreaterThanOrEqual(f.x - tol);
      expect(ink.y0, msg).toBeGreaterThanOrEqual(f.y - tol);
      expect(ink.x1, msg).toBeLessThanOrEqual(f.x + f.width + tol);
      expect(ink.y1, msg).toBeLessThanOrEqual(f.y + f.height + tol);
    }, 60_000);
  }
});

const red = (x: number, y: number, w: number, h: number) =>
  new RedactionElement(x, y, w, h, 'p1', '#000000') as unknown as PDFElement;
const kept = async (te: TextElement, r: PDFElement) =>
  (await dropElementsUnderRedactions([te as unknown as PDFElement, r])).includes(te as unknown as PDFElement);

describe('A5 — the drop decides on the drawn extent, both ways', () => {
  it('KEPT (a): text that fits its box, redaction abutting the box right and bottom edges', async () => {
    const te = mk(40, 40, 'Fits', { width: 120, height: 30 });
    expect(await kept(te, red(160, 30, 50, 60))).toBe(true);  // right edge x=160
    expect(await kept(te, red(30, 70, 150, 20))).toBe(true);  // bottom edge y=70
  });

  it('KEPT (b): a short Arabic line with a redaction just right of its box', async () => {
    const te = mk(40, 40, 'نص', { width: 120 });
    // Arabic is right-aligned, so its ink ends at the box edge (x=160) plus ≤0.25 em (3.5pt).
    expect(await kept(te, red(166, 30, 40, 40))).toBe(true);
  });

  it('DROPPED: a long Arabic line overflowing into a redaction right of its box', async () => {
    const te = mk(40, 40, 'مرحبا بالعالم هذا نص عربي طويل جدا', { width: 40 });
    expect(await kept(te, red(120, 35, 60, 30))).toBe(false);
  });

  it('an empty middle line still advances: the third line lands where the redaction is', async () => {
    const te = mk(40, 40, 'A\n\nSECRET', { height: 18 });
    // Third baseline: 40 + 12.6 + 2·16.8 = 86.2 → glyphs ≈ 73..89. Stored box ends at y=58.
    expect(await kept(te, red(30, 80, 100, 8))).toBe(false);
    // Below the third line's descenders (≤ 86.2 + 0.225·14 = 89.4) — clear. (The footprint is ONE box
    // around all lines, so the empty line's own row counts as covered: an over-drop, never a leak.)
    expect(await kept(te, red(30, 92, 100, 8))).toBe(true);
  });

  it('a right-aligned line longer than its box overflows RIGHT, not left', async () => {
    const te = mk(40, 40, 'Right aligned text that is far too long', { align: 'right', width: 50 });
    expect(await kept(te, red(200, 35, 40, 30))).toBe(false);
    expect(await kept(te, red(0, 35, 36, 30))).toBe(true);
  });

  it('CJK text is measured as the bake draws it (each character becomes "?"), not as unbounded', async () => {
    const te = mk(40, 40, '机密文件内容', { width: 20 });
    // Six '?' at 14pt in Helvetica ≈ 46.7pt, so the ink ends near x=87.
    expect(await kept(te, red(70, 35, 40, 30))).toBe(false);
    expect(await kept(te, red(120, 35, 40, 30))).toBe(true);
  });

  it('a rotated element overflowing into a redaction is dropped; one clear of it is kept', async () => {
    const te = mk(200, 150, 'Rotated line that overflows\nsecond line', { rotation: 30, height: 20 });
    expect(await kept(te, red(300, 200, 30, 30))).toBe(false);
    expect(await kept(te, red(20, 350, 30, 30))).toBe(true);
  });
});
