/**
 * PNG embedding that survives pdf-lib 2.11.0's strict decoder.
 *
 * 2.11.0 swapped pako for fflate, whose inflate rejects a truncated zlib stream (`unexpected EOF`)
 * that 2.8.1 embedded. Browsers decode the same bytes leniently, so a PNG the user can plainly see
 * in a browser stopped embedding: DOCX→PDF dropped it silently and opening it as a document failed.
 *
 * pdf-lib is tried FIRST, so every PNG that already embedded is byte-identical. Only on a throw does
 * the browser decode the image and a canvas re-encode it — and only where the browser can actually
 * decode: jsdom has no `HTMLImageElement.decode` (and never fires image events), so there the
 * original error is rethrown rather than waiting on an event that will not come. A PNG the browser
 * cannot decode either stays a failure; the fallback never invents an image.
 */
import type { PDFDocument, PDFImage } from '@cantoo/pdf-lib';

function browserCanDecode(): boolean {
  return typeof HTMLImageElement !== 'undefined' && typeof HTMLImageElement.prototype.decode === 'function';
}

/** Decode any image the browser can display and re-encode it as PNG through a canvas. */
export async function rasterToPngBytes(image: Blob): Promise<Uint8Array> {
  const url = URL.createObjectURL(image);
  try {
    const el = new Image();
    el.src = url;
    await el.decode();
    const canvas = document.createElement('canvas');
    canvas.width = el.naturalWidth;
    canvas.height = el.naturalHeight;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('canvas 2d context unavailable');
    g.drawImage(el, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => { canvas.toBlob(resolve, 'image/png'); });
    if (!blob) throw new Error('canvas.toBlob returned null');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function embedPngTolerant(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  try {
    return await doc.embedPng(bytes);
  } catch (err) {
    if (!browserCanDecode()) throw err;
    const reencoded = await rasterToPngBytes(new Blob([bytes as BlobPart], { type: 'image/png' }));
    return doc.embedPng(reencoded);
  }
}
