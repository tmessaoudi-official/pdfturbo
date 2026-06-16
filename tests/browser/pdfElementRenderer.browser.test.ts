/**
 * M1 #13 — closes the lone P0: the export-time element renderer
 * (`renderElementToPdfLib`, src/export/pdfElementRenderer.ts) had ZERO direct tests.
 *
 * Strategy: render one element onto a blank pdf-lib page, save, rasterize with the
 * REAL pdf.js, and assert pixel regions. At totalRot=0 the element-space rect (x,y,
 * w,h) maps directly to the canvas rect (x·scale, y·scale, w·scale, h·scale) because
 * transformPoint(px,py,W,H,0) = {x:px, y:H-py} and pdf.js maps PDF (X,Y_up) →
 * canvas (X·s, (H-Y)·s), so the H cancels. This needs a real browser (canvas +
 * pdf.js rasterization) — jsdom can't.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, StandardFonts, degrees } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { renderElementToPdfLib, type PdfRenderCtx } from '../../src/export/pdfElementRenderer';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W = 200;
const H = 200;
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

/** Centroid of pixels matching `pred`, in canvas space (or null when none). */
function centroid(img: Img, pred: (r: number, g: number, b: number) => boolean): { x: number; y: number; n: number } {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (pred(img.data[i], img.data[i + 1], img.data[i + 2])) { sx += x; sy += y; n++; }
    }
  }
  return n ? { x: sx / n, y: sy / n, n } : { x: 0, y: 0, n: 0 };
}

const el = <T extends object>(o: T): PDFElement => o as unknown as PDFElement;

describe('renderElementToPdfLib — pixel-region export (M1 #13, closes the P0)', () => {
  it('redaction draws an opaque black rectangle in its bbox', async () => {
    // bbox element-space (50,50)-(150,90) → canvas (100,100)-(300,180) at scale 2.
    const bytes = await renderOne(el({ type: 'redaction', x: 50, y: 50, width: 100, height: 40, color: '#000000', rotation: 0 }));
    const img = await rasterize(bytes);
    const inside = px(img, 200, 140); // center of the rect
    expect(inside.r).toBeLessThan(25);
    expect(inside.g).toBeLessThan(25);
    expect(inside.b).toBeLessThan(25);
    const outside = px(img, 20, 20); // far corner, untouched
    expect(outside.r).toBeGreaterThan(240);
    expect(outside.g).toBeGreaterThan(240);
    expect(outside.b).toBeGreaterThan(240);
  });

  it('highlight tints its bbox with the right hue (yellow) and stays translucent', async () => {
    const bytes = await renderOne(el({ type: 'highlight', x: 50, y: 50, width: 100, height: 40, color: '#ffff00', opacity: 0.4, rotation: 0 }));
    const img = await rasterize(bytes);
    const inside = px(img, 200, 140);
    // Yellow over white at α≈0.4: r,g stay high, b drops well below 255.
    expect(inside.r).toBeGreaterThan(220);
    expect(inside.g).toBeGreaterThan(220);
    expect(inside.b).toBeLessThan(210);
    expect(inside.g - inside.b).toBeGreaterThan(30); // chromatic, yellow
    const outside = px(img, 20, 20);
    expect(outside.b).toBeGreaterThan(240); // untinted elsewhere
  });

  it('image draws inside its bbox (and not outside it)', async () => {
    // A solid red 20×20 PNG.
    const c = document.createElement('canvas');
    c.width = c.height = 20;
    const cc = c.getContext('2d');
    if (!cc) throw new Error('no 2d context');
    cc.fillStyle = '#ff0000';
    cc.fillRect(0, 0, 20, 20);
    const src = c.toDataURL('image/png');

    const bytes = await renderOne(el({ type: 'image', x: 60, y: 60, width: 80, height: 80, src, rotation: 0 }));
    const img = await rasterize(bytes);
    const inside = px(img, 200, 200); // center of (60,60,80,80) → canvas (200,200)
    expect(inside.r).toBeGreaterThan(180);
    expect(inside.g).toBeLessThan(110);
    expect(inside.b).toBeLessThan(110);
    const outside = px(img, 20, 20);
    expect(outside.r).toBeGreaterThan(240);
    expect(outside.g).toBeGreaterThan(240);
  });

  it('routes an Arabic text element through the shaped RTL overlay (real ink, right-aligned)', async () => {
    // The 'text' branch sends isArabicText() lines to drawArabicLine (drawText
    // can't place shaped glyphs RTL). Render an Arabic text element end-to-end and
    // confirm it paints visible ink that sits in the right half of its box (RTL).
    const bytes = await renderOne(el({
      type: 'text', x: 20, y: 80, width: 150, height: 30, text: 'مرحبا',
      fontFamily: 'Arial', fontSize: 24, color: '#000000', bold: false, italic: false, rotation: 0,
    }));
    const img = await rasterize(bytes);
    const ink = centroid(img, (r, g, b) => r < 128 && g < 128 && b < 128);
    expect(ink.n).toBeGreaterThan(50); // visible shaped ink, not a tofu/blank box
    // The text box is element (20,80)..(170,?) → canvas x 40..340 at scale 2; its
    // mid-x is 180. RTL right-alignment puts the centroid past the middle.
    expect(ink.x).toBeGreaterThan(180);
  });

  it('rotates a filled shape around its center (rotation anchor)', async () => {
    // Same 100×40 rect centered at element (100,100); render at 0° and 90°.
    const base = { type: 'shape', shapeType: 'rect', x: 50, y: 80, width: 100, height: 40, strokeColor: '#ff0000', strokeWidth: 0, fillColor: '#ff0000' };
    const isRed = (r: number, g: number, b: number) => r > 150 && g < 110 && b < 110;

    const c0 = centroid(await rasterize(await renderOne(el({ ...base, rotation: 0 }))), isRed);
    const c90 = centroid(await rasterize(await renderOne(el({ ...base, rotation: 90 }))), isRed);

    expect(c0.n).toBeGreaterThan(500);
    expect(c90.n).toBeGreaterThan(500);
    // Both centroids sit at the element center (100,100)·scale = (200,200): rotation
    // is about the center, not a corner. Tolerance covers antialiasing.
    expect(Math.abs(c0.x - 200)).toBeLessThan(12);
    expect(Math.abs(c0.y - 200)).toBeLessThan(12);
    expect(Math.abs(c90.x - c0.x)).toBeLessThan(12);
    expect(Math.abs(c90.y - c0.y)).toBeLessThan(12);
  });
});
