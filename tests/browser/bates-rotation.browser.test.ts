/**
 * Bates stamp lands at the chosen VISUAL corner on a /Rotate'd page
 * (2026-06-23 QA Theme-4).
 *
 * drawBatesOnPage computed the corner in UNROTATED content dims and drew without
 * mapping, so on a rotated page the "bottom-right" stamp landed in the wrong
 * visual corner. The fix computes the corner in the rotated (visual) frame and
 * maps it through transformPoint — the same mechanism the element renderer uses.
 *
 * pdf.js getViewport honours /Rotate, so sampling the rendered canvas gives the
 * VISUAL (final) page. jsdom can't render — hence a real-Chrome pixel test.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { rasterizePageWithRedactions } from '../../src/export/exportPipeline';
import { InkLayer } from '../../src/infra/inkLayer';
import type { DocumentPage, WatermarkSettings } from '../../src/core/documentModel';
import type { BatesSettings } from '../../src/export/batesStamp';
import type { IErrorReporter } from '../../src/core/errorReporter';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W_ORIG = 200;
const H_ORIG = 400;
const SCALE = 2;

const noopReporter = { info() {}, warn() {}, error() {}, silent() {} } as unknown as IErrorReporter;
const noWatermark: WatermarkSettings = { enabled: false, text: '', opacity: 0, angle: 0, color: '#000000', fontSize: 10 };

const bates: BatesSettings = {
  enabled: true, mode: 'bates', prefix: 'X', startNumber: 1, digits: 1,
  position: 'br', fontSize: 40, color: '#000000',
};

async function whitePdf(): Promise<import('@cantoo/pdf-lib').PDFDocument> {
  const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([W_ORIG, H_ORIG]);
  page.drawRectangle({ x: 0, y: 0, width: W_ORIG, height: H_ORIG, color: rgb(1, 1, 1) });
  return doc;
}

/** Render the final (rotated) page and count black pixels in each quadrant. */
async function quadrantInk(rotation: number): Promise<{ w: number; h: number; tl: number; tr: number; bl: number; br: number }> {
  const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
  const docPage: DocumentPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation };
  const target = await PDFDocument.create();
  await rasterizePageWithRedactions(
    await whitePdf(), docPage, [], target,
    { rgb, StandardFonts, degrees }, noWatermark, new InkLayer(), noopReporter,
    bates, 1, 1,
  );
  const pdf = await pdfjsLib.getDocument({ data: await target.save({ useObjectStreams: false }) }).promise;
  const p = await pdf.getPage(1);
  const vp = p.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const cx = canvas.getContext('2d') as CanvasRenderingContext2D;
  await p.render({ canvas, viewport: vp }).promise;
  const W = canvas.width, H = canvas.height;
  const d = cx.getImageData(0, 0, W, H).data;
  const q = { w: W, h: H, tl: 0, tr: 0, bl: 0, br: 0 };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80) {
        const right = x > W / 2, bottom = y > H / 2;
        if (right && bottom) q.br++;
        else if (right) q.tr++;
        else if (bottom) q.bl++;
        else q.tl++;
      }
    }
  }
  return q;
}

describe('Bates stamp — visual-corner anchoring on rotated pages', () => {
  it("places a 'br' stamp in the visual bottom-right at rotation 0", async () => {
    const q = await quadrantInk(0);
    expect(q.br).toBeGreaterThan(50);
    expect(q.br).toBeGreaterThan(q.tl + q.tr + q.bl); // dominant corner
  });

  it("keeps a 'br' stamp in the visual bottom-right at rotation 90", async () => {
    const q = await quadrantInk(90);
    expect(q.br).toBeGreaterThan(50);
    expect(q.br).toBeGreaterThan(q.tl + q.tr + q.bl);
  });

  it("keeps a 'br' stamp in the visual bottom-right at rotation 270", async () => {
    const q = await quadrantInk(270);
    expect(q.br).toBeGreaterThan(50);
    expect(q.br).toBeGreaterThan(q.tl + q.tr + q.bl);
  });
});
