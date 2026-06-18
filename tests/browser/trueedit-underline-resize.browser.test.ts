/**
 * Regression (#text-decoration) — PDF underline/strikethrough are SEPARATE thin
 * rects, not a text attribute, so a true-edit that changes the text LENGTH used to
 * leave the rule frozen at its old width (the reported bug: a longer edit left its
 * tail un-underlined). replaceTextAt({adjustDecorations:true}) resizes the matched
 * rule to the new text width.
 *
 * Why a REAL browser: this asserts on PIXELS from pdf.js rasterization — the
 * underline rule must actually paint under the new tail. jsdom never rasterizes, so
 * the unit suite can only check the content-stream operand; only Chrome proves the
 * extended rule renders as ink where the new glyphs are.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, PDFName, PDFDict, StandardFonts } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { replaceTextAt } from '../../src/utils/contentStreamEditor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const PAGE_W = 400;
const PAGE_H = 200;
const BASELINE = 150; // text baseline (PDF user space, y-up)
const ORIGIN_X = 50;
const UNDERLINE_W = 28; // ≈ width of "Hello" at 12pt Helvetica
const SCALE = 2;

/** "Hello" in Helvetica with a thin filled underline rect just below the baseline. */
async function makeUnderlinedPdf(): Promise<Uint8Array> {
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
  const content =
    `BT /F1 12 Tf 1 0 0 1 ${ORIGIN_X} ${BASELINE} Tm (Hello) Tj ET\n` +
    `0 0 0 rg ${ORIGIN_X} ${BASELINE - 3} ${UNDERLINE_W} 1.2 re f`;
  const cb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) cb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(cb)));
  return doc.save();
}

/**
 * Count dark pixels in the underline ROW band (below the glyphs, so only the rule
 * contributes) within a user-space x-window. The tail window [85,120] is well past
 * the original underline end (x≈78) — ink there ⇒ the rule extended under new text.
 */
async function tailUnderlineInk(bytes: Uint8Array): Promise<number> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('no ctx');
  await page.render({ canvas, canvasContext: c2d, viewport: vp }).promise;
  // Underline row: just below the baseline (user y = BASELINE-3 ± a bit).
  const yTop = Math.floor((PAGE_H - (BASELINE - 1)) * SCALE);
  const yBot = Math.ceil((PAGE_H - (BASELINE - 5)) * SCALE);
  const xLo = Math.floor(85 * SCALE);
  const xHi = Math.ceil(120 * SCALE);
  const { data } = c2d.getImageData(xLo, yTop, xHi - xLo, Math.max(1, yBot - yTop));
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 150 && data[i + 1] < 150 && data[i + 2] < 150) ink++;
  }
  return ink;
}

describe('true-edit underline resize (#text-decoration)', () => {
  it('extends the underline under the new tail when the edit is LONGER', async () => {
    const doc = await PDFDocument.load(await makeUnderlinedPdf());
    const ok = await replaceTextAt(doc, 0, { x: ORIGIN_X + 2, y: BASELINE }, 'HelloWorld', 5, undefined, undefined, {
      adjustDecorations: true,
    });
    expect(ok).toBe(true);
    expect(await tailUnderlineInk(await doc.save())).toBeGreaterThan(20);
  });

  it('leaves the tail un-underlined when adjustDecorations is OFF (control)', async () => {
    const doc = await PDFDocument.load(await makeUnderlinedPdf());
    await replaceTextAt(doc, 0, { x: ORIGIN_X + 2, y: BASELINE }, 'HelloWorld');
    // Original rule ends at x≈78; the tail window [85,120] stays empty.
    expect(await tailUnderlineInk(await doc.save())).toBe(0);
  });
});
