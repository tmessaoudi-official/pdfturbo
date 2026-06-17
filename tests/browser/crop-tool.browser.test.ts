/**
 * Crop tool (#G23) — real-Chrome proof that a user crop flows through the export
 * pipeline into a PDF whose CropBox pdf.js actually honours when rendering.
 *
 * jsdom proves the cropbox is SET (cropCropBox.test.ts) but cannot rasterize. This
 * test renders the assembled bytes with the real pdf.js worker and asserts (a) the
 * rendered viewport shrinks to the crop dims, (b) rotation composes with the crop,
 * and (c) the pixels kept are the cropped region (the rest is clipped away).
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, degrees, StandardFonts } from '@cantoo/pdf-lib';
import { buildPageOverlays, type BuildPageCtx } from '../../src/export/exportPipeline';
import type { DocumentPage, WatermarkSettings } from '../../src/core/documentModel';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const NO_WM: WatermarkSettings = { enabled: false, text: '', opacity: 0, angle: 0, color: '#000000', fontSize: 10 };
const NO_INK = { getStrokes: () => [] } as unknown as BuildPageCtx['inkLayer'];
const SILENT = { warn() {}, silent() {}, info() {}, error() {} } as unknown as BuildPageCtx['reportError'];

async function buildCropped(
  crop: DocumentPage['crop'],
  draw?: (page: import('@cantoo/pdf-lib').PDFPage) => void,
  userRot = 0,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([400, 400]);
  draw?.(page);
  const docPage: DocumentPage = {
    id: 'p1', sourcePdfId: 's1', sourcePageNum: 1,
    ...(crop ? { crop } : {}), ...(userRot ? { rotation: userRot } : {}),
  };
  await buildPageOverlays({
    pdfDoc, page, docPage, elements: [],
    pdfLib: { rgb, degrees, StandardFonts },
    userRot, sourceRot: 0, watermark: NO_WM, inkLayer: NO_INK, reportError: SILENT,
  } satisfies BuildPageCtx);
  return pdfDoc.save();
}

async function renderCenter(bytes: Uint8Array): Promise<{ w: number; h: number; px: [number, number, number] }> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport: vp }).promise;
  const d = ctx.getImageData(Math.floor(vp.width / 2), Math.floor(vp.height / 2), 1, 1).data;
  return { w: vp.width, h: vp.height, px: [d[0], d[1], d[2]] };
}

describe('crop tool — pdf.js honours the exported CropBox', () => {
  it('renders only the cropped region (viewport shrinks to crop dims)', async () => {
    const bytes = await buildCropped({ x: 50, y: 100, width: 300, height: 200 });
    const { w, h } = await renderCenter(bytes);
    expect(w).toBeCloseTo(300, 0);
    expect(h).toBeCloseTo(200, 0);
  });

  it('composes crop with a 90° rotation (rendered dims swap)', async () => {
    const bytes = await buildCropped({ x: 50, y: 100, width: 300, height: 200 }, undefined, 90);
    const { w, h } = await renderCenter(bytes);
    // CropBox is 300×200 in user space; rotation 90 swaps the displayed viewport.
    expect(w).toBeCloseTo(200, 0);
    expect(h).toBeCloseTo(300, 0);
  });

  it('keeps the correct half — crop-left shows the blue fill, crop-right shows white', async () => {
    const drawBlueLeft = (page: import('@cantoo/pdf-lib').PDFPage): void => {
      page.drawRectangle({ x: 0, y: 0, width: 200, height: 400, color: rgb(0, 0, 1) });
    };
    const left = await renderCenter(await buildCropped({ x: 0, y: 0, width: 200, height: 400 }, drawBlueLeft));
    const right = await renderCenter(await buildCropped({ x: 200, y: 0, width: 200, height: 400 }, drawBlueLeft));
    // Left crop keeps the blue half; right crop keeps the white half.
    expect(left.px[2]).toBeGreaterThan(150); // blue channel high
    expect(left.px[0]).toBeLessThan(120);    // red channel low
    expect(right.px[0]).toBeGreaterThan(200);
    expect(right.px[1]).toBeGreaterThan(200);
    expect(right.px[2]).toBeGreaterThan(200); // white
  });
});
