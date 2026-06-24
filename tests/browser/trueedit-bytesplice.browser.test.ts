/**
 * F3 hybrid byte-splice — real-Chrome guard.
 *
 * Before F3, the true-edit write-back re-serialized the WHOLE content stream
 * (`serializeOps`), so any byte the tokenizer mis-models — notably the binary data of
 * a `BI … ID <bytes> EI` inline image — round-tripped through a normalizer and could
 * be corrupted far from the edit. After F3, a clean single-op edit splices ONLY the
 * changed op's byte range into the original source, leaving every other byte verbatim.
 *
 * This test edits a word on a page that also carries an inline image and asserts:
 *   (1) the edit succeeds and the word changed;
 *   (2) the inline image's bytes are present BYTE-IDENTICAL in the rewritten stream;
 *   (3) pdf.js renders the spliced page without throwing (the splice is valid PDF).
 *
 * Why a REAL browser: pdf.js rasterization proves the spliced stream actually parses
 * and paints; jsdom cannot run getViewport/render.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream, StandardFonts } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { replaceTextAt } from '../../src/utils/contentStreamEditor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const PAGE_W = 200;
const PAGE_H = 200;
// A 2×2, 8-bpc DeviceGray inline image = 4 bytes of data (none form a ws-delimited "EI").
const IMG = 'BI /W 2 /H 2 /CS /G /BPC 8 ID \x10\x20\x30\x40 EI';

/** Decode page-0 content as latin1 text. */
function readPageContent(doc: PDFDocument): string {
  const page = doc.getPage(0);
  const stream = doc.context.lookup(page.node.get(PDFName.of('Contents'))) as PDFRawStream;
  const bytes = decodePDFRawStream(stream).decode();
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Build a page with an inline image (in a q…Q block) + a Helvetica word. */
async function makeInlineImagePdf(): Promise<Uint8Array> {
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
    `q 1 0 0 1 10 180 cm ${IMG} Q\n` +
    `BT /F1 14 Tf 1 0 0 1 20 100 Tm (HELLO) Tj ET`;
  const cb = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) cb[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(cb)));
  return doc.save();
}

describe('F3 byte-splice — inline image survives a true edit byte-identical', () => {
  it('edits a word, keeps the inline image verbatim, and renders without throwing', async () => {
    const live = await PDFDocument.load(await makeInlineImagePdf());
    const r = await replaceTextAt(live, 0, { x: 20, y: 100 }, 'Hi', 6);
    expect(r).not.toBe(false); // the edit succeeded (Path 1 literal swap)

    const after = readPageContent(live);
    expect(after).toContain(IMG);      // inline image byte-identical (fast-path splice)
    expect(after).toContain('(Hi) Tj');
    expect(after).not.toContain('(HELLO)');

    // The spliced stream must be valid PDF — pdf.js parses + renders it.
    const bytes = await live.save();
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const c2d = canvas.getContext('2d');
    if (!c2d) throw new Error('no ctx');
    await expect(page.render({ canvas, canvasContext: c2d, viewport: vp }).promise).resolves.toBeUndefined();
  });
});
