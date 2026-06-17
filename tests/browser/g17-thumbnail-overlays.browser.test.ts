/**
 * G17 regression — page thumbnails must show the user's overlay annotations and
 * ink, not just the bare source page. `ExportService.renderThumbnailWithOverlays`
 * is the reusable compositor (a thumbnail-scale analog of downloadPageAsImage):
 *   - a page WITH overlays/ink → a JPEG data URL whose pixels carry the overlay ink
 *   - a page with NO overlays AND NO ink → null (panel falls back to the plain
 *     source raster, so an unedited thumbnail is byte-identical to today)
 *
 * jsdom cannot rasterize pdf.js or composite a canvas, so this is a real-Chrome test.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { InkLayer } from '../../src/infra/inkLayer';
import { TextElement } from '../../src/elements/textElement';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const PAGE_ID = 'pg1';

interface Source { doc: pdfjsLib.PDFDocumentProxy; bytes: Uint8Array }

async function blankWhiteSource(): Promise<Source> {
  // A pure-white source page — any non-white pixel in the thumbnail must come
  // from a composited overlay/ink, never from the source. The pdf.js doc and the
  // stored bytes are built from the SAME PDF (the compositor re-loads from bytes
  // via @cantoo/pdf-lib, exactly as downloadPageAsImage does in production).
  const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 400]);
  page.drawRectangle({ x: 0, y: 0, width: 300, height: 400, color: rgb(1, 1, 1) });
  const bytes = await pdf.save();
  // pdf.js transfers the buffer it parses, so hand it a copy and keep `bytes` intact.
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  return { doc, bytes };
}

function buildSvc(src: Source, elements: PDFElement[], inkLayer: InkLayer): ExportService {
  const ctx = {
    documentModel: {
      pages: [{ id: PAGE_ID, sourcePdfId: 's1', sourcePageNum: 1 }],
      sourcePdfs: new Map([['s1', { doc: src.doc, bytes: src.bytes }]]),
      pageCount: 1,
      watermark: { enabled: false },
      bates: { enabled: false },
    },
    elements,
    inkLayer,
    currentFilename: 'doc.pdf',
    reportError: { info() {}, warn() {}, error() {}, silent() {} },
    progress: { begin: () => ({ done() {}, failed() {}, update() {} }) },
  } as unknown as IExportContext;
  return new ExportService(ctx);
}

/** Decode a JPEG/PNG data URL and return whether any pixel is meaningfully non-white. */
async function hasNonWhitePixels(dataUrl: string): Promise<boolean> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('thumbnail image failed to decode'));
    img.src = dataUrl;
  });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const cx = c.getContext('2d');
  if (!cx) throw new Error('canvas 2D context unavailable');
  cx.drawImage(img, 0, 0);
  const { data } = cx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < data.length; i += 4) {
    // JPEG is lossy; treat clearly-darker-than-white as ink.
    if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) return true;
  }
  return false;
}

describe('G17 — thumbnails composite overlays + ink', () => {
  it('returns null for a page with no overlays and no ink (identical-to-today fallback)', async () => {
    const svc = buildSvc(await blankWhiteSource(), [], new InkLayer());
    const url = await svc.renderThumbnailWithOverlays(0);
    expect(url).toBeNull();
  });

  it('composites a text overlay into the thumbnail (white source → non-white thumb)', async () => {
    const text = new TextElement(20, 20, PAGE_ID, { color: '#000000', fontSize: 40, width: 200, height: 60 });
    text.text = 'HELLO';
    const svc = buildSvc(await blankWhiteSource(), [text], new InkLayer());
    const url = await svc.renderThumbnailWithOverlays(0);
    expect(url).toBeTruthy();
    const dataUrl = url ?? '';
    expect(dataUrl.startsWith('data:image/')).toBe(true);
    expect(await hasNonWhitePixels(dataUrl)).toBe(true);
  });

  it('composites an ink stroke into the thumbnail', async () => {
    const ink = new InkLayer();
    ink.addStroke(PAGE_ID, {
      type: 'ink',
      color: '#ff0000',
      width: 8,
      points: [{ x: 30, y: 30 }, { x: 270, y: 370 }],
    });
    const svc = buildSvc(await blankWhiteSource(), [], ink);
    const url = await svc.renderThumbnailWithOverlays(0);
    expect(url).toBeTruthy();
    expect(await hasNonWhitePixels(url ?? '')).toBe(true);
  });
});
