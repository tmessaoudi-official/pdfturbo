/**
 * WS7 round 10 — pdf-lib 2.11.0 swapped pako for fflate, whose inflate REJECTS a truncated zlib
 * stream (`unexpected EOF`) that 2.8.1 embedded. Chrome's own decoder is lenient, so a PNG the user
 * can plainly SEE in a browser stopped embedding: DOCX→PDF dropped it silently, and opening it as a
 * document failed with `toast.imageConversionFailed`.
 *
 * `embedPngTolerant` tries pdf-lib first (byte-identical for every PNG that already embedded) and
 * only on a throw lets the browser decode the image and re-encode it through a canvas. Measured on
 * the four truncated fixtures this repo carried: Chrome recovers the three 1×1 ones; the 2×2 RGB one
 * fails `decode()` too, and stays a failure — the fallback never invents an image.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { PDFDocument } from '@cantoo/pdf-lib';
import { embedPngTolerant } from '../../src/utils/pngEmbed';
import { docModelToPdfBytes } from '../../src/docx/docxToPdf';
import { DocumentLoader } from '../../src/ui/documentLoader';

// 1×1 RGBA PNG with a truncated zlib stream — fflate rejects it, Chrome decodes it.
const RECOVERABLE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// 2×2 RGB PNG with a truncated zlib stream — Chrome's decode() rejects it as well.
const UNRECOVERABLE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD8GO2jAAAAD0lEQVR42mP8z8BQz0AEAAUDAQGc8sJEAAAAAElFTkSuQmCC';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const bytesOf = (b64: string): Uint8Array => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

function isPaintImage(fn: number): boolean {
  return fn === pdfjsLib.OPS.paintImageXObject
    || fn === pdfjsLib.OPS.paintImageXObjectRepeat
    || fn === pdfjsLib.OPS.paintInlineImageXObject;
}
async function countPaintImage(bytes: Uint8Array): Promise<number> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  let n = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const list = await (await doc.getPage(i)).getOperatorList();
    n += Array.from(list.fnArray as number[]).filter(isPaintImage).length;
  }
  return n;
}

describe('embedPngTolerant (real Chrome)', () => {
  it('pdf-lib alone rejects the recoverable fixture — so the next case is not vacuous', async () => {
    const doc = await PDFDocument.create();
    await expect(doc.embedPng(bytesOf(RECOVERABLE_B64))).rejects.toThrow(/unexpected EOF/);
  });

  it('recovers a truncated PNG the browser can decode', async () => {
    const doc = await PDFDocument.create();
    const img = await embedPngTolerant(doc, bytesOf(RECOVERABLE_B64));
    expect([img.width, img.height]).toEqual([1, 1]);
  });

  it('still rejects a PNG the browser cannot decode either', async () => {
    const doc = await PDFDocument.create();
    await expect(embedPngTolerant(doc, bytesOf(UNRECOVERABLE_B64))).rejects.toBeTruthy();
  });
});

describe('DOCX → PDF keeps a recoverable image (real Chrome)', () => {
  const block = (dataB64: string) => ({ kind: 'image' as const, image: { dataB64, mime: 'image/png' as const, widthPt: 60, heightPt: 60 }, anchorId: 0 });

  it('paints the recovered image and reports nothing skipped', async () => {
    const p = { runs: [{ text: 'Figure:' }] };
    const res = await docModelToPdfBytes({ blocks: [p, block(RECOVERABLE_B64)], paragraphs: [p] });
    expect(res.skippedImages).toBe(0);
    expect(await countPaintImage(res.bytes)).toBe(1);
  });

  it('counts an unrecoverable image as skipped and paints none', async () => {
    const p = { runs: [{ text: 'Figure:' }] };
    const res = await docModelToPdfBytes({ blocks: [p, block(UNRECOVERABLE_B64)], paragraphs: [p] });
    expect(res.skippedImages).toBe(1);
    expect(await countPaintImage(res.bytes)).toBe(0);
  });
});

describe('opening a truncated PNG as a document (real Chrome)', () => {
  const loader = (): DocumentLoader => new DocumentLoader({} as never);

  it('converts a recoverable PNG into a one-page PDF with the image on it', async () => {
    const file = new File([bytesOf(RECOVERABLE_B64) as BlobPart], 'scan.png', { type: 'image/png' });
    const { bytes, name } = await loader().imagesToPdf([file]);
    expect(name).toBe('scan.pdf');
    expect(await countPaintImage(bytes)).toBe(1);
  });

  it('rejects an unrecoverable PNG (the caller shows toast.imageConversionFailed)', async () => {
    const file = new File([bytesOf(UNRECOVERABLE_B64) as BlobPart], 'broken.png', { type: 'image/png' });
    await expect(loader().imagesToPdf([file])).rejects.toBeTruthy();
  });
});
