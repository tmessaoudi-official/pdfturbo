/**
 * A3 (real Chrome) — OCR "visible" words land where the editor shows the word, on a page the USER
 * rotated too.
 *
 * The OCR canvas is rendered at the page's INTRINSIC `/Rotate` with no user rotation, while elements
 * live in display space at `/Rotate + docPage.rotation`. The word placement used to be a plain
 * `bbox / scale`, which is right only when the user rotation is 0: after rotating a sideways scan
 * upright — the normal thing to do before OCR — every word landed off the text it came from.
 *
 * Only the ENGINE is mocked, and the mock reads the canvas it is actually handed: it finds the red
 * rectangle drawn in the page content and reports that as the word's bbox, so the canvas geometry is
 * the real one. The oracle is independent of the handler's mapping: the same page rendered by pdf.js
 * at the editor's DISPLAY rotation, where the red rectangle's box is simply measured. The element's
 * turned footprint must equal that box, and its exported text must read along the turned axis.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { page as browserPage } from 'vitest/browser';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { OcrHandler, ocrWordToTextElement } from '../../src/handlers/ocrHandler';
import { setTesseractLoader, type TesseractLike } from '../../src/ocr/ocrEngine';
import { HistoryManager } from '../../src/core/historyManager';
import { buildPageOverlays } from '../../src/export/exportPipeline';
import { rotatedElementFootprint } from '../../src/utils/geometry';
import { _rotateInElementSpace } from '../../src/export/pdfElementRenderer';
import { InkLayer } from '../../src/infra/inkLayer';
import type { WatermarkSettings } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';
import type { TextElement } from '../../src/elements/textElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

// Non-square page and a non-square target, so a swapped axis or a missing turn cannot cancel out.
const W = 300, H = 200;
// PDF user space (y-up). A real engine reports a word horizontal on the canvas it reads, and that
// canvas is rendered at the INTRINSIC /Rotate — so on a /Rotate 90 source the target is drawn tall in
// user space, which is wide on the canvas. Both stay inside the crop window used below.
const RED_BY_INTRINSIC: Record<number, { x: number; y: number; w: number; h: number }> = {
  0: { x: 60, y: 120, w: 80, h: 30 },
  90: { x: 120, y: 40, w: 30, h: 80 },
};
const noWM: WatermarkSettings = { enabled: false, text: '', opacity: 0, angle: 0, color: '#000', fontSize: 10 };
const rep = { info() {}, warn() {}, error() {}, silent() {} } as unknown as IErrorReporter;

type Box = { x0: number; y0: number; x1: number; y1: number };

function redBox(data: Uint8ClampedArray, width: number, height: number): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

let lastBbox: Box | null = null;

/** Engine stand-in: the one "word" is wherever the red rectangle is on the canvas it receives. */
const canvasReadingTesseract: TesseractLike = {
  createWorker: () => Promise.resolve({
    recognize: (image: unknown) => {
      const c = image as HTMLCanvasElement;
      const cx = c.getContext('2d') as CanvasRenderingContext2D;
      const bbox = redBox(cx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
      lastBbox = bbox;
      const words = bbox ? [{ text: 'WORD', bbox, confidence: 95 }] : [];
      return Promise.resolve({ data: { text: 'WORD', confidence: 95, blocks: [{ paragraphs: [{ lines: [{ words }] }] }] } });
    },
    terminate: () => Promise.resolve(undefined),
  }),
} as unknown as TesseractLike;

async function sourceBytes(intrinsic: number, crop: boolean): Promise<Uint8Array> {
  const { PDFDocument, rgb, degrees } = await import('@cantoo/pdf-lib');
  const pdf = await PDFDocument.create();
  const p = pdf.addPage([W, H]);
  p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  const r = RED_BY_INTRINSIC[intrinsic];
  p.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: rgb(1, 0, 0) });
  if (intrinsic) p.setRotation(degrees(intrinsic));
  // An asymmetric CropBox origin: element coords are relative to it, pdf.js's to absolute space.
  if (crop) p.setCropBox(20, 15, W - 30, H - 25);
  return pdf.save();
}

/** The red rectangle's box in DISPLAY points, as the editor shows the page. */
async function displayRedBox(bytes: Uint8Array, userRot: number): Promise<Box> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const pg = await doc.getPage(1);
  const s = 2;
  const vp = pg.getViewport({ scale: s, rotation: ((pg.rotate + userRot) % 360 + 360) % 360 });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const cx = c.getContext('2d') as CanvasRenderingContext2D;
  await pg.render({ canvas: c, viewport: vp }).promise;
  const b = redBox(cx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  if (!b) throw new Error('the red target did not render — the case would be vacuous');
  return { x0: b.x0 / s, y0: b.y0 / s, x1: b.x1 / s, y1: b.y1 / s };
}

/** Export one element onto the page and render it as the viewer shows it (display rotation). */
async function exportAndRender(bytes: Uint8Array, userRot: number, el: TextElement): Promise<HTMLCanvasElement> {
  const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
  const src = await PDFDocument.load(bytes);
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(src, [0]);
  out.addPage(page);
  await buildPageOverlays({
    pdfDoc: out, page, docPage: { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: userRot },
    elements: [el as unknown as PDFElement], pdfLib: { rgb, StandardFonts, degrees },
    userRot, sourceRot: page.getRotation().angle, watermark: noWM, inkLayer: new InkLayer(), reportError: rep,
  });
  const doc = await pdfjsLib.getDocument({ data: await out.save() }).promise;
  const pg = await doc.getPage(1);
  const vp = pg.getViewport({ scale: 2 });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  c.style.width = `${vp.width / 2}px`;
  await pg.render({ canvas: c, viewport: vp }).promise;
  return c;
}

