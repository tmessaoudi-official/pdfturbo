/**
 * Limits row 16 (C9) — the sign-rect prefill lands on the page the signer actually signs.
 *
 * `PdfSigner` signs `assemblePdfBytes()`. A page carrying a redaction is rasterised there onto a fresh page at
 * origin (0,0), sized to the displayed view, with the rotation baked in (`sign-assembled-frame.browser.test.ts`
 * pins that frame). The prefill used to map onto the SOURCE page's absolute user space, so on such a page the
 * signature landed displaced — rotated at 90/270. It now maps onto the assembled page's own box.
 *
 * The oracle assumes no frame: the source page carries a GREEN square, the rect is drawn over where pdf.js
 * DISPLAYS that square, and after the prefill the real `assemblePdfBytes()` — the bytes `PdfSigner` signs — is
 * rendered and sampled INSIDE the prefilled /Rect. Green there means the signature sits on what the user drew
 * over, whatever the frames do. The prefill reads its box through the real `ExportService.assembledPageBox`,
 * which assembles the one page alone, so a disagreement between that and the whole-document assembly reds too.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { PDFTurboApp } from '../../src/core/pdfTurboApp';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { RedactionElement } from '../../src/elements/redactionElement';
import { pointViewport } from '../../src/utils/pointViewport';
import { InkLayer } from '../../src/infra/inkLayer';
import type { DocumentPage } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const MEDIA = 400;
const CROP = { x: 30, y: 70, w: 300, h: 240 };   // inset, non-square, asymmetric origin
const SQUARE = { x: CROP.x + 190, y: CROP.y + 40, s: 50 }; // off-centre, so a rotation error misses it
const loud = {
  info() {}, silent() {},
  warn(k: string) { throw new Error(`warned: ${k}`); },
  error(k: string, e?: unknown) { throw new Error(`errored: ${k} — ${String(e)}`); },
} as unknown as IErrorReporter;

async function sourceBytes(srcRot: number): Promise<Uint8Array> {
  const { PDFDocument, rgb, degrees } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([MEDIA, MEDIA]);
  page.setCropBox(CROP.x, CROP.y, CROP.w, CROP.h);
  if (srcRot) page.setRotation(degrees(srcRot));
  page.drawRectangle({ x: SQUARE.x, y: SQUARE.y, width: SQUARE.s, height: SQUARE.s, color: rgb(0, 0.6, 0) });
  return doc.save();
}

/** Where pdf.js DISPLAYS the square at scale 1 — what the user would drag over. */
function displayedSquare(page: pdfjsLib.PDFPageProxy, totalRot: number) {
  const vp = pointViewport(page, { scale: 1, rotation: totalRot });
  const a = vp.convertToViewportPoint(SQUARE.x, SQUARE.y);
  const b = vp.convertToViewportPoint(SQUARE.x + SQUARE.s, SQUARE.y + SQUARE.s);
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
  // Drawn a little inside the square, as a user would.
  return { x: x + 8, y: y + 8, width: Math.abs(a[0] - b[0]) - 16, height: Math.abs(a[1] - b[1]) - 16 };
}

async function prefillAndSample(opts: { srcRot: number; userRot?: number; crop?: DocumentPage['crop']; redacted: boolean }) {
  const bytes = await sourceBytes(opts.srcRot);
  const pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const srcPage = await pdfjsDoc.getPage(1);
  const totalRot = (opts.srcRot + (opts.userRot ?? 0)) % 360;
  const docPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: opts.userRot ?? 0, crop: opts.crop } as DocumentPage;
  // A redaction far from the square: its only job is to send the page down the raster path.
  const elements = opts.redacted ? [new RedactionElement(4, 4, 20, 10, 'p1') as unknown as PDFElement] : [];
  const documentModel = {
    currentPage: docPage, currentPageIndex: 0, pageCount: 1, pages: [docPage],
    sourcePdfs: new Map([['s1', { doc: pdfjsDoc, bytes }]]),
    watermark: { enabled: false }, bates: { enabled: false },
  };

  // The real export path — the same one `PdfSigner` is handed bytes from.
  let oracle = false;
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const svc = new ExportService({
    documentModel, elements, formValues: {}, currentFilename: 'doc.pdf', exportPassword: null,
    inkLayer: new InkLayer(), reportError: loud, progress: { begin: () => handle },
    // A sign pick must not mutate the model: only `assemblePdfBytes` runs this cleanup, and the prefill never calls it
    // (armed after the prefill, below, so the oracle's own `assemblePdfBytes` may).
    cleanEmptyTextElements() { if (!oracle) throw new Error('the sign prefill ran cleanEmptyTextElements'); }, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
  } as unknown as IExportContext);

  const app = Object.create(PDFTurboApp.prototype) as PDFTurboApp;
  const a = app as unknown as Record<string, unknown>;
  const field = () => ({ value: '' }) as HTMLInputElement;
  const ui = { signX: field(), signY: field(), signW: field(), signH: field(), signPage: field() };
  Object.defineProperty(a, 'ui', { value: ui, configurable: true });
  a.documentModel = documentModel;
  a.elements = elements;
  a.setMode = () => {};
  a._reopenSignModal = () => {};
  a._exportService = svc;

  await app.onSignRectPicked(displayedSquare(srcPage, totalRot));
  const r = { x: +ui.signX.value, y: +ui.signY.value, w: +ui.signW.value, h: +ui.signH.value };
  expect(r.w, 'prefilled').toBeGreaterThan(0);

  // Render the page the signer signs and sample inside the prefilled /Rect.
  oracle = true;
  const signed = await pdfjsLib.getDocument({ data: (await svc.assemblePdfBytes()).slice(0) }).promise;
  const page = await signed.getPage(1);
  const vp = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  const samples: string[] = [];
  for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
    const [px, py] = vp.convertToViewportPoint(r.x + r.w * fx, r.y + r.h * fy);
    const d = ctx.getImageData(Math.round(px), Math.round(py), 1, 1).data;
    samples.push(d[1] > 110 && d[0] < 70 && d[2] < 70 ? 'green' : `rgb(${d[0]},${d[1]},${d[2]})`);
  }
  await pdfjsDoc.loadingTask.destroy();
  await signed.loadingTask.destroy();
  return samples;
}

const ALL_GREEN = ['green', 'green', 'green', 'green', 'green'];

describe('sign-rect prefill on a redaction-bearing page lands on what the user drew over (limits row 16)', () => {
  for (const srcRot of [0, 90, 180, 270]) {
    it(`source /Rotate ${srcRot}, inset CropBox`, async () => {
      expect(await prefillAndSample({ srcRot, redacted: true })).toEqual(ALL_GREEN);
    });
  }

  it('user rotation 90 on an upright source', async () => {
    expect(await prefillAndSample({ srcRot: 0, userRot: 90, redacted: true })).toEqual(ALL_GREEN);
  });

  it('a page crop (#G23) around the square, on a /Rotate 90 source', async () => {
    // Content space is y-down from the CropBox's top-left; this window holds the square and stops short of the
    // CropBox on every side, so the raster page is the window alone.
    const crop = { x: 150, y: 120, width: 130, height: 110 };
    expect(await prefillAndSample({ srcRot: 90, crop, redacted: true })).toEqual(ALL_GREEN);
  });

  it('without a redaction the page is copied, and the absolute mapping still lands (control)', async () => {
    expect(await prefillAndSample({ srcRot: 90, redacted: false })).toEqual(ALL_GREEN);
  });
});
