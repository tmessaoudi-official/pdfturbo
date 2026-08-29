/**
 * REDACTION LEAK — a SOURCE ANNOTATION under a redaction was painted OVER the burn.
 *
 * `rasterizePageWithRedactions` writes the burn into the page CONTENT STREAM (via
 * `buildPageOverlays` → `renderRedaction`) and then rasterizes with pdf.js. But pdf.js
 * renders annotations AFTER the content stream, so any source annotation carrying an
 * appearance stream — a FreeText note, a stamp, an un-flattened form widget holding a
 * value — is repainted ON TOP of the opaque burn and baked into the exported pixels.
 * The "redacted" content is then plainly VISIBLE in the export, not merely extractable.
 *
 * This refutes CLAUDE.md #62b ("the redaction-rasterize path + PNG export already cover
 * that nuclear case") — measured, not argued: before the fix the covered annotation's
 * centre samples RED (255,0,0) through an opaque black burn.
 *
 * Fix: drop source annotations whose /Rect intersects a redaction BEFORE rasterizing —
 * drop-whole, the same over-approximating direction the image channel already uses.
 *
 * The CONTROL annotation is the load-bearing half of this guard: it sits clear of every
 * redaction and MUST still render. Without it, `annotationMode: DISABLE` would satisfy
 * the leak assertion while silently deleting every annotation on a redacted page.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { rasterizePageWithRedactions } from '../../src/export/exportPipeline';
import { RedactionElement } from '../../src/elements/redactionElement';
import { InkLayer } from '../../src/infra/inkLayer';
import { contentRectToDisplay } from '../../src/utils/geometry';
import type { DocumentPage, WatermarkSettings } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W_ORIG = 200;
const H_ORIG = 400;
const SCALE = 2; // must match exportPipeline's rasterize scale

// Editor display space (top-left, y-down).
const COVERED = { x: 40, y: 60, w: 100, h: 60 };   // annotation to be redacted
const CONTROL = { x: 40, y: 250, w: 100, h: 60 };  // annotation that must SURVIVE
const REDACT = { x: 30, y: 50, w: 120, h: 80 };    // burn, fully containing COVERED

/** Editor rect (y-down) → PDF /Rect (y-up, absolute). */
const toPdfRect = (r: { x: number; y: number; w: number; h: number }): number[] =>
  [r.x, H_ORIG - r.y - r.h, r.x + r.w, H_ORIG - r.y];

const noopReporter: IErrorReporter = {
  info() {}, warn() {}, error() {}, silent() {},
} as unknown as IErrorReporter;

const noWatermark: WatermarkSettings = {
  enabled: false, text: '', opacity: 0, angle: 0, color: '#000000', fontSize: 10,
};

/**
 * A white page carrying two FreeText annotations, each with a normal appearance stream
 * painting a solid colour over its whole BBox: RED under the redaction, GREEN clear of it.
 */
async function buildAnnotatedPdf(): Promise<import('@cantoo/pdf-lib').PDFDocument> {
  const { PDFDocument, PDFName, PDFArray, PDFNumber, PDFString, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([W_ORIG, H_ORIG]);
  page.drawRectangle({ x: 0, y: 0, width: W_ORIG, height: H_ORIG, color: rgb(1, 1, 1) });
  const ctx = doc.context;

  const mkAnnot = (
    rect: { x: number; y: number; w: number; h: number },
    fill: string,
    contents: string,
  ) => {
    const ap = ctx.stream(`${fill} rg 0 0 ${rect.w} ${rect.h} re f`, {
      Type: PDFName.of('XObject'),
      Subtype: PDFName.of('Form'),
      BBox: ctx.obj([0, 0, rect.w, rect.h]),
      Resources: ctx.obj({}),
    });
    return ctx.register(ctx.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('FreeText'),
      Rect: ctx.obj(toPdfRect(rect)),
      F: PDFNumber.of(4), // Print
      Contents: PDFString.of(contents),
      DA: PDFString.of('/Helv 12 Tf 0 g'),
      AP: ctx.obj({ N: ctx.register(ap) }),
    }));
  };

  const arr = PDFArray.withContext(ctx);
  arr.push(mkAnnot(COVERED, '1 0 0', 'SECRETANNOT'));
  arr.push(mkAnnot(CONTROL, '0 1 0', 'PUBLICANNOT'));
  page.node.set(PDFName.of('Annots'), arr);
  return doc;
}

