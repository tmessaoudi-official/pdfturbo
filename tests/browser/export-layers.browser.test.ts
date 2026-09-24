/**
 * WS8 step 5 — a layer the source switches OFF stays hidden in every export that renders pixels.
 *
 * Measured before the fix (2026-09-24): the hidden layer's band drew 0 dark pixels on the original and 307 on the
 * export. Each rasterising path builds its own copy of the source page, so each is driven here: the page as image,
 * the thumbnail, a redaction-bearing page (the rasteriser's temp document), and the assembled PDF rendered by pdf.js.
 * The fixture's hidden layer is the only red thing on the page; the always-drawn green square is the control that
 * the page rendered at all.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { RedactionElement } from '../../src/elements/redactionElement';
import { countColours } from './_redactedAnnotationFixture';
import { buildColourLayerPdf } from '../utils/_viewerCheckFixture';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

type Picker = typeof globalThis & { showSaveFilePicker?: unknown };
const ORIGINAL_PICKER = (globalThis as Picker).showSaveFilePicker;
afterEach(() => {
  if (ORIGINAL_PICKER === undefined) delete (globalThis as Picker).showSaveFilePicker;
  else (globalThis as Picker).showSaveFilePicker = ORIGINAL_PICKER;
});

async function ctxFor(state: 'OFF' | 'ON', redacted = false): Promise<IExportContext> {
  const bytes = buildColourLayerPdf(state);
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  // Clear of both squares, so it removes neither: it only routes the page through the rasteriser.
  const elements = redacted ? [new RedactionElement(250, 20, 30, 30, 'p1', '#000000')] : [];
  return {
    documentModel: {
      pageCount: 1, currentPageIndex: 0,
      pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
      sourcePdfs: new Map([['s1', { bytes, doc }]]),
      watermark: { enabled: false }, bates: { enabled: false },
    },
    elements, formValues: {}, currentFilename: 'layers.pdf', exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: { info() {}, warn() {}, error(key: string, err?: unknown) { throw new Error(`${key}: ${String(err)}`); } },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {}, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
  } as unknown as IExportContext;
}

async function renderPdf(bytes: Uint8Array): Promise<{ red: number; green: number }> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    await page.render({ canvas, viewport: vp }).promise;
    return countColours(canvas.toDataURL('image/png'));
  } finally {
    await doc.loadingTask.destroy();
  }
}

async function imageExport(ctx: IExportContext): Promise<{ red: number; green: number }> {
  let settle!: (b: Blob) => void;
  const captured = new Promise<Blob>(res => { settle = res; });
  (globalThis as Picker).showSaveFilePicker = () => Promise.resolve({
    name: 'page.png',
    createWritable: () => Promise.resolve({
      write: (d: Blob) => { settle(d); return Promise.resolve(); },
      close: () => Promise.resolve(),
    }),
  });
  await new ExportService(ctx).downloadPageAsImage(0, { scale: 1, format: 'png' });
  return countColours(await captured);
}

const PATHS: Array<[string, (state: 'OFF' | 'ON') => Promise<{ red: number; green: number }>]> = [
  ['the source itself', state => renderPdf(buildColourLayerPdf(state))],
  ['the assembled PDF', async state => renderPdf(await new ExportService(await ctxFor(state)).assemblePdfBytes())],
  ['a redaction-bearing page', async state => renderPdf(await new ExportService(await ctxFor(state, true)).assemblePdfBytes())],
  ['the page as image', async state => imageExport(await ctxFor(state))],
  // A page with no element takes the source-only raster, which renders the original; only a page carrying one
  // composites through its own copy, so this path needs the element.
  ['the thumbnail', async state => countColours(await new ExportService(await ctxFor(state, true)).renderThumbnailWithOverlays(0, 1) as string)],
];

describe('a layer the source switches OFF — WS8 step 5', () => {
  it.each(PATHS)('%s: the hidden layer draws nothing, the page still renders', async (_path, render) => {
    const { red, green } = await render('OFF');
    expect(red).toBe(0);
    expect(green).toBeGreaterThan(5000);
  }, 60_000);

  it.each(PATHS)('%s: an ON layer is drawn (control)', async (_path, render) => {
    const { red, green } = await render('ON');
    expect(red).toBeGreaterThan(5000);
    expect(green).toBeGreaterThan(5000);
  }, 60_000);
});
