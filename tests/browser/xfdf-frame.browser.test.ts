/**
 * Limits row 26 (D18) — XFDF coordinates on a page the viewer shows TURNED or CROPPED.
 *
 * The oracle assumes no frame. Coloured squares are drawn into the PDF at KNOWN user-space rects; pdf.js renders
 * the page the way the editor does (the page's own /Rotate plus the user's rotation, CropBox honoured), and the
 * squares' PIXEL boxes are where a user would draw. An element placed on those pixels must export to the known
 * user rect, and an imported record at the known rect must land on the pixels. The arrow's two ends are
 * different colours, so a mapping that kept the box but swapped the direction fails too.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { pointViewport } from '../../src/utils/pointViewport';
import { elementToXfdfAnnot, xfdfAnnotToElements, xfdfPageFrame } from '../../src/export/xfdfMapping';
import { HighlightElement } from '../../src/elements/highlightElement';
import { ShapeElement } from '../../src/elements/shapeElement';
import type { DocumentPage } from '../../src/core/documentModel';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const S = 2;
const GREEN: [number, number, number, number] = [120, 150, 170, 175]; // user rect, non-square
// The arrow runs from bottom-RIGHT to top-LEFT in user space, so its endpoints are NOT the min/max corners of its
// box: a mapping that went through the box would return [80,100,260,220] and fail.
const RED_AT: [number, number] = [260, 100];  // arrow start
const BLUE_AT: [number, number] = [80, 220];  // arrow end

interface Case { name: string; rotate: number; userRot: number; crop?: [number, number, number, number] }
const CASES: Case[] = [
  { name: '/Rotate 0', rotate: 0, userRot: 0 },
  { name: '/Rotate 90', rotate: 90, userRot: 0 },
  { name: '/Rotate 180', rotate: 180, userRot: 0 },
  { name: '/Rotate 270', rotate: 270, userRot: 0 },
  { name: '/Rotate 90 + user rotation 90', rotate: 90, userRot: 90 },
  { name: 'CropBox origin (30,40), /Rotate 0', rotate: 0, userRot: 0, crop: [30, 40, 330, 280] },
  { name: 'CropBox origin (30,40), /Rotate 270 + user rotation 90', rotate: 270, userRot: 90, crop: [30, 40, 330, 280] },
];

async function buildPdf(c: Case): Promise<Uint8Array> {
  const { PDFDocument, rgb, degrees } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  if (c.crop) page.setCropBox(c.crop[0], c.crop[1], c.crop[2] - c.crop[0], c.crop[3] - c.crop[1]);
  page.setRotation(degrees(c.rotate));
  page.drawRectangle({ x: GREEN[0], y: GREEN[1], width: GREEN[2] - GREEN[0], height: GREEN[3] - GREEN[1], color: rgb(0, 1, 0) });
  page.drawRectangle({ x: RED_AT[0] - 4, y: RED_AT[1] - 4, width: 8, height: 8, color: rgb(1, 0, 0) });
  page.drawRectangle({ x: BLUE_AT[0] - 4, y: BLUE_AT[1] - 4, width: 8, height: 8, color: rgb(0, 0, 1) });
  return doc.save();
}

/** Pixel box (in DISPLAY points, i.e. / S) of every pixel `match` accepts. */
function box(ctx: CanvasRenderingContext2D, w: number, h: number, match: (r: number, g: number, b: number) => boolean) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (match(d[i], d[i + 1], d[i + 2])) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  }
  if (!Number.isFinite(x0)) throw new Error('colour not found on the render');
  return { x: x0 / S, y: y0 / S, w: (x1 - x0) / S, h: (y1 - y0) / S };
}
const isGreen = (r: number, g: number, b: number) => g > 200 && r < 60 && b < 60;
const isRed = (r: number, g: number, b: number) => r > 200 && g < 60 && b < 60;
const isBlue = (r: number, g: number, b: number) => b > 200 && r < 60 && g < 60;

async function setUp(c: Case) {
  const pdf = await pdfjsLib.getDocument({ data: await buildPdf(c) }).promise;
  const page = await pdf.getPage(1);
  const totalRot = (c.rotate + c.userRot) % 360;
  const vp = pointViewport(page, { scale: S, rotation: totalRot });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport: vp }).promise;
  const docPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: c.userRot } as unknown as DocumentPage;
  const frame = await xfdfPageFrame(docPage, new Map([['s1', { doc: pdf }]]) as never);
  const at = (m: typeof isGreen) => box(ctx, canvas.width, canvas.height, m);
  return { frame, green: at(isGreen), red: at(isRed), blue: at(isBlue) };
}

const TOL = 1; // one point: anti-aliased edges at scale 2
const near = (got: readonly number[], want: readonly number[]) =>
  got.forEach((v, i) => expect(Math.abs(v - want[i]), `coord ${i}: got ${v}, want ${want[i]}`).toBeLessThanOrEqual(TOL));

describe('XFDF on a turned or cropped page — pixels are the oracle (row 26, D18)', () => {
  for (const c of CASES) {
    it(`${c.name}: a highlight drawn over the square exports to the square's user rect, and back onto it`, async () => {
      const { frame, green } = await setUp(c);
      const hl = new HighlightElement(green.x, green.y, green.w, green.h, 'p1', '#FFFF00', 0.4);
      const a = elementToXfdfAnnot(hl.toJSON(), 0, frame);
      if (!a) throw new Error('no annotation');
      near(a.rect, GREEN);
      const [back] = xfdfAnnotToElements({ type: 'square', page: 0, rect: GREEN }, 'p1', frame);
      near([back.x, back.y, back.width, back.height], [green.x, green.y, green.w, green.h]);
    });

    it(`${c.name}: an arrow from red to blue exports from red to blue (direction kept)`, async () => {
      const { frame, red, blue } = await setUp(c);
      const rx = red.x + red.w / 2, ry = red.y + red.h / 2, bx = blue.x + blue.w / 2, by = blue.y + blue.h / 2;
      const arrow = new ShapeElement('arrow', Math.min(rx, bx), Math.min(ry, by), Math.abs(bx - rx), Math.abs(by - ry), 'p1',
        { strokeColor: '#000000', strokeWidth: 1, x1: rx, y1: ry, x2: bx, y2: by });
      const a = elementToXfdfAnnot(arrow.toJSON(), 0, frame);
      near(a?.line ?? [], [...RED_AT, ...BLUE_AT]);
    });
  }
});
