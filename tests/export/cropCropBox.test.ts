import { describe, it, expect } from 'vitest';
import { PDFDocument, rgb, degrees, StandardFonts } from '@cantoo/pdf-lib';
import { buildPageOverlays, type BuildPageCtx } from '../../src/export/exportPipeline';
import type { DocumentPage, WatermarkSettings } from '../../src/core/documentModel';

const NO_WATERMARK: WatermarkSettings = {
  enabled: false, text: '', opacity: 0, angle: 0, color: '#000000', fontSize: 10,
};
const NO_INK = { getStrokes: () => [] } as unknown as BuildPageCtx['inkLayer'];
const SILENT = { warn() {}, silent() {}, info() {}, error() {} } as unknown as BuildPageCtx['reportError'];

async function buildPage(crop: DocumentPage['crop'], userRot = 0) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 800]);
  const docPage: DocumentPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, ...(crop ? { crop } : {}), ...(userRot ? { rotation: userRot } : {}) };
  await buildPageOverlays({
    pdfDoc, page, docPage, elements: [],
    pdfLib: { rgb, degrees, StandardFonts },
    userRot, sourceRot: 0,
    watermark: NO_WATERMARK, inkLayer: NO_INK, reportError: SILENT,
  } satisfies BuildPageCtx);
  return page;
}

describe('buildPageOverlays — crop → setCropBox', () => {
  it('sets the page CropBox from a content-space crop (y-flip)', async () => {
    const page = await buildPage({ x: 50, y: 100, width: 400, height: 500 });
    const cb = page.getCropBox();
    expect(cb.x).toBeCloseTo(50);
    expect(cb.y).toBeCloseTo(200); // 800 - (100 + 500)
    expect(cb.width).toBeCloseTo(400);
    expect(cb.height).toBeCloseTo(500);
  });

  it('leaves the CropBox at the MediaBox when there is no crop (byte-identical path)', async () => {
    const page = await buildPage(undefined);
    const cb = page.getCropBox();
    expect(cb.x).toBeCloseTo(0);
    expect(cb.y).toBeCloseTo(0);
    expect(cb.width).toBeCloseTo(600);
    expect(cb.height).toBeCloseTo(800);
  });

  it('applies crop AND rotation together (cropbox is unrotated user space)', async () => {
    const page = await buildPage({ x: 50, y: 100, width: 400, height: 500 }, 90);
    const cb = page.getCropBox();
    expect(cb.x).toBeCloseTo(50);
    expect(cb.y).toBeCloseTo(200);
    expect(cb.width).toBeCloseTo(400);
    expect(cb.height).toBeCloseTo(500);
    expect(page.getRotation().angle).toBe(90);
  });
});
