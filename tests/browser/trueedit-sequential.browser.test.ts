/**
 * Regression — sequential true-edits at the SAME origin (the reported "second edit
 * resets / text on top of each other" bug).
 *
 * Path 3 (standard-font redraw) blanks the original show op IN PLACE and appends a
 * live redraw at the end of the stream. `findTarget` used to pick the blanked ghost
 * (lower opIndex) on the next edit, so the first redraw lingered and the new text
 * overlaid it. The fix skips empty-payload ops in `findTarget`.
 *
 * Why a REAL browser: only pdf.js rasterization proves what actually PAINTS. The
 * tell-tale is the FAR zone — edit 1 draws a WIDE word, edit 2 a SHORT one; if the
 * wide first redraw survived, its ink stays in the far zone. The fix leaves it bare.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, PDFName, PDFDict, StandardFonts } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { replaceTextAt, deleteTextAt } from '../../src/utils/contentStreamEditor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const PAGE_W = 400;
const PAGE_H = 200;
const BASELINE = 150;
const ORIGIN_X = 50;
const SCALE = 2;

/** "HELLO" in Helvetica at a known origin. */
async function makeHelloPdf(): Promise<Uint8Array> {
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
  const content = `BT /F1 14 Tf 1 0 0 1 ${ORIGIN_X} ${BASELINE} Tm (HELLO) Tj ET`;
  const cb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) cb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(cb)));
  return doc.save();
}

/** "HELLO" + a thin filled underline rect just below the baseline. */
async function makeUnderlinedHelloPdf(): Promise<Uint8Array> {
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
    `BT /F1 14 Tf 1 0 0 1 ${ORIGIN_X} ${BASELINE} Tm (HELLO) Tj ET\n` +
    `0 0 0 rg ${ORIGIN_X} ${BASELINE - 3} 34 1.4 re f`;
  const cb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) cb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(cb)));
  return doc.save();
}

/** Dark-pixel count in the UNDERLINE row band (below the glyphs) within [xLoU,xHiU]. */
async function underlineInk(bytes: Uint8Array, xLoU: number, xHiU: number): Promise<number> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('no ctx');
  await page.render({ canvas, canvasContext: c2d, viewport: vp }).promise;
  const yTop = Math.floor((PAGE_H - (BASELINE - 1)) * SCALE);
  const yBot = Math.ceil((PAGE_H - (BASELINE - 6)) * SCALE);
  const xLo = Math.floor(xLoU * SCALE);
  const xHi = Math.ceil(xHiU * SCALE);
  const { data } = c2d.getImageData(xLo, yTop, xHi - xLo, Math.max(1, yBot - yTop));
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 150 && data[i + 1] < 150 && data[i + 2] < 150) ink++;
  }
  return ink;
}

/** Dark-pixel count in the GLYPH band within a user-space x-window [xLoU,xHiU]. */
async function glyphInk(bytes: Uint8Array, xLoU: number, xHiU: number): Promise<number> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('no ctx');
  await page.render({ canvas, canvasContext: c2d, viewport: vp }).promise;
  // Glyph band: from the baseline up by ~the cap height of 14pt text.
  const yTop = Math.floor((PAGE_H - (BASELINE + 11)) * SCALE);
  const yBot = Math.ceil((PAGE_H - (BASELINE - 1)) * SCALE);
  const xLo = Math.floor(xLoU * SCALE);
  const xHi = Math.ceil(xHiU * SCALE);
  const { data } = c2d.getImageData(xLo, yTop, xHi - xLo, Math.max(1, yBot - yTop));
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 150 && data[i + 1] < 150 && data[i + 2] < 150) ink++;
  }
  return ink;
}

const ORIGIN = { x: ORIGIN_X + 1, y: BASELINE };

