/**
 * Rotated-page overlay placement (2026-06-24) — a rect-shaped overlay must export at the SAME
 * displayed position the editor shows it, on rotated pages too.
 *
 * Pre-existing bug: the rect renderers anchored at a single mapped corner
 * (`tp(x, y+height)`) + swapped dims. At rot=0 correct, but under a 90°/270° page rotation that
 * corner maps to the WRONG side, shifting the rect by its own width/height (verified: a marker at
 * displayed (40,60) landed at (39,83) @90 and (15,59) @270). Fix: anchor at the content-space AABB
 * of the 4 displayed corners (`rectAnchor`) — byte-identical at rot=0, correct when rotated.
 * jsdom cannot run getViewport/render — hence a real-browser pixel test.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { buildPageOverlays } from '../../src/export/exportPipeline';
import { ShapeElement } from '../../src/elements/shapeElement';
import { InkLayer } from '../../src/infra/inkLayer';
import type { WatermarkSettings } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;
const W = 200, H = 400, SCALE = 2;
const MARK = { x: 40, y: 60, w: 24, h: 24 }; // displayed (top-left origin) — where the editor shows it
const noWM: WatermarkSettings = { enabled: false, text: '', opacity: 0, angle: 0, color: '#000', fontSize: 10 };
const rep = { info() {}, warn() {}, error() {}, silent() {} } as unknown as IErrorReporter;

async function markerDisplayedTopLeft(rot: number): Promise<{ x: number; y: number; found: boolean }> {
  const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
  const out = await PDFDocument.create();
  const src = await PDFDocument.create();
  const sp = src.addPage([W, H]); sp.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  const [page] = await out.copyPages(src, [0]); out.addPage(page);
  const marker = new ShapeElement('rect', MARK.x, MARK.y, MARK.w, MARK.h, 'p1',
    { strokeColor: '#00cc00', fillColor: '#00cc00', strokeWidth: 2 }) as unknown as PDFElement;
  await buildPageOverlays({
    pdfDoc: out, page, docPage: { id: 'p1', sourcePdfId: 's', sourcePageNum: 1, rotation: rot },
    elements: [marker], pdfLib: { rgb, StandardFonts, degrees },
    userRot: rot, sourceRot: 0, watermark: noWM, inkLayer: new InkLayer(), reportError: rep,
  });
  const bytes = await out.save({ useObjectStreams: false });
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise; const pg = await pdf.getPage(1);
  const vp = pg.getViewport({ scale: SCALE }); const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const cx = c.getContext('2d') as CanvasRenderingContext2D; await pg.render({ canvas: c, viewport: vp }).promise;
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  let minX = 1e9, minY = 1e9, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 90 && d[i + 1] > 150 && d[i + 2] < 90) {
      const px = (i / 4) % c.width, py = Math.floor((i / 4) / c.width);
      minX = Math.min(minX, px); minY = Math.min(minY, py); n++;
    }
  }
  return { x: minX / SCALE, y: minY / SCALE, found: n > 0 };
}

describe('rotated-page overlay placement', () => {
  it.each([0, 90, 180, 270])('a rect overlay at displayed (40,60) exports at (40,60) on a %i° page', async (rot) => {
    const got = await markerDisplayedTopLeft(rot);
    expect(got.found).toBe(true);
    expect(Math.abs(got.x - MARK.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(got.y - MARK.y)).toBeLessThanOrEqual(3);
  });
});
