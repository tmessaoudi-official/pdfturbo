/**
 * Task 2 — export bake: background fill, editable lineHeight, opacity.
 * Real-Chrome test: builds a minimal PDF with a TextElement carrying the new props,
 * runs renderElementToPdfLib, rasterizes with real pdf.js, and asserts pixel regions.
 *
 * Reuses the same renderOne/rasterize pattern from pdfElementRenderer.browser.test.ts.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, StandardFonts, degrees } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { renderElementToPdfLib, type PdfRenderCtx } from '../../src/export/pdfElementRenderer';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W = 400;
const H = 400;
const SCALE = 2;

async function renderOne(element: PDFElement): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([W, H]);
  const ctx: PdfRenderCtx = {
    pdfDoc, page,
    libs: { rgb, StandardFonts, degrees },
    h: H, w: W, W_orig: W, H_orig: H,
    totalRot: 0, cropOriginX: 0, cropOriginY: 0,
  };
  await renderElementToPdfLib(element, ctx);
  return pdfDoc.save();
}

interface Img { data: Uint8ClampedArray; width: number; height: number; }

async function rasterize(bytes: Uint8Array): Promise<Img> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const c = canvas.getContext('2d', { willReadFrequently: true });
  if (!c) throw new Error('no 2d context');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: c, viewport: vp }).promise;
  return c.getImageData(0, 0, canvas.width, canvas.height);
}

function px(img: Img, x: number, y: number): { r: number; g: number; b: number } {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] };
}

/** Mean darkness (0=white, 1=black) across all pixels */
function meanDarkness(img: Img): number {
  let sum = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    sum += (255 - img.data[i]) + (255 - img.data[i + 1]) + (255 - img.data[i + 2]);
  }
  return sum / (img.data.length / 4 * 3 * 255);
}

/**
 * Find the canvas-y of the darkest row in the range [yMin, yMax].
 * Used to locate the baseline of a rendered text line.
 */
function darkestRowY(img: Img, xLeft: number, xRight: number, yMin: number, yMax: number): number {
  let bestY = yMin;
  let bestDark = 0;
  for (let y = yMin; y <= yMax; y++) {
    let rowDark = 0;
    for (let x = xLeft; x <= xRight; x++) {
      const i = (y * img.width + x) * 4;
      rowDark += (255 - img.data[i]) + (255 - img.data[i + 1]) + (255 - img.data[i + 2]);
    }
    if (rowDark > bestDark) { bestDark = rowDark; bestY = y; }
  }
  return bestY;
}

const el = <T extends object>(o: T): PDFElement => o as unknown as PDFElement;

describe('text toolbar bake (Task 2)', () => {
  it('draws a background fill behind text', async () => {
    // Element at (50, 50) in display/editor space (y-down, top-left origin).
    // tp(te.x, te.y + height) = tp(50, 110) → with totalRot=0: {x:50, y: H-110} = {x:50, y:290}
    // drawRectangle at {x:50, y:290, width:240, height:60} → PDF box x∈[50,290], y∈[290,350]
    // canvas y = (H - pdfY) * scale:
    //   PDF y=350 → canvas y=(400-350)*2=100  (top of box in canvas)
    //   PDF y=290 → canvas y=(400-290)*2=220  (bottom of box in canvas)
    //   canvas x left = 50*2=100, canvas x right = 290*2=580
    // Sample inside the box at right side below glyphs (glyphs start near canvas y~100).
    const bytes = await renderOne(el({
      type: 'text', x: 50, y: 50, width: 240, height: 60,
      text: 'BG', fontSize: 18,
      fontFamily: 'Arial', bold: false, italic: false, rotation: 0,
      color: '#000000', backgroundColor: '#ff0000',
    }));
    const img = await rasterize(bytes);
    // Right side of box, near bottom — glyph-free zone.
    const inside = px(img, 500, 210);
    expect(inside.r).toBeGreaterThan(150); // R high  — red background
    expect(inside.g).toBeLessThan(120);    // G low
  });

  it('honors reduced opacity (text not fully opaque black)', async () => {
    const opaqueBytes = await renderOne(el({
      type: 'text', x: 50, y: 150, width: 200, height: 40,
      text: 'O', fontSize: 36,
      fontFamily: 'Arial', bold: false, italic: false, rotation: 0,
      color: '#000000', opacity: 1,
    }));
    const fadedBytes = await renderOne(el({
      type: 'text', x: 50, y: 150, width: 200, height: 40,
      text: 'O', fontSize: 36,
      fontFamily: 'Arial', bold: false, italic: false, rotation: 0,
      color: '#000000', opacity: 0.3,
    }));
    const opaque = await rasterize(opaqueBytes);
    const faded = await rasterize(fadedBytes);
    // A faded element should be brighter (less dark) than the fully opaque one.
    expect(meanDarkness(faded)).toBeLessThan(meanDarkness(opaque));
  });

  it('increases vertical gap between lines with larger lineHeight', async () => {
    // Two lines 'a\nb'. With lineHeight 1.0 the lines are close; with 2.5 they spread apart.
    // Element at y=40, fontSize=20, page H=400.
    // Line 2 baseY (display/y-down):
    //   tight (1.0):  40 + 20*0.9 + 1*20*1.0 = 78  → PDF y = 400-78=322 → canvas y=(400-322)*2=156
    //   loose (2.5):  40 + 20*0.9 + 1*20*2.5 = 108 → PDF y = 400-108=292 → canvas y=(400-292)*2=216
    // We scan canvas y∈[140, 250] for the darkest row (the second glyph baseline).
    const tightBytes = await renderOne(el({
      type: 'text', x: 40, y: 40, width: 200, height: 180,
      text: 'a\nb', fontSize: 20,
      fontFamily: 'Arial', bold: false, italic: false, rotation: 0,
      color: '#000000', lineHeight: 1.0,
    }));
    const looseBytes = await renderOne(el({
      type: 'text', x: 40, y: 40, width: 200, height: 180,
      text: 'a\nb', fontSize: 20,
      fontFamily: 'Arial', bold: false, italic: false, rotation: 0,
      color: '#000000', lineHeight: 2.5,
    }));
    const tight = await rasterize(tightBytes);
    const loose = await rasterize(looseBytes);
    // With lineHeight 2.5, the second baseline is lower in PDF → higher canvas-y.
    const tightY = darkestRowY(tight, 80, 200, 140, 250);
    const looseY = darkestRowY(loose, 80, 200, 140, 250);
    expect(looseY).toBeGreaterThan(tightY + 5);
  });
});