describe('sequential true-edits at the same origin (overlap / reset)', () => {
  it('a wide Path-3 edit then a short edit leaves NO lingering wide text', async () => {
    // Edit 1: restyle (bold) forces Path 3 → wide "HELLOWORLD" redraw (spans far right).
    const doc1 = await PDFDocument.load(await makeHelloPdf());
    expect(await replaceTextAt(doc1, 0, ORIGIN, 'HELLOWORLD', 5, { bold: true })).toBe(true);
    const bytes1 = await doc1.save();
    // Sanity: the wide word reaches the far zone after edit 1.
    expect(await glyphInk(bytes1, 95, 135)).toBeGreaterThan(15);

    // Edit 2 at the SAME origin: short "Hi".
    const doc2 = await PDFDocument.load(bytes1.slice(0));
    expect(await replaceTextAt(doc2, 0, ORIGIN, 'Hi', 5)).toBe(true);
    const bytes2 = await doc2.save();

    // Near zone keeps ink (the new short text); far zone is BARE — no ghost redraw.
    expect(await glyphInk(bytes2, ORIGIN_X, ORIGIN_X + 14)).toBeGreaterThan(8);
    expect(await glyphInk(bytes2, 95, 135)).toBe(0);
  });

  it('deleting after a Path-3 edit clears the text (no ghost left behind)', async () => {
    const doc1 = await PDFDocument.load(await makeHelloPdf());
    expect(await replaceTextAt(doc1, 0, ORIGIN, 'HELLOWORLD', 5, { bold: true })).toBe(true);
    const bytes1 = await doc1.save();
    expect(await glyphInk(bytes1, ORIGIN_X, 135)).toBeGreaterThan(20);

    const doc2 = await PDFDocument.load(bytes1.slice(0));
    expect(await deleteTextAt(doc2, 0, ORIGIN, 5)).toBe(true);
    // Whole text band is bare after delete.
    expect(await glyphInk(await doc2.save(), ORIGIN_X, 135)).toBe(0);
  });

  it('three Path-3 edits in a row render only the latest text', async () => {
    let bytes = await makeHelloPdf();
    for (const txt of ['WIDEWORDONE', 'mid', 'XX']) {
      const doc = await PDFDocument.load(bytes.slice(0));
      expect(await replaceTextAt(doc, 0, ORIGIN, txt, 5, { bold: true })).toBe(true);
      bytes = await doc.save();
    }
    // Only "XX" should remain: near zone inked, everything past it bare.
    expect(await glyphInk(bytes, ORIGIN_X, ORIGIN_X + 16)).toBeGreaterThan(8);
    expect(await glyphInk(bytes, 80, 160)).toBe(0);
  });

  // "the underline also" — the decoration must track the LATEST edit across a
  // sequence, not stay frozen at the first edit's (wide) width.
  it('the underline tracks the second edit (wide then short → far underline bare)', async () => {
    // Edit 1 (Path 3, wide): underline resized out under "HELLOWIDEWORD".
    const doc1 = await PDFDocument.load(await makeUnderlinedHelloPdf());
    expect(await replaceTextAt(doc1, 0, ORIGIN, 'HELLOWIDEWORD', 5, { bold: true }, undefined, { adjustDecorations: true })).toBe(true);
    const bytes1 = await doc1.save();
    expect(await underlineInk(bytes1, 100, 140)).toBeGreaterThan(10); // wide underline reaches far zone

    // Edit 2 (short): underline must SHRINK back — far zone goes bare.
    const doc2 = await PDFDocument.load(bytes1.slice(0));
    expect(await replaceTextAt(doc2, 0, ORIGIN, 'Hi', 5, undefined, undefined, { adjustDecorations: true })).toBe(true);
    const bytes2 = await doc2.save();
    expect(await underlineInk(bytes2, ORIGIN_X, ORIGIN_X + 12)).toBeGreaterThan(6); // still under "Hi"
    expect(await underlineInk(bytes2, 100, 140)).toBe(0); // no frozen wide underline
  });
});