async function ocrOnce(bytes: Uint8Array, userRot: number): Promise<TextElement> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const elements: PDFElement[] = [];
  const app = {
    elements, historyManager: new HistoryManager(50, () => {}), reportError: rep,
    documentModel: {
      currentPage: { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: userRot },
      sourcePdfs: new Map([['s1', { doc, bytes }]]),
    },
    rebuildElementLayer() {}, autosave() {},
  };
  const n = await new OcrHandler(app as never).run('eng', 'visible');
  expect(n).toBe(1);
  return elements[0] as unknown as TextElement;
}

const CASES = [0, 90].flatMap(intrinsic => [0, 90, 180, 270].map(userRot => ({ intrinsic, userRot, crop: false })))
  .concat([{ intrinsic: 90, userRot: 90, crop: true }, { intrinsic: 0, userRot: 270, crop: true }]);

describe('A3 — OCR "visible" words on a user-rotated page', () => {
  let restore: (() => Promise<TesseractLike>) | undefined;
  afterEach(() => { if (restore) setTesseractLoader(restore); restore = undefined; });

  it.each(CASES)('intrinsic /Rotate $intrinsic, user $userRot, crop origin $crop', async ({ intrinsic, userRot, crop }) => {
    restore = setTesseractLoader(() => Promise.resolve(canvasReadingTesseract));
    const bytes = await sourceBytes(intrinsic, crop);
    const want = await displayRedBox(bytes, userRot);
    const el = await ocrOnce(bytes, userRot);
    // The TRUE turned box: the four corners about the box centre, the editor's CSS convention.
    // (`rotatedElementFootprint` is the grow-only leak-filter union, so it cannot EQUAL this at 90/270;
    // it is asserted to CONTAIN the displayed word instead.)
    const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
    const corners = [[el.x, el.y], [el.x + el.width, el.y], [el.x, el.y + el.height], [el.x + el.width, el.y + el.height]]
      .map(([px, py]) => _rotateInElementSpace(px, py, cx, cy, el.rotation ?? 0));
    const got = {
      x0: Math.min(...corners.map(c => c.x)), y0: Math.min(...corners.map(c => c.y)),
      x1: Math.max(...corners.map(c => c.x)), y1: Math.max(...corners.map(c => c.y)),
    };
    for (const k of ['x0', 'y0', 'x1', 'y1'] as const) {
      expect(Math.abs(got[k] - want[k]), `${k}: element footprint ${got[k].toFixed(1)} vs displayed word ${want[k].toFixed(1)}`).toBeLessThan(1.5);
    }
    expect((((el.rotation ?? 0) % 360) + 360) % 360).toBe(userRot);
    const f = rotatedElementFootprint(el);
    expect(f.x).toBeLessThanOrEqual(want.x0 + 1.5);
    expect(f.y).toBeLessThanOrEqual(want.y0 + 1.5);
    expect(f.x + f.width).toBeGreaterThanOrEqual(want.x1 - 1.5);
    expect(f.y + f.height).toBeGreaterThanOrEqual(want.y1 - 1.5);

    // Export half: the word's text exports inside the displayed word and reads along the turned axis.
    const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
    const src = await PDFDocument.load(bytes);
    const out = await PDFDocument.create();
    const [page] = await out.copyPages(src, [0]);
    out.addPage(page);
    await buildPageOverlays({
      pdfDoc: out, page, docPage: { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: userRot },
      elements: [el as unknown as PDFElement], pdfLib: { rgb, StandardFonts, degrees },
      userRot, sourceRot: page.getRotation().angle, watermark: noWM, inkLayer: new InkLayer(), reportError: rep,
    });
    const doc = await pdfjsLib.getDocument({ data: await out.save() }).promise;
    const pg = await doc.getPage(1);
    const vp = pg.getViewport({ scale: 1 });
    const item = (await pg.getTextContent()).items.find(i => 'str' in i && i.str === 'WORD');
    if (!item || !('transform' in item)) throw new Error('the exported page carries no WORD text');
    const m = pdfjsLib.Util.transform(vp.transform, item.transform) as number[];
    const len = Math.hypot(m[0], m[1]), t = userRot * Math.PI / 180;
    expect(m[0] / len * Math.cos(t) + m[1] / len * Math.sin(t)).toBeGreaterThan(0.999);
    expect(m[4]).toBeGreaterThanOrEqual(want.x0 - 1.5);
    expect(m[4]).toBeLessThanOrEqual(want.x1 + 1.5);
    expect(m[5]).toBeGreaterThanOrEqual(want.y0 - 1.5);
    expect(m[5]).toBeLessThanOrEqual(want.y1 + 1.5);
  });

  // Visual record (non-asserting): the source page with the exported OCR word on top, as a viewer shows
  // it, for the pre-A3 placement (the same function at user rotation 0 — the old formula) and the fix.
  it.each(['before', 'after'] as const)('visual record — intrinsic 0, user 90 (%s)', async (which) => {
    restore = setTesseractLoader(() => Promise.resolve(canvasReadingTesseract));
    const bytes = await sourceBytes(0, false);
    const fixed = await ocrOnce(bytes, 90);
    const el = which === 'after' ? fixed
      : ocrWordToTextElement({ text: 'WORD', bbox: lastBbox as Box }, 2, 'p1');
    const c = await exportAndRender(bytes, 90, el);
    document.body.appendChild(c);
    await browserPage.screenshot({ path: `../../var/claude/qa-shots/a3/${which}-ocr-user90.png`, element: c });
    c.remove();
  });
});