/** Sample a point in the OUTPUT page's display space (top-left), averaged over 3×3. */
async function samplePoint(
  targetDoc: import('@cantoo/pdf-lib').PDFDocument,
  outX: number,
  outY: number,
): Promise<{ r: number; g: number; b: number }> {
  const bytes = await targetDoc.save({ useObjectStreams: false });
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const p = await pdf.getPage(1);
  const vp = p.getViewport({ scale: SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const c2d = canvas.getContext('2d') as CanvasRenderingContext2D;
  await p.render({ canvas, viewport: vp }).promise;
  const img = c2d.getImageData(Math.round(outX * SCALE) - 1, Math.round(outY * SCALE) - 1, 3, 3).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < img.length; i += 4) { r += img[i]; g += img[i + 1]; b += img[i + 2]; }
  const n = img.length / 4;
  return { r: r / n, g: g / n, b: b / n };
}

async function rasterize(): Promise<import('@cantoo/pdf-lib').PDFDocument> {
  const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
  const docPage: DocumentPage = { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 };
  const src = await buildAnnotatedPdf();
  const target = await PDFDocument.create();
  const redaction = new RedactionElement(
    REDACT.x, REDACT.y, REDACT.w, REDACT.h, docPage.id, '#000000',
  ) as unknown as PDFElement;
  await rasterizePageWithRedactions(
    src, docPage, [redaction], target,
    { rgb, StandardFonts, degrees },
    noWatermark, new InkLayer(), noopReporter,
  );
  return target;
}

/**
 * The same promise, pinned across FRAMES on this path too.
 *
 * The shipped guard below runs only at rotation 0 with no crop. That is exactly the blind spot
 * that let a mis-framing ship on the sibling path (`_applyOverlaysToPage`) and go unnoticed —
 * so the rasterizer gets the same frame coverage rather than being trusted because it happened
 * to be written correctly. Asserts no RED pixel anywhere, so no coordinate arithmetic of the
 * test's own can mask a leak.
 */
describe('redaction burn vs SOURCE annotations — every frame (rasterize path)', () => {
  async function redCountAfterRasterize(
    opts: { rotation?: number; crop?: { x: number; y: number; width: number; height: number } },
  ): Promise<{ red: number; green: number }> {
    const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
    const rot = ((opts.rotation ?? 0) % 360 + 360) % 360;
    const docPage: DocumentPage = {
      id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: rot,
      ...(opts.crop ? { crop: opts.crop } : {}),
    };
    const src = await buildAnnotatedPdf();
    const target = await PDFDocument.create();
    // Element coords are DISPLAY space, so the rect must be re-derived per rotation or the burn
    // genuinely moves off the annotation and the test asserts a leak that is not one.
    const d = contentRectToDisplay(
      { x: COVERED.x, y: COVERED.y, width: COVERED.w, height: COVERED.h }, W_ORIG, H_ORIG, rot,
    );
    const M = 10;
    const redaction = new RedactionElement(
      d.x - M, d.y - M, d.width + 2 * M, d.height + 2 * M, docPage.id, '#000000',
    ) as unknown as PDFElement;
    await rasterizePageWithRedactions(
      src, docPage, [redaction], target,
      { rgb, StandardFonts, degrees }, noWatermark, new InkLayer(), noopReporter,
    );
    const bytes = await target.save({ useObjectStreams: false });
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const p = await pdf.getPage(1);
    const vp = p.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const c2d = canvas.getContext('2d') as CanvasRenderingContext2D;
    await p.render({ canvas, viewport: vp }).promise;
    const data = c2d.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0, green = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 150 && g < 110 && b < 110) red++;
      if (g > 150 && r < 110 && b < 110) green++;
    }
    return { red, green };
  }

  // Each case asserts BOTH directions. Without the green control an over-reach passes: making the
  // strip delete /Annots wholesale satisfied every red assertion here while destroying every
  // annotation on the page — the exact failure mode CLAUDE.md records for annotationMode:DISABLE.
  for (const rotation of [0, 90, 180, 270]) {
    it(`rotation ${rotation}: covered ink burned, uncovered ink kept`, async () => {
      const { red, green } = await redCountAfterRasterize({ rotation });
      expect(red).toBe(0);
      expect(green).toBeGreaterThan(500);
    }, 60_000);
  }

  it('with a crop: covered ink burned, uncovered ink kept', async () => {
    const { red, green } = await redCountAfterRasterize({ crop: { x: 10, y: 20, width: 180, height: 340 } });
    expect(red).toBe(0);
    expect(green).toBeGreaterThan(500);
  }, 60_000);
});

describe('redaction burn vs SOURCE annotations (rasterize path)', () => {
  it('an annotation under a redaction is BURNED, not repainted over it', async () => {
    const target = await rasterize();
    const s = await samplePoint(target, COVERED.x + COVERED.w / 2, COVERED.y + COVERED.h / 2);
    // Pre-fix this samples RED (255,0,0) — the annotation painted over the burn.
    expect(s.r).toBeLessThan(50);
    expect(s.g).toBeLessThan(50);
    expect(s.b).toBeLessThan(50);
  });

  it('CONTROL: an annotation clear of every redaction still renders', async () => {
    const target = await rasterize();
    const s = await samplePoint(target, CONTROL.x + CONTROL.w / 2, CONTROL.y + CONTROL.h / 2);
    // Fails if the fix disables annotations wholesale instead of dropping covered ones.
    expect(s.g).toBeGreaterThan(200);
    expect(s.r).toBeLessThan(100);
  });

  it('CONTROL: the burn itself is opaque where no annotation sits', async () => {
    const target = await rasterize();
    // Inside REDACT but outside COVERED (REDACT.y 50 → COVERED.y 60).
    const s = await samplePoint(target, REDACT.x + 5, REDACT.y + 3);
    expect(s.r).toBeLessThan(50);
    expect(s.g).toBeLessThan(50);
    expect(s.b).toBeLessThan(50);
  });
});
