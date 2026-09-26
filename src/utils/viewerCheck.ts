/**
 * WS8: does the page on screen match the page PDFturbo will export or sign?
 *
 * The load guard used to answer that by MODELLING pdf.js's cross-reference reader and page walk on top of pdf-lib's
 * parse, and a crafted file got past that model wherever the two libraries tokenize the same bytes differently (the
 * closing audit of 2026-09-24 measured ten such shapes). This module asks pdf.js itself instead: it builds the copy
 * the export builds — pdf-lib's pages copied into a FRESH document, as `_assemblePdfDoc` does — opens it with pdf.js,
 * and compares every page pdf.js shows for the original with the same page of that copy.
 *
 * Two traps, both measured before this was written (`tests/tools/ws8Cost.test.ts`):
 *  - The copy must be a fresh document. `libDoc.save()` keeps the original's object numbers, duplicate definitions,
 *    linearization dictionary and /Count lies, so pdf.js re-reads it with the same quirks and a mismatch compares equal.
 *  - Operators are taken with annotations DISABLED. The fresh copy has no /AcroForm, so pdf.js draws its widgets
 *    differently; with annotations drawn, 7 of 8 real forms mismatched on every widget page.
 *
 * Each page is fingerprinted three ways: its text (strings and origins, `getTextContent`), its operator list
 * (`getOperatorList`) — the operators in order plus a hash of their numeric operands and colours — and the DECODED
 * PIXELS of every image XObject it paints (limits row 13). Text alone misses a page whose caption matches and whose
 * picture was swapped; operators alone miss a page whose strings differ inside the same drawing calls; and an image
 * reaches the operator list only as an id, a width and a height, so a same-size image with different pixels compared
 * equal until the pixel hash. Inline images and image masks carry their pixels in their operands already. A page
 * pdf.js cannot produce fingerprints as `ERR:<name>`, so a page that errors or draws blank on screen and not in the
 * copy is a mismatch.
 *
 * Page counts: pdf.js showing FEWER pages than pdf-lib holds is allowed — the app only exports the pages it shows
 * (a disclosed bound). pdf-lib holding fewer than pdf.js shows is a mismatch on every page it lacks.
 *
 * Optional content is a separate input, because neither fingerprint sees it: `getTextContent` and `getOperatorList`
 * both return a hidden layer's content. `hiddenLayers` reports whether the original switches any layer OFF; the
 * export has to carry that setting across, which is the caller's business.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PDFDocument } from '@cantoo/pdf-lib';
import { carryLayers, copySourcePages } from '../export/copySourcePages';
import { withPdfjsAssets } from './pdfjsParams';

/** The slice of the pdf.js module this check uses — the app's `pdfjs-dist`, or the legacy build under Node. */
export interface ViewerPdfJs {
  getDocument(src: { data: Uint8Array; verbosity?: number; cMapUrl?: string; cMapPacked?: boolean; wasmUrl?: string; iccUrl?: string; useWorkerFetch?: boolean }): { promise: Promise<PDFDocumentProxy> };
  AnnotationMode: { DISABLE: number };
  OPS: { paintImageXObject: number; paintImageXObjectRepeat: number };
}

export interface ViewerCheckResult {
  /** 1-based pages pdf.js shows whose content differs from the exported copy's. */
  pages: number[];
  /** The original switches at least one optional-content layer OFF. */
  hiddenLayers: boolean;
}

/**
 * A hash of an operator list's OPERANDS: every number (rounded to 1/100 pt) and every colour, in order. Other
 * strings are skipped because they are per-document ids (`g_d0_f1`, `img_p1_1`) that differ between the original
 * and the copy for the same content. Without this a page whose operators match and whose operands differ — a colour,
 * where a shape or image is placed — compared equal (measured: `buildDupContentPdf('colourOnly' | 'moved')`).
 */
function operandHash(argsArray: unknown[]): string {
  let h = 0x811c9dc5;
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 0x7c, 0x01000193); // separator, so [1, 23] and [12, 3] differ
  };
  const walk = (v: unknown, depth: number): void => {
    if (typeof v === 'number') mix(v.toFixed(2));
    else if (typeof v === 'string') { if (/^#[0-9a-f]{6}$/i.test(v)) mix(v.toLowerCase()); }
    else if (typeof v === 'boolean') mix(v ? 't' : 'f');
    else if (depth > 6 || v === null || typeof v !== 'object') return;
    else if (ArrayBuffer.isView(v)) { for (const n of Array.from(v as unknown as ArrayLike<number>)) mix((+n).toFixed(2)); }
    else if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); }
    else { for (const x of Object.values(v)) walk(x, depth + 1); }
  };
  for (const args of argsArray) { walk(args, 0); mix('|'); }
  return (h >>> 0).toString(16);
}

/** FNV-1a over a byte-like sequence, sampled every `step` elements. */
function fnv(bytes: ArrayLike<number>, step = 1, seed = 0x811c9dc5): number {
  let h = seed;
  for (let i = 0; i < bytes.length; i += step) h = Math.imul(h ^ (bytes[i] & 0xff), 0x01000193);
  return h >>> 0;
}

/** What pdf.js hands over for a decoded image: a bitmap in a browser worker, raw pixel data without one. */
interface DecodedImage { width?: number; height?: number; kind?: number; bitmap?: ImageBitmap; data?: ArrayLike<number> }
interface ObjStore { get(id: string, callback: (value: unknown) => void): unknown }

