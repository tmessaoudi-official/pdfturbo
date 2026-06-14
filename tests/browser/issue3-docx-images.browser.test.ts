/**
 * ISSUE-3 regression — DOCX export must NOT drop images that pdf.js stores in
 * `page.commonObjs` (the `g_`-prefixed, document-global, de-duplicated store).
 *
 * Root cause (verified via probe 2026-06-14): when one image XObject is reused
 * across ≥2 pages, pdf.js's GlobalImageCache promotes it to `commonObjs` with a
 * `g_`-prefixed name. `_extractFlowDoc` resolved images via `page.objs` only, so
 * `page.objs.get('g_…')` threw and the image was silently skipped (caught by the
 * per-op try/catch). Confirmed: a 3-page reused-image PDF yields
 * `page=2/3 name=g_d0_img_p1_1 inObjs=false inCommon=true`.
 *
 * The page-local case is covered separately by qa-imagetext.pdf (already worked).
 * jsdom cannot run this: it needs real pdf.js rasterization + canvas + the
 * VideoFrame/ImageBitmap the worker produces. Hence the browser harness.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import imageTextPdfUrl from '../fixtures/qa-imagetext.pdf?url';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { flowDocToDocxBase64 } from '../../src/utils/flowDocWriters';
import type { FlowDoc } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

type FlowDocExtractor = { _extractFlowDoc(): Promise<FlowDoc> };

function makeExtractor(doc: pdfjsLib.PDFDocumentProxy): FlowDocExtractor {
  const pages = Array.from({ length: doc.numPages }, (_unused, i) => ({
    sourcePdfId: 's1',
    sourcePageNum: i + 1,
  }));
  // _extractFlowDoc reads documentModel.pages + documentModel.sourcePdfs and
  // elements (for redaction-aware filtering — none here).
  const ctx = {
    documentModel: {
      pages,
      sourcePdfs: new Map([['s1', { doc, bytes: new Uint8Array() }]]),
    },
    elements: [],
  } as unknown as IExportContext;
  return new ExportService(ctx) as unknown as FlowDocExtractor;
}

async function loadFromUrl(url: string): Promise<pdfjsLib.PDFDocumentProxy> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  return pdfjsLib.getDocument({ data: bytes }).promise;
}

function makePngBytes(): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#2980b9';
  ctx.fillRect(16, 16, 32, 32);
  return Promise.resolve(Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]), (ch) => ch.charCodeAt(0)));
}

// One embedded image drawn on 3 pages → pdf.js promotes it to commonObjs (g_).
async function loadReusedImagePdf(): Promise<pdfjsLib.PDFDocumentProxy> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const pdf = await PDFDocument.create();
  const png = await pdf.embedPng(await makePngBytes());
  for (let p = 0; p < 3; p++) {
    const page = pdf.addPage([300, 300]);
    page.drawImage(png, { x: 50, y: 50, width: 120, height: 120 });
  }
  const bytes = await pdf.save();
  return pdfjsLib.getDocument({ data: bytes }).promise;
}

describe('ISSUE-3 — DOCX keeps commonObjs images', () => {
  it('extracts the reused (commonObjs / g_) image across pages', async () => {
    const svc = makeExtractor(await loadReusedImagePdf());
    const flow = await svc._extractFlowDoc();
    const perPage = flow.pages.map((p) => p.images?.length ?? 0);
    // Each of the 3 pages draws the (shared, commonObjs) image once. Pre-fix the
    // commonObjs pages drop to 0; the fix must recover every page.
    expect(perPage).toEqual([1, 1, 1]);
  });

  it('emits a reused-image PDF into word/media of the DOCX', async () => {
    const svc = makeExtractor(await loadReusedImagePdf());
    const flow = await svc._extractFlowDoc();
    const bytes = Uint8Array.from(atob(await flowDocToDocxBase64(flow)), (c) => c.charCodeAt(0));
    const { unzipSync } = await import('fflate');
    const media = Object.keys(unzipSync(bytes)).filter((p) => p.startsWith('word/media/'));
    expect(media.length).toBeGreaterThan(0);
  });

  it('still extracts page-local images (qa-imagetext regression guard)', async () => {
    const svc = makeExtractor(await loadFromUrl(imageTextPdfUrl));
    const flow = await svc._extractFlowDoc();
    const total = flow.pages.reduce((n, p) => n + (p.images?.length ?? 0), 0);
    expect(total).toBeGreaterThan(0);
  });
});
