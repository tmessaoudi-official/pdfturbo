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
import { PDFDocument, PDFName, PDFDict, PDFRawStream, StandardFonts } from '@cantoo/pdf-lib';
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
 * "Hello" in Helvetica underlined by a STROKED horizontal line (`m … l … S`) — the
 * encoding Word/LibreOffice actually emit (the reported real-file bug: this form was
 * refused, so the rule stayed frozen and the new tail had no underline).
 */
async function makeLineUnderlinedPdf(): Promise<Uint8Array> {
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
    `0 0 0 RG 1.2 w ${ORIGIN_X} ${BASELINE - 3} m ${ORIGIN_X + UNDERLINE_W} ${BASELINE - 3} l S`;
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

  // The real-file bug: underlines drawn as a STROKED LINE (Word/LibreOffice), not a
  // filled rect. Previously refused → frozen → bare tail. Now resized.
  it('extends a STROKED-LINE underline under the new tail when LONGER', async () => {
    const doc = await PDFDocument.load(await makeLineUnderlinedPdf());
    const ok = await replaceTextAt(doc, 0, { x: ORIGIN_X + 2, y: BASELINE }, 'HelloWorld', 5, undefined, undefined, {
      adjustDecorations: true,
    });
    expect(ok).toBe(true);
    expect(await tailUnderlineInk(await doc.save())).toBeGreaterThan(20);
  });

  it('leaves a STROKED-LINE tail bare when adjustDecorations is OFF (control)', async () => {
    const doc = await PDFDocument.load(await makeLineUnderlinedPdf());
    await replaceTextAt(doc, 0, { x: ORIGIN_X + 2, y: BASELINE }, 'HelloWorld');
    expect(await tailUnderlineInk(await doc.save())).toBe(0);
  });
});

// ── #text-decoration-width Path 3: the REAL-FILE overshoot ──────────────────
// On a CID/Identity-H subset font with no usable glyph table, a length-changing
// edit redraws the whole run in a STANDARD font (Path 3, forceProxy). The old code
// scaled the rule by R_old × proxyNew/proxyOld; since R_old came from the embedded
// font (R_old ≠ proxyWidth(old)), that OVERSHOT — the underline ran far past the
// redrawn text (the user's reported tail). The fix anchors the rule to the redrawn
// width. Pixels prove it: ink UNDER the redrawn text, none in the far overshoot zone.
const P3_ORIGIN_X = 50;
const P3_BASELINE = 150;
const P3_UL_W = 24; // embedded "00" width at 12pt = (1000+1000)/1000*12

/**
 * Type0/Identity-H subset font (ToUnicode for '0','X'; /W digit≫letter) underlining
 * "00" with a 24pt rect. Editing to "00ABCDEFG" adds letters absent from the subset,
 * so Path 2 fails and the run redraws in Helvetica (~71pt) via Path 3. The OLD bug:
 * 24 × helv("00ABCDEFG")/helv("00") ≈ 128pt → a tail to x≈178; the fix ends it at x≈121.
 */
async function makeCidPath3UnderlinedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx = doc.context;
  const cmapText =
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n' +
    '1 begincodespacerange <0000> <FFFF> endcodespacerange\n' +
    '2 beginbfchar <0001> <0030> <0002> <0058> endbfchar\n' +
    'endcmap end end';
  const cb = new Uint8Array(cmapText.length);
  for (let i = 0; i < cmapText.length; i++) cb[i] = cmapText.charCodeAt(i) & 0xff;
  const cmapRef = ctx.register(
    PDFRawStream.of(PDFDict.fromMapWithContext(new Map([[PDFName.of('Length'), ctx.obj(cb.length)]]), ctx), cb),
  );
  const cidFont = PDFDict.fromMapWithContext(new Map(), ctx);
  cidFont.set(PDFName.of('Type'), PDFName.of('Font'));
  cidFont.set(PDFName.of('Subtype'), PDFName.of('CIDFontType2'));
  cidFont.set(PDFName.of('BaseFont'), PDFName.of('ABCDEF+WideDigit'));
  cidFont.set(PDFName.of('DW'), ctx.obj(500));
  cidFont.set(PDFName.of('W'), ctx.obj([1, [1000], 2, [200]]));
  const cidRef = ctx.register(cidFont);
  const fontDict = PDFDict.fromMapWithContext(new Map(), ctx);
  fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
  fontDict.set(PDFName.of('Subtype'), PDFName.of('Type0'));
  fontDict.set(PDFName.of('BaseFont'), PDFName.of('ABCDEF+WideDigit'));
  fontDict.set(PDFName.of('Encoding'), PDFName.of('Identity-H'));
  fontDict.set(PDFName.of('ToUnicode'), cmapRef);
  fontDict.set(PDFName.of('DescendantFonts'), ctx.obj([cidRef]));
  const fontRef = ctx.register(fontDict);
  const resFont = PDFDict.fromMapWithContext(new Map(), ctx);
  resFont.set(PDFName.of('F1'), fontRef);
  const res = PDFDict.fromMapWithContext(new Map(), ctx);
  res.set(PDFName.of('Font'), resFont);
  page.node.set(PDFName.of('Resources'), res);
  const content =
    `BT /F1 12 Tf 1 0 0 1 ${P3_ORIGIN_X} ${P3_BASELINE} Tm <00010001> Tj ET\n` +
    `0 0 0 rg ${P3_ORIGIN_X} ${P3_BASELINE - 3} ${P3_UL_W} 1.2 re f`;
  const pcb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) pcb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(pcb)));
  return doc.save();
}

/** Dark-pixel count in the underline row band within a user-space x-window [xLoU,xHiU]. */
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
  const yTop = Math.floor((PAGE_H - (P3_BASELINE - 1)) * SCALE);
  const yBot = Math.ceil((PAGE_H - (P3_BASELINE - 5)) * SCALE);
  const xLo = Math.floor(xLoU * SCALE);
  const xHi = Math.ceil(xHiU * SCALE);
  const { data } = c2d.getImageData(xLo, yTop, xHi - xLo, Math.max(1, yBot - yTop));
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 150 && data[i + 1] < 150 && data[i + 2] < 150) ink++;
  }
  return ink;
}

describe('true-edit underline resize — Path-3 redraw does NOT overshoot (#text-decoration-width)', () => {
  it('ends the underline with the redrawn text (ink under it, none in the overshoot zone)', async () => {
    const doc = await PDFDocument.load(await makeCidPath3UnderlinedPdf());
    const ok = await replaceTextAt(doc, 0, { x: P3_ORIGIN_X + 1, y: P3_BASELINE }, '00ABCDEFG', 5, undefined, undefined, {
      adjustDecorations: true,
    });
    expect(ok).toBe(true);
    const bytes = await doc.save();
    // Under the redrawn text (text spans ≈[50,121]): the resized underline must paint here.
    expect(await underlineInk(bytes, 95, 118)).toBeGreaterThan(15);
    // The OLD ratio bug ran the rule to x≈178; the fix ends it ≈121. This far zone must be bare.
    expect(await underlineInk(bytes, 140, 175)).toBe(0);
  });

  it('does not extend the underline at all when adjustDecorations is OFF (control)', async () => {
    const doc = await PDFDocument.load(await makeCidPath3UnderlinedPdf());
    await replaceTextAt(doc, 0, { x: P3_ORIGIN_X + 1, y: P3_BASELINE }, '00ABCDEFG');
    // Rule stays at its original 24pt (ends x≈74) → nothing under the longer text.
    expect(await underlineInk(await doc.save(), 95, 118)).toBe(0);
  });
});
