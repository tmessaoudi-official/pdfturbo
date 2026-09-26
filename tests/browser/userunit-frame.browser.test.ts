/**
 * /UserUnit (real Chrome) — what the user draws over is what the export removes.
 *
 * pdf.js multiplies every viewport by the page's /UserUnit (`pdf.mjs:826`), so on a /UserUnit 2 page the
 * editor canvas was twice the size of the page in points, and every coordinate the user produced by
 * drawing on it was doubled. The export (pdf-lib) works in plain points, so a redaction drawn over a
 * secret was burned at twice the secret's position and the secret stayed VISIBLE — measured on
 * 2026-09-26 before this fix. The editor now measures in points (`pointViewport`).
 *
 * Nothing here assumes which frame is right. The redaction is placed where the secret's INK is on the
 * canvas the real `PDFRenderer` draws — which is exactly where a user would drag — so the test is red
 * whenever the editor and the export disagree, in either direction. The page is NON-SQUARE and every
 * case runs against a /UserUnit 1 CONTROL that must pass before and after.
 */
import { describe, it, expect } from 'vitest';
// The app's text-layer rules (spans are absolutely positioned and sized by pdf.js's CSS variables).
import '../../src/styles/pdf-layers.css';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { PDFRenderer } from '../../src/infra/pdfRenderer';
import { TextLayerManager } from '../../src/utils/textLayer';
import { pointViewport } from '../../src/utils/pointViewport';
import { rasterizePageWithRedactions } from '../../src/export/exportPipeline';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { RedactionElement } from '../../src/elements/redactionElement';
import { InkLayer } from '../../src/infra/inkLayer';
import { loadPdfDocument } from '../../src/utils/pdfLoadGuard';
import type { DocumentModel, DocumentPage, WatermarkSettings } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';
import type { FlowDoc } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W = 400, H = 300;
const SECRET = 'CONFIDENTIALCASE';
const PUBLIC = 'PUBLICWORDS';
const failLoud = {
  info() {},
  silent(_e?: unknown, msg?: string) { throw new Error(`export reported: ${msg}`); },
  warn(key: string) { throw new Error(`export warned: ${key}`); },
  error(key: string, err?: unknown) { throw new Error(`export errored: ${key} ${String(err)}`); },
} as unknown as IErrorReporter;
const noWatermark: WatermarkSettings = { enabled: false, text: '', opacity: 0, angle: 0, color: '#000000', fontSize: 10 };
const docPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 } as DocumentPage;

