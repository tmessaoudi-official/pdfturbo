/**
 * QA-2026-06-23 P1 — redaction burn must NOT be misplaced on a CROPPED page (data leak).
 *
 * Bug (verified by source read, exportPipeline.ts:220-351): when a page has a crop,
 * `buildPageOverlays` sets the CropBox before pdf.js renders, so the offscreen canvas is the
 * CROPPED window (origin = crop's top-left). But the redaction `fillRect` draws at
 * `el.x*SCALE`/`el.y*SCALE` — FULL-page display coords. A non-zero crop offset therefore
 * shifts the burn off its target and the underlying "secret" inside the crop window is exposed.
 *
 * Fix (render-full-then-clip): render the UNcropped page, draw the burn at full-page coords
 * (the already-correct uncropped path), then clip the canvas to the crop window last — so burn
 * and content share one coordinate space and the burn can never drift off the secret.
 *
 * Method: paint a GREEN "secret" band, place a BLACK redaction exactly over it, apply a crop
 * with a non-zero offset (20,100) that still contains the band, run the real rasterizer, render
 * the (cropped) output with pdf.js, and sample the band's location IN CROP-WINDOW space:
 *   - must be BLACK (burned). Pre-fix it is GREEN (the misplaced burn missed it → leak).
 * jsdom cannot run getViewport/render — hence a real-browser pixel test.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { rasterizePageWithRedactions } from '../../src/export/exportPipeline';
import { RedactionElement } from '../../src/elements/redactionElement';
import { InkLayer } from '../../src/infra/inkLayer';
import type { DocumentPage, WatermarkSettings } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W_ORIG = 200;
const H_ORIG = 400;
const SCALE = 2; // must match exportPipeline's rasterize scale

// GREEN "secret" band + BLACK redaction, same rect, in EDITOR full-page space (top-left origin).
const SECRET = { x: 60, y: 160, w: 80, h: 40 };
// pdf-lib content space (bottom-left): contentY = H - editorY - height.
const BAND = { x: SECRET.x, y: H_ORIG - SECRET.y - SECRET.h, w: SECRET.w, h: SECRET.h };
// Crop with a NON-ZERO offset that still fully contains SECRET (content space, top-left, y-down).
const CROP = { x: 20, y: 100, width: 160, height: 250 };

const noopReporter: IErrorReporter = {
  info() {}, warn() {}, error() {}, silent() {},
} as unknown as IErrorReporter;

const noWatermark: WatermarkSettings = {
  enabled: false, text: '', opacity: 0, angle: 0, color: '#000000', fontSize: 10,
};

async function buildBandPdf(): Promise<import('@cantoo/pdf-lib').PDFDocument> {
  const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([W_ORIG, H_ORIG]);
  page.drawRectangle({ x: 0, y: 0, width: W_ORIG, height: H_ORIG, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: BAND.x, y: BAND.y, width: BAND.w, height: BAND.h, color: rgb(0, 1, 0) });
  return doc;
}

/** Sample a point given in the OUTPUT page's display space (top-left), averaged over 3×3. */
async function samplePoint(
  targetDoc: import('@cantoo/pdf-lib').PDFDocument,
  outX: number,
  outY: number,
): Promise<{ r: number; g: number; b: number; w: number; h: number }> {
  const bytes = await targetDoc.save({ useObjectStreams: false });
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const p = await pdf.getPage(1);
  const vp = p.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  await p.render({ canvas, viewport: vp }).promise;
  const px = Math.round(outX * SCALE);
  const py = Math.round(outY * SCALE);
  const img = ctx.getImageData(px - 1, py - 1, 3, 3).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < img.length; i += 4) { r += img[i]; g += img[i + 1]; b += img[i + 2]; }
  const n = img.length / 4;
  return { r: r / n, g: g / n, b: b / n, w: vp.width / SCALE, h: vp.height / SCALE };
}

async function rasterize(docPage: DocumentPage): Promise<import('@cantoo/pdf-lib').PDFDocument> {
  const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
  const src = await buildBandPdf();
  const target = await PDFDocument.create();
  const redaction = new RedactionElement(SECRET.x, SECRET.y, SECRET.w, SECRET.h, docPage.id, '#000000') as unknown as PDFElement;
  await rasterizePageWithRedactions(
    src, docPage, [redaction], target,
    { rgb, StandardFonts, degrees },
    noWatermark, new InkLayer(), noopReporter,
  );
  return target;
}

describe('QA-2026-06-23 P1 — redaction burn on a cropped page', () => {
  it('cropped (non-zero offset): the secret IS burned in the crop window (no leak)', async () => {
    const docPage: DocumentPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0, crop: { ...CROP } };
    const target = await rasterize(docPage);

    // Output page must be the crop window, not the full page.
    // Secret center in crop-window display space: (SECRET center) - (crop top-left).
    const cx = SECRET.x + SECRET.w / 2 - CROP.x; // 60+40-20 = 80
    const cy = SECRET.y + SECRET.h / 2 - CROP.y; // 160+20-100 = 80
    const s = await samplePoint(target, cx, cy);

    expect(Math.round(s.w)).toBe(CROP.width);   // crop actually applied
    expect(Math.round(s.h)).toBe(CROP.height);
    // The secret must be BURNED (black), not exposed (green).
    expect(s.r).toBeLessThan(50);
    expect(s.g).toBeLessThan(50); // pre-fix this is ~255 (green leak)
    expect(s.b).toBeLessThan(50);
  });

  it('no crop (regression): the secret is still burned on the full page', async () => {
    const docPage: DocumentPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 };
    const target = await rasterize(docPage);
    const s = await samplePoint(target, SECRET.x + SECRET.w / 2, SECRET.y + SECRET.h / 2);
    expect(Math.round(s.w)).toBe(W_ORIG); // full page
    expect(s.r).toBeLessThan(50);
    expect(s.g).toBeLessThan(50);
    expect(s.b).toBeLessThan(50);
  });
});
