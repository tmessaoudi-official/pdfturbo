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
 * Each page is fingerprinted twice: its text (strings and origins, `getTextContent`) and its operator sequence
 * (`getOperatorList`). Text alone misses a page whose caption matches and whose picture was swapped; operators alone
 * miss a page whose strings differ inside the same drawing calls. A page pdf.js cannot produce fingerprints as
 * `ERR:<name>`, so a page that errors or draws blank on screen and not in the copy is a mismatch.
 *
 * Page counts: pdf.js showing FEWER pages than pdf-lib holds is allowed — the app only exports the pages it shows
 * (a disclosed bound). pdf-lib holding fewer than pdf.js shows is a mismatch on every page it lacks.
 *
 * Optional content is a separate input, because neither fingerprint sees it: `getTextContent` and `getOperatorList`
 * both return a hidden layer's content. `hiddenLayers` reports whether the original switches any layer OFF; the
 * export has to carry that setting across, which is the caller's business.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PDFDocument } from '@cantoo/pdf-lib';

/** The slice of the pdf.js module this check uses — the app's `pdfjs-dist`, or the legacy build under Node. */
export interface ViewerPdfJs {
  getDocument(src: { data: Uint8Array; verbosity?: number }): { promise: Promise<PDFDocumentProxy> };
  AnnotationMode: { DISABLE: number };
}

export interface ViewerCheckResult {
  /** 1-based pages pdf.js shows whose content differs from the exported copy's. */
  pages: number[];
  /** The original switches at least one optional-content layer OFF. */
  hiddenLayers: boolean;
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
      out.push(`${text}#${Array.from(ol.fnArray).join(',')}`);
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
  for (const page of await fresh.copyPages(libDoc, libDoc.getPageIndices())) fresh.addPage(page);
  const copyBytes = await fresh.save();

  const task = pdfjs.getDocument({ data: copyBytes, verbosity: 0 });
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