/** A 400x300-point page: the secret near the top, a public line near the bottom, /UserUnit `unit`. */
async function build(unit: number): Promise<Uint8Array> {
  const { PDFDocument, PDFName, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  if (unit !== 1) page.node.set(PDFName.of('UserUnit'), doc.context.obj(unit));
  page.drawText(SECRET, { x: 40, y: H - 70, size: 14, font });
  page.drawText(PUBLIC, { x: 40, y: 60, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

function open(bytes: Uint8Array): Promise<pdfjsLib.PDFDocumentProxy> {
  return pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
}

/** Render through the app's own editor renderer at `scale`; returns its canvas. */
async function editorCanvas(doc: pdfjsLib.PDFDocumentProxy, scale: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  const r = new PDFRenderer(canvas);
  r.setModel({
    pages: [docPage], currentPage: docPage, currentPageIndex: 0, pageCount: 1,
    sourcePdfs: new Map([['s1', { doc }]]),
  } as unknown as DocumentModel);
  r.setScale(scale);
  await r.renderCurrentPage();
  return canvas;
}

/** Bounding box of dark pixels in the top half of a canvas — the secret line. */
function secretInk(c: HTMLCanvasElement): { x0: number; y0: number; x1: number; y1: number } {
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const { data, width } = ctx.getImageData(0, 0, c.width, Math.floor(c.height / 2));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && data[i] < 128) {
      const p = i / 4, x = p % width, y = Math.floor(p / width);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  if (!Number.isFinite(x0)) throw new Error('no secret ink on the editor canvas');
  return { x0, y0, x1, y1 };
}

/** The redaction a user draws over the secret: its ink box on the scale-1 editor canvas, padded. */
async function coverAsDrawn(doc: pdfjsLib.PDFDocumentProxy): Promise<RedactionElement> {
  const b = secretInk(await editorCanvas(doc, 1));
  return new RedactionElement(b.x0 - 4, b.y0 - 4, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8, 'p1', '#000000');
}

/** Pixel width of the one image XObject on page 1 — the raster's resolution. */
async function imageWidth(bytes: Uint8Array): Promise<number> {
  const { PDFDocument, PDFName, PDFDict } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const xo = doc.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  const entries = xo ? xo.entries() : [];
  expect(entries.length, 'exactly one image on the page').toBe(1);
  const img = doc.context.lookup(entries[0][1]) as unknown as { dict: { get(k: unknown): unknown } };
  return (img.dict.get(PDFName.of('Width')) as { asNumber(): number }).asNumber();
}

async function darknessAt(bytes: Uint8Array, box: { x0: number; y0: number; x1: number; y1: number }): Promise<number> {
  const pdf = await open(bytes);
  const pg = await pdf.getPage(1);
  const vp = pointViewport(pg, { scale: 1 });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  await pg.render({ canvas: c, canvasContext: ctx, viewport: vp } as never).promise;
  const d = ctx.getImageData(box.x0, box.y0, box.x1 - box.x0 + 1, box.y1 - box.y0 + 1).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
  return 255 - s / (d.length / 4);
}

describe('/UserUnit — the editor works in points', () => {
  for (const unit of [1, 2]) {
    const label = unit === 1 ? 'CONTROL /UserUnit 1' : '/UserUnit 2';

    it(`${label}: the editor canvas at 100% is the page in points, the secret where a UserUnit-1 page has it`, async () => {
      const control = secretInk(await editorCanvas(await open(await build(1)), 1));
      const c = await editorCanvas(await open(await build(unit)), 1);
      expect([c.width, c.height]).toEqual([W, H]);
      expect(secretInk(c)).toEqual(control);
    });

    it(`${label}: a redaction drawn over the secret burns ON it in the exported page`, async () => {
      const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
      const bytes = await build(unit);
      const cover = await coverAsDrawn(await open(bytes));
      const src = await loadPdfDocument(bytes, { viewerCheck: 'source', updateMetadata: false });
      const target = await PDFDocument.create();
      await rasterizePageWithRedactions(src, docPage, [cover as unknown as PDFElement], target,
        { rgb, StandardFonts, degrees }, noWatermark, new InkLayer(), failLoud);
      const out = await target.save({ useObjectStreams: false });
      // Where the secret really is — read off a UserUnit-1 page, whose frame is points by definition.
      const truth = secretInk(await editorCanvas(await open(await build(1)), 1));
      expect(await darknessAt(out, truth), 'the whole secret band must be burned').toBeGreaterThan(200);
    });

    it(`${label}: the Word/Markdown/text export drops the redacted line and keeps the rest`, async () => {
      const bytes = await build(unit);
      const doc = await open(bytes);
      const cover = await coverAsDrawn(doc);
      const svc = new ExportService({
        documentModel: { pages: [docPage], sourcePdfs: new Map([['s1', { doc, bytes }]]) },
        elements: [cover],
        reportError: failLoud,
      } as unknown as IExportContext) as unknown as { _extractFlowDoc(): Promise<FlowDoc> };
      const text = JSON.stringify((await svc._extractFlowDoc()).pages[0].paragraphs);
      expect(text).toContain(PUBLIC);
      expect(text).not.toContain(SECRET);
    });

    // The two paths that BUILD a page rather than copy one (the redaction raster and lossy compress)
    // size it in points now, so they must carry the source's /UserUnit or the page exports at 1/u of
    // its physical size beside copied neighbours that keep the key. Read back through pdf.js.
    it(`${label}: the redaction raster page keeps the page's size and /UserUnit`, async () => {
      const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
      const bytes = await build(unit);
      const cover = await coverAsDrawn(await open(bytes));
      const src = await loadPdfDocument(bytes, { viewerCheck: 'source', updateMetadata: false });
      const target = await PDFDocument.create();
      await rasterizePageWithRedactions(src, docPage, [cover as unknown as PDFElement], target,
        { rgb, StandardFonts, degrees }, noWatermark, new InkLayer(), failLoud);
      const out = await target.save({ useObjectStreams: false });
      const pg = await (await open(out)).getPage(1);
      expect([pg.view[2] - pg.view[0], pg.view[3] - pg.view[1]]).toEqual([W, H]);
      expect(pg.userUnit).toBe(unit);
      // Resolution is PHYSICAL: the raster's SCALE 2 per physical point, i.e. 2·u pixels per point.
      expect(await imageWidth(out)).toBe(W * 2 * unit);
    });

    it(`${label}: a CROPPED redaction raster page is the crop window, at 2 px per physical point`, async () => {
      const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
      const bytes = await build(unit);
      const cover = await coverAsDrawn(await open(bytes));
      const src = await loadPdfDocument(bytes, { viewerCheck: 'source', updateMetadata: false });
      const target = await PDFDocument.create();
      // Non-square, off-origin window so a clip divided by the wrong scale cannot pass by symmetry.
      const cropped = { ...docPage, crop: { x: 20, y: 10, width: 240, height: 160 } } as DocumentPage;
      await rasterizePageWithRedactions(src, cropped, [cover as unknown as PDFElement], target,
        { rgb, StandardFonts, degrees }, noWatermark, new InkLayer(), failLoud);
      const out = await target.save({ useObjectStreams: false });
      const pg = await (await open(out)).getPage(1);
      expect([pg.view[2] - pg.view[0], pg.view[3] - pg.view[1]]).toEqual([240, 160]);
      expect(pg.userUnit).toBe(unit);
      expect(await imageWidth(out)).toBe(240 * 2 * unit);
    });

    it(`${label}: a lossy-compressed page keeps the page's size and /UserUnit`, async () => {
      const svc = new ExportService({ reportError: failLoud } as unknown as IExportContext) as unknown as {
        _applyExportPassword(d: unknown): Promise<void>;
        _compressLossy(b: Uint8Array, o: { dpi: number; quality: number }, p: () => void): Promise<Uint8Array>;
      };
      svc._applyExportPassword = async () => {};
      const out = await svc._compressLossy(await build(unit), { dpi: 72, quality: 0.8 }, () => {});
      const pg = await (await open(out)).getPage(1);
      expect([pg.view[2] - pg.view[0], pg.view[3] - pg.view[1]]).toEqual([W, H]);
      expect(pg.userUnit).toBe(unit);
      // 72 DPI means 72 pixels per PHYSICAL inch: one per point times the UserUnit.
      expect(await imageWidth(out)).toBe(W * unit);
    });

    it(`${label}: page-as-image renders at the physical resolution chosen`, async () => {
      const bytes = await build(unit);
      const doc = await open(bytes);
      let settle!: (b: Blob) => void;
      const captured = new Promise<Blob>(res => { settle = res; });
      const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
      const svc = new ExportService({
        documentModel: {
          pageCount: 1, currentPageIndex: 0, pages: [docPage],
          sourcePdfs: new Map([['s1', { doc, bytes }]]),
          watermark: { enabled: false }, bates: { enabled: false },
        },
        elements: [], formValues: {}, currentFilename: 'x.pdf', exportPassword: null,
        inkLayer: { getStrokes: () => [] },
        reportError: failLoud,
        progress: { begin: () => handle },
      } as unknown as IExportContext) as unknown as {
        _saveOrDownload(t: unknown, b: Blob): Promise<void>;
        downloadPageAsImage(i: number, o: { scale: number; format: 'png' }): Promise<void>;
      };
      svc._saveOrDownload = (_t, b) => { settle(b); return Promise.resolve(); };
      const picker = globalThis as typeof globalThis & { showSaveFilePicker?: unknown };
      const saved = picker.showSaveFilePicker;
      delete picker.showSaveFilePicker;
      try {
        await svc.downloadPageAsImage(0, { scale: 1, format: 'png' });
        const bmp = await createImageBitmap(await captured);
        // Scale 1 is 72 DPI: one pixel per physical point, i.e. W·u across.
        expect([bmp.width, bmp.height]).toEqual([W * unit, H * unit]);
      } finally {
        if (saved !== undefined) picker.showSaveFilePicker = saved;
      }
    });

    it(`${label}: the selectable text layer lies on the canvas ink, at 150%`, async () => {
      const doc = await open(await build(unit));
      const canvas = await editorCanvas(doc, 1.5);
      const ink = secretInk(canvas);
      const host = document.createElement('div');
      host.style.position = 'relative';
      canvas.style.position = 'absolute'; canvas.style.left = '0'; canvas.style.top = '0';
      host.append(canvas);
      document.body.append(host);
      try {
        const page = await doc.getPage(1);
        await new TextLayerManager(host).render(page, pointViewport(page, { scale: 1.5 }), { left: 0, top: 0 });
        const span = [...host.querySelectorAll('.textLayer span')].find(s => s.textContent?.includes(SECRET));
        expect(span, 'the secret has a text-layer span').toBeTruthy();
        const hr = host.getBoundingClientRect(), sr = (span as HTMLElement).getBoundingClientRect();
        // The span box encloses the glyph ink (line height > cap height), within a few pixels.
        expect(Math.abs(sr.left - hr.left - ink.x0)).toBeLessThan(4);
        expect(Math.abs(sr.right - hr.left - ink.x1)).toBeLessThan(6);
        expect(sr.top - hr.top).toBeLessThanOrEqual(ink.y0 + 2);
        expect(sr.bottom - hr.top).toBeGreaterThanOrEqual(ink.y1 - 2);
        expect(sr.height).toBeLessThan((ink.y1 - ink.y0) * 2.5);
      } finally {
        host.remove();
      }
    });
  }
});
