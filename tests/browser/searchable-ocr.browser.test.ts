/**
 * Searchable-OCR layer — validation spike (real Chrome).
 *
 * THE risky question: does invisible (`3 Tr`) text emitted at OCR word bboxes
 * become SELECTABLE / SEARCHABLE at the correct on-page position when a reader
 * re-parses the PDF? This test is the faithful proof: build a page, lay invisible
 * text via `buildInvisibleTextLayerOps`, save, reopen with pdf.js, and assert
 *   (a) every word is recovered by `getTextContent()` — i.e. selectable; and
 *   (b) each word's text-origin (`transform[4]/[5]`) lands at the expected PDF
 *       coords (the OCR-pixel → PDF-point transform is correct); and
 *   (c) the page rasterizes with NO visible ink — the layer is truly invisible.
 *
 * jsdom can't run this (needs real pdf.js rasterization + text extraction).
 * Spec: the 2026-06-15 searchable-OCR spike design — removed by ac4ef68, recover with
 * `git show ac4ef68^:docs/superpowers/specs/2026-06-15-searchable-ocr-spike-design.md`
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import {
  buildInvisibleTextLayerOps,
  wordToTextPlacement,
  applySearchableLayerToPdf,
} from '../../src/ocr/searchableTextLayer';
import { isArabicText } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const PAGE_W = 300;
const PAGE_H = 200;
const SCALE = 2; // OCR render scale; bboxes below are in image pixels at this scale.

// Known words at known image-pixel bboxes (top-left origin, ×SCALE).
const WORDS = [
  { text: 'Invisible', bbox: { x0: 40, y0: 20, x1: 200, y1: 60 } },
  { text: 'Searchable', bbox: { x0: 40, y0: 120, x1: 230, y1: 160 } },
];

async function buildSearchablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE_W, PAGE_H]); // default white background = the "scan"
  const fontKey = page.node.newFontDictionary(font.name, font.ref);
  const ops = buildInvisibleTextLayerOps(WORDS, {
    scale: SCALE,
    pageHeight: PAGE_H,
    font,
    fontKey,
  });
  page.pushOperators(...ops);
  return doc.save();
}

describe('searchable-OCR invisible text layer (real Chrome)', () => {
  it('is selectable at the correct position yet paints no visible ink', async () => {
    const bytes = await buildSearchablePdf();

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const p = await pdf.getPage(1);
    const content = await p.getTextContent();
    const items = content.items as Array<{ str: string; transform: number[] }>;

    // (a) selectable: every word is recovered by text extraction.
    const joined = items.map((i) => i.str).join('');
    for (const w of WORDS) expect(joined).toContain(w.text);

    // (b) correct position: each word's text origin matches the OCR→PDF transform.
    for (const w of WORDS) {
      const expected = wordToTextPlacement(w.bbox, SCALE, PAGE_H);
      const item = items.find((i) => i.str.includes(w.text));
      expect(item, `text item for "${w.text}"`).toBeTruthy();
      if (!item) continue;
      const [, , , , ex, fy] = item.transform;
      expect(ex).toBeCloseTo(expected.x, 0); // within ~0.5 pt
      expect(fy).toBeCloseTo(expected.baselineY, 0);
    }

    // (c) invisible: rasterize and assert essentially no dark pixels (mode 3 Tr).
    const scale = 3;
    const vp = p.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let darkCount = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] < 128 && px[i + 1] < 128 && px[i + 2] < 128) darkCount++;
    }
    expect(darkCount).toBe(0); // invisible text renders no ink
  });

  it('adds an Arabic + Latin (mixed-script) searchable layer recoverable as Arabic Unicode', async () => {
    // A blank source page; applySearchableLayerToPdf embeds Helvetica (Latin) and
    // the bundled Noto Naskh (Arabic), emitting Arabic in logical order. Latin is
    // exact-searchable; Arabic recovers as real Arabic Unicode (selectable + screen
    // -reader-accessible) but full-word exact search is imperfect — a documented
    // partial (fontkit GSUB shaping → incomplete pdf-lib ToUnicode), the same
    // ceiling as the visible Arabic overlay. So we assert the honest contract.
    const src = await (async () => {
      const doc = await PDFDocument.create();
      doc.addPage([PAGE_W, PAGE_H]);
      return doc.save();
    })();

    const out = await applySearchableLayerToPdf(
      src,
      1,
      [
        { text: 'مرحبا', bbox: { x0: 60, y0: 40, x1: 220, y1: 80 } },
        { text: 'Hello', bbox: { x0: 60, y0: 120, x1: 200, y1: 160 } },
      ],
      SCALE,
    );
    expect(out).toBeTruthy();
    if (!out) return;

    const pdf = await pdfjsLib.getDocument({ data: out }).promise;
    const p = await pdf.getPage(1);
    const content = await p.getTextContent();
    const joined = (content.items as Array<{ str: string }>).map((i) => i.str).join('');

    // Honest contract: real Arabic Unicode is present (selectable/screen-readable),
    // the Latin word is exact, and there is no tofu/'?' substitution. Exact Arabic
    // full-word search is a documented partial (see the test header).
    expect(isArabicText(joined)).toBe(true);
    expect(joined).toContain('Hello'); // Latin is exact-searchable
    expect(joined).not.toContain('?'); // real glyphs embedded, not '?' fallback

    // Still invisible: no dark ink.
    const vp = p.getViewport({ scale: 3 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] < 128 && px[i + 1] < 128 && px[i + 2] < 128) dark++;
    }
    expect(dark).toBe(0);
  });
});
