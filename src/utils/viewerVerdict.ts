/**
 * WS8: one viewer-check verdict per source document, computed once and shared.
 *
 * `loadPdfDocument` runs at up to twelve call sites, several per export, and the check costs seconds of pdf.js work
 * on a large file (measured 8–13 s wall-clock for 67–142-page reports in Chrome, almost all of it in pdf.js's
 * worker). So the verdict is cached against the source's bytes — by IDENTITY, the `Uint8Array` the document model
 * holds — and started in the background when the file is opened, so an export awaits a result that is usually
 * already there instead of starting its own.
 *
 * The original is opened afresh from its bytes, in its own pdf.js worker, rather than through the document the app
 * renders with: fingerprinting every page through the app's document would queue behind page and thumbnail rendering
 * in the same worker. Encrypted sources never get here — every source-reading site loads with no password and pdf-lib
 * refuses encrypted input first, as it did before WS8.
 *
 * A rejected verdict stays cached: the check is deterministic, so the same bytes fail the same way every time.
 */
import type { PDFDocument } from '@cantoo/pdf-lib';
import { viewerMismatch, type ViewerCheckResult, type ViewerPdfJs } from './viewerCheck';
import { withCMaps } from './pdfjsParams';

const verdicts = new WeakMap<Uint8Array, Promise<ViewerCheckResult>>();

async function compute(bytes: Uint8Array, libDoc?: PDFDocument): Promise<ViewerCheckResult> {
  const lib = await import('pdfjs-dist');
  // In the app `infra/pdfRenderer.ts` configures the worker at startup; this must not depend on that import having
  // run first. Only a real browser has a `Worker`: jsdom and Node leave `workerSrc` unset and pdf.js uses its
  // in-process fake worker there. (Measured: without this, the browser suite failed every guarded load with
  // `No "GlobalWorkerOptions.workerSrc" specified`.)
  if (!lib.GlobalWorkerOptions.workerSrc && typeof Worker !== 'undefined') {
    lib.GlobalWorkerOptions.workerSrc = (await import('./pdf-worker-shim?worker&url')).default as string;
  }
  const pdfjs = lib as unknown as ViewerPdfJs;
  let doc = libDoc;
  if (!doc) {
    const { PDFDocument: Doc } = await import('@cantoo/pdf-lib');
    doc = await Doc.load(bytes, { updateMetadata: false });
  }
  // `getDocument` transfers its buffer; the source's own bytes must survive.
  const task = pdfjs.getDocument(withCMaps({ data: bytes.slice(0), verbosity: 0 }));
  const original = await task.promise;
  try {
    return await viewerMismatch(doc, original, pdfjs);
  } finally {
    await original.loadingTask.destroy();
  }
}

/**
 * The verdict for `bytes`, computing it (with `libDoc` when the caller already parsed one) if nothing is cached.
 * `libDoc` must be an unmodified parse of exactly these bytes — it is only read, before this resolves.
 */
export function viewerVerdict(bytes: Uint8Array, libDoc?: PDFDocument): Promise<ViewerCheckResult> {
  let verdict = verdicts.get(bytes);
  if (!verdict) {
    verdict = compute(bytes, libDoc);
    verdicts.set(bytes, verdict);
    // Awaited later by whoever needs it; an unobserved background failure must not surface as unhandled.
    verdict.catch(() => undefined);
  }
  return verdict;
}

/** Start the check for a freshly opened source without waiting for it. */
export function prewarmViewerVerdict(bytes: Uint8Array): void {
  void viewerVerdict(bytes);
}

/**
 * Give `to` the verdict of `from`, when `to` is bytes pdf-lib wrote from a parse of `from` that passed the check — a
 * true edit or a searchable-OCR layer, which change one page's content and keep every object pdf.js and pdf-lib agreed
 * on. Without this every edit would re-run seconds of pdf.js work before the next export. A no-op when `from` has no
 * verdict: `to` is then checked on its own when first loaded.
 */
export function inheritViewerVerdict(from: Uint8Array, to: Uint8Array): void {
  const verdict = verdicts.get(from);
  if (verdict && !verdicts.has(to)) verdicts.set(to, verdict);
}

/** A verdict is cached (pending or settled) for exactly these bytes. For tests. */
export function hasViewerVerdict(bytes: Uint8Array): boolean {
  return verdicts.has(bytes);
}