/** Resolve a decoded image by id. pdf.js keeps an image used on several pages (`g_…`) in `commonObjs`. */
function decodedImage(page: PDFPageProxy, id: string): Promise<DecodedImage | null> {
  const stores = page as unknown as { objs: ObjStore; commonObjs: ObjStore };
  const store = id.startsWith('g_') ? stores.commonObjs : stores.objs;
  return new Promise(resolve => {
    // pdf.js resolves every painted image (with null when it fails to decode); the timeout only keeps a broken
    // worker from holding an export forever, and a timed-out image fingerprints as such on its side.
    const timer = setTimeout(() => resolve(null), 30_000);
    try {
      store.get(id, v => { clearTimeout(timer); resolve((v ?? null) as DecodedImage | null); });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * A hash of an image's DECODED pixels. In a browser pdf.js hands over an `ImageBitmap`: it is reduced to 64×64 with
 * `createImageBitmap` (asynchronous, so a 19-megapixel scan does not block the main thread — measured 36 ms worst
 * single step on the heaviest corpus paper) and those pixels are hashed. Without a bitmap (Node, jsdom) the raw
 * pixel data is hashed, sampled to at most ~16k values. Both sides of the comparison run in the same environment and
 * decode the same way, so equal pixels hash equal; the reduction means a change confined to a few pixels of a large
 * image is not seen — a stated bound.
 */
async function imageHash(img: DecodedImage | null): Promise<string> {
  if (!img) return 'none';
  const size = `${img.width ?? 0}x${img.height ?? 0}`;
  try {
    if (img.bitmap && typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
      const small = await createImageBitmap(img.bitmap, { resizeWidth: 64, resizeHeight: 64, resizeQuality: 'low' });
      const ctx = new OffscreenCanvas(64, 64).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      ctx.drawImage(small, 0, 0);
      small.close();
      return `b${size}:${fnv(ctx.getImageData(0, 0, 64, 64).data).toString(16)}`;
    }
    if (img.data) {
      const step = Math.max(1, Math.floor(img.data.length / 16_384));
      return `d${size}k${img.kind ?? 0}:${fnv(img.data, step).toString(16)}`;
    }
  } catch (e) {
    return `ERR:${(e as Error).name}`;
  }
  return `?${size}`;
}

async function imageHashes(page: PDFPageProxy, ol: { fnArray: ArrayLike<number>; argsArray: unknown[] }, pdfjs: ViewerPdfJs): Promise<string> {
  const out: string[] = [];
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i];
    if (fn !== pdfjs.OPS.paintImageXObject && fn !== pdfjs.OPS.paintImageXObjectRepeat) continue;
    const id = (ol.argsArray[i] as unknown[] | undefined)?.[0];
    out.push(typeof id === 'string' ? await imageHash(await decodedImage(page, id)) : 'noid');
  }
  return out.join(',');
}

async function fingerprints(doc: PDFDocumentProxy, count: number, pdfjs: ViewerPdfJs): Promise<string[]> {
  const out: string[] = [];
  for (let p = 1; p <= count; p++) {
    try {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const text = (tc.items as Array<{ str?: string; transform?: number[] }>)
        .filter(i => typeof i.str === 'string' && Array.isArray(i.transform))
        .map(i => `${i.str}@${(i.transform as number[])[4].toFixed(2)},${(i.transform as number[])[5].toFixed(2)}`)
        .join('|');
      const ol = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });
      // Hashed before `cleanup()`, which releases the decoded images.
      const images = await imageHashes(page, ol, pdfjs);
      out.push(`${text}#${Array.from(ol.fnArray).join(',')}#${operandHash(ol.argsArray)}#${images}`);
      page.cleanup();
    } catch (e) {
      out.push(`ERR:${(e as Error).name}`);
    }
  }
  return out;
}

async function anyLayerOff(doc: PDFDocumentProxy): Promise<boolean> {
  const config = await doc.getOptionalContentConfig();
  if (!config) return false;
  for (const [, group] of config as unknown as Iterable<[string, { visible: boolean }]>) {
    if (!group.visible) return true;
  }
  return false;
}

export async function viewerMismatch(
  libDoc: PDFDocument, original: PDFDocumentProxy, pdfjs: ViewerPdfJs,
): Promise<ViewerCheckResult> {
  const { PDFDocument: Doc } = await import('@cantoo/pdf-lib');
  const fresh = await Doc.create({ updateMetadata: false });
  // Built exactly as the export builds its pages, layer settings included (WS8 step 5): the operand hash sees a
  // layer's state, so a copy without them would mismatch every page that uses one.
  const { pages: copied, ocProperties } = await copySourcePages(fresh, libDoc, libDoc.getPageIndices());
  for (const page of copied) fresh.addPage(page);
  if (ocProperties) await carryLayers(fresh, ocProperties);
  const copyBytes = await fresh.save();

  const task = pdfjs.getDocument(withPdfjsAssets({ data: copyBytes, verbosity: 0 }));
  const copy = await task.promise;
  try {
    const shown = original.numPages;
    const [a, b] = await Promise.all([
      fingerprints(original, shown, pdfjs),
      fingerprints(copy, Math.min(shown, copy.numPages), pdfjs),
    ]);
    const pages: number[] = [];
    for (let i = 0; i < shown; i++) if (i >= b.length || a[i] !== b[i]) pages.push(i + 1);
    return { pages, hiddenLayers: await anyLayerOff(original) };
  } finally {
    await copy.loadingTask.destroy();
  }
}
