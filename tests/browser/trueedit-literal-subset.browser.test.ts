/**
 * Regression (G8 prefill) — clicking text drawn by a SUBSET font with a LITERAL
 * show-string operand `( … )` must prefill the true-edit inline editor with the
 * real word, never the raw glyph-code bytes ("a series of random characters").
 *
 * decodeShowOpText's hex branch was font-safety-gated but its literal branch was
 * not, so a subset/embedded font whose `( … ) Tj` operand carries custom
 * glyph/CID codes (not ASCII) prefilled the editor with those raw bytes. Fixed
 * by decoding literal and hex operands through the SAME gate (bbffbea).
 *
 * Why a REAL browser: this builds an AUTHENTIC embedded subset font — real
 * FontFile2 (fontkit subsetting) + pdf-lib's own generated /ToUnicode CMap +
 * Identity-H — fetched via `?url`, which jsdom cannot do. The synthetic jsdom
 * unit test uses a hand-built font dict; this proves the gate against the genuine
 * structures (FontFile2-driven isByteSwapUnsafeFont + a real 2-byte ToUnicode),
 * and that pdf.js still renders the literal-operand page.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName, PDFDict } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import fontUrl from 'pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf?url';
import { getEditableTextAt } from '../../src/utils/contentStreamEditor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const WORD = 'Editable';
const PAGE_W = 400;
const PAGE_H = 200;
const BASELINE = 150;
const ORIGIN_X = 30;

/**
 * Embed LiberationSans as a real subset font, register WORD's glyph usage via
 * drawText (so the subset includes them + pdf-lib emits FontFile2/ToUnicode),
 * then OVERWRITE the page content with the SAME CID bytes encoded as a LITERAL
 * `( … ) Tj` operand (octal-escaped). The result is a genuine renderable subset
 * font whose show op is a literal string of glyph codes — the regression case.
 */
async function makeSubsetLiteralRenderedPdf(): Promise<Uint8Array> {
  const ttf = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(ttf, { subset: true });
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  // Register glyph usage so the subset + ToUnicode include WORD's glyphs.
  page.drawText(WORD, { x: ORIGIN_X, y: BASELINE, size: 24, font });

  // The exact CID bytes pdf-lib uses for WORD (2-byte Identity-H codes).
  const hex = font.encodeText(WORD).toString().replace(/[<>]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i + 2 <= hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  const literal = bytes.map((b) => '\\' + b.toString(8).padStart(3, '0')).join('');

  // Point our own Resources at the embedded font and overwrite Contents with a
  // LITERAL-operand show op at the same baseline.
  const ctx = pdf.context;
  const resFont = PDFDict.fromMapWithContext(new Map(), ctx);
  resFont.set(PDFName.of('F1'), font.ref);
  const res = PDFDict.fromMapWithContext(new Map(), ctx);
  res.set(PDFName.of('Font'), resFont);
  page.node.set(PDFName.of('Resources'), res);

  const content = `BT /F1 24 Tf 1 0 0 1 ${ORIGIN_X} ${BASELINE} Tm (${literal}) Tj ET`;
  const pcb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) pcb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(pcb)));
  return pdf.save({ useObjectStreams: false });
}

async function inkInWordBand(bytes: Uint8Array, scale = 2): Promise<number> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('no ctx');
  await page.render({ canvas, canvasContext: c2d, viewport: vp }).promise;
  const yTop = Math.floor((PAGE_H - BASELINE - 22) * scale);
  const yBot = Math.ceil((PAGE_H - BASELINE + 6) * scale);
  const { data } = c2d.getImageData(0, Math.max(0, yTop), canvas.width, Math.max(1, yBot - yTop));
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 180 && data[i + 1] < 180 && data[i + 2] < 180) ink++;
  }
  return ink;
}

describe('true-edit prefill — subset font with a literal show-string (G8 regression)', () => {
  it('prefills the real word, not the raw glyph-code bytes', async () => {
    const doc = await PDFDocument.load(await makeSubsetLiteralRenderedPdf());
    // Pre-fix the literal branch returned the raw 2-byte CID codes decoded as
    // Latin-1 (control bytes = "random characters"); the fix routes the literal
    // operand through the same ToUnicode gate as hex, recovering the real word.
    const prefill = await getEditableTextAt(doc, 0, { x: ORIGIN_X + 2, y: BASELINE }, 5);
    expect(prefill).toBe(WORD);
  });

  it('renders as a valid literal-operand subset PDF (pdf.js draws the word)', async () => {
    const bytes = await makeSubsetLiteralRenderedPdf();
    expect(await inkInWordBand(bytes)).toBeGreaterThan(200);
  });
});
