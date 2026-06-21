/**
 * B2 — adding a NEW underline / strikethrough to existing true-edited PDF text.
 * `addDecorationAt` appends a standalone stroked line at the text baseline, KEEPING
 * the original font (no Path-3 substitution).
 *
 * Why a REAL browser: this asserts on PIXELS from pdf.js rasterization — the new
 * decoration must actually paint as ink, under the text (underline) or through it
 * (strikethrough). jsdom never rasterizes, so the unit suite can only check the
 * appended content-stream operators; only Chrome proves they render.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, PDFName, PDFDict, StandardFonts } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { addDecorationAt } from '../../src/utils/contentStreamEditor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const PAGE_W = 400;
const PAGE_H = 200;
const BASELINE = 150; // text baseline (PDF user space, y-up)
const ORIGIN_X = 50;
const SCALE = 2;

/** Plain "Hello" in Helvetica with NO decoration of any kind. */
async function makePlainTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('seed', { x: 0, y: 0, size: 1, font });
  const ctx = doc.context;
  const res = ctx.lookup(page.node.get(PDFName.of('Resources'))) as PDFDict;
  const fontDict = ctx.lookup(res.get(PDFName.of('Font'))) as PDFDict;
  const helv = fontDict.get([...fontDict.entries()][0][0]);
  if (!helv) throw new Error('font missing');
  fontDict.set(PDFName.of('F1'), helv);
  const content = `BT /F1 12 Tf 1 0 0 1 ${ORIGIN_X} ${BASELINE} Tm (Hello) Tj ET`;
  const cb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) cb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(cb)));
  return doc.save();
}

/** Dark-pixel count in a user-space band [yLoU,yHiU] × [xLoU,xHiU]. */
async function inkInBand(
  bytes: Uint8Array,
  xLoU: number, xHiU: number, yLoU: number, yHiU: number,
): Promise<number> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('no ctx');
  await page.render({ canvas, canvasContext: c2d, viewport: vp }).promise;
  // y-down device coords: user yHi maps to the smaller device-y.
  const yTop = Math.floor((PAGE_H - yHiU) * SCALE);
  const yBot = Math.ceil((PAGE_H - yLoU) * SCALE);
  const xLo = Math.floor(xLoU * SCALE);
  const xHi = Math.ceil(xHiU * SCALE);
  const { data } = c2d.getImageData(xLo, yTop, xHi - xLo, Math.max(1, yBot - yTop));
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 150 && data[i + 1] < 150 && data[i + 2] < 150) ink++;
  }
  return ink;
}

describe('B2 — addDecorationAt renders a new decoration (real Chrome)', () => {
  // Underline band sits BELOW the baseline (user y < 150).
  const ulBand = { xLo: ORIGIN_X, xHi: ORIGIN_X + 40, yLo: BASELINE - 6, yHi: BASELINE - 0.5 };

  it('adds a visible underline below the baseline (none was there before)', async () => {
    const plain = await makePlainTextPdf();
    // Control: the underline band is empty before adding the decoration.
    expect(await inkInBand(plain, ulBand.xLo, ulBand.xHi, ulBand.yLo, ulBand.yHi)).toBe(0);

    const doc = await PDFDocument.load(plain);
    const ok = await addDecorationAt(doc, 0, { x: ORIGIN_X + 1, y: BASELINE }, 'underline', 5);
    expect(ok).toBe(true);
    expect(await inkInBand(await doc.save(), ulBand.xLo, ulBand.xHi, ulBand.yLo, ulBand.yHi)).toBeGreaterThan(20);
  });

  it('adds a visible strikethrough through the glyph body (above the baseline)', async () => {
    const doc = await PDFDocument.load(await makePlainTextPdf());
    const ok = await addDecorationAt(doc, 0, { x: ORIGIN_X + 1, y: BASELINE }, 'strikethrough', 5);
    expect(ok).toBe(true);
    // Strike sits at ~baseline + 0.28*12 ≈ 153.4 → scan a band above the baseline.
    const strikeInk = await inkInBand(await doc.save(), ORIGIN_X, ORIGIN_X + 40, BASELINE + 1, BASELINE + 6);
    expect(strikeInk).toBeGreaterThan(20);
    // And it must NOT have painted in the underline band.
    expect(await inkInBand(await doc.save(), ulBand.xLo, ulBand.xHi, ulBand.yLo, ulBand.yHi)).toBe(0);
  });
});
