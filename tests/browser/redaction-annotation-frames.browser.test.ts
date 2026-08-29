/**
 * The annotation strip must work on the IMAGE-EXPORT / THUMBNAIL path too — at every rotation
 * and with a crop.
 *
 * `stripRedactedAnnotations` is called from two places. `rasterizePageWithRedactions` captures
 * the page's rotation BEFORE `buildPageOverlays` and passes `skipCropBox: true`, so its frame is
 * pristine. `_applyOverlaysToPage` did neither: it read `page.getRotation()` and
 * `getPageCropBox(page)` AFTER the call, and `buildPageOverlays` MUTATES both —
 * `page.setRotation(totalRot)` (exportPipeline.ts:232) and `page.setCropBox(effBox)` (:294).
 *
 * The result was a doubled rotation (`srcRot + 2·userRot`) and a narrowed crop box, so on any
 * rotated or cropped page the covered annotation was NOT stripped and pdf.js repainted it over
 * the burn — the very leak the strip exists to close, still live on `downloadPageAsImage` and
 * `renderThumbnailWithOverlays`, which are the only two callers where the strip has work to do
 * (every other caller routes a redaction-bearing page to the rasterizer instead).
 *
 * The previous guards ran at `rotation: 0` with no crop and so could not see it — the same
 * "a rotation bug shipped inside a rotation fix" shape CLAUDE.md already records for the
 * 2026-08-05 round.
 *
 * METHOD: assert no RED pixel survives ANYWHERE in the output, rather than sampling a computed
 * point. The covered annotation is the only red thing on the page, so this is rotation- and
 * crop-agnostic — no coordinate arithmetic of mine can accidentally mask the leak. The GREEN
 * control annotation must still be present, which is what stops a wholesale
 * `annotationMode: DISABLE` from passing.
 */
import { describe, it, expect } from 'vitest';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { RedactionElement } from '../../src/elements/redactionElement';
import { contentRectToDisplay } from '../../src/utils/geometry';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W = 300, H = 600;
const COVERED = { x: 120, y: 200, w: 100, h: 60 };  // red — under the burn
const CONTROL = { x: 120, y: 400, w: 100, h: 60 };  // green — must survive
/**
 * Contains BOTH annotations, and its ORIGIN (100,150) is deliberately large.
 *
 * A first version used a (10,20) origin and PASSED against the unfixed code: a 10pt shift still
 * left the mis-framed redaction overlapping the annotation, so the case proved nothing. Sized so
 * that reading the NARROWED box instead of the source box moves the redaction clear —
 * with the narrowed frame the redaction lands at x 210..330 / y-down 190..270 while the
 * annotation sits at y-down 50..110, i.e. disjoint.
 */
const CROP = { x: 100, y: 150, width: 180, height: 380 };

const toPdfRect = (r: { x: number; y: number; w: number; h: number }): number[] =>
  [r.x, H - r.y - r.h, r.x + r.w, H - r.y];

async function buildAnnotatedPdfBytes(): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFArray, PDFNumber, PDFString, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  const ctx = doc.context;
  const mk = (r: { x: number; y: number; w: number; h: number }, fill: string, tag: string) => {
    const ap = ctx.stream(`${fill} rg 0 0 ${r.w} ${r.h} re f`, {
      Type: PDFName.of('XObject'), Subtype: PDFName.of('Form'),
      BBox: ctx.obj([0, 0, r.w, r.h]), Resources: ctx.obj({}),
    });
    return ctx.register(ctx.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('FreeText'),
      Rect: ctx.obj(toPdfRect(r)), F: PDFNumber.of(4),
      Contents: PDFString.of(tag), DA: PDFString.of('/Helv 12 Tf 0 g'),
      AP: ctx.obj({ N: ctx.register(ap) }),
    }));
  };
  const arr = PDFArray.withContext(ctx);
  arr.push(mk(COVERED, '1 0 0', 'SECRETANNOT'));
  arr.push(mk(CONTROL, '0 1 0', 'PUBLICANNOT'));
  page.node.set(PDFName.of('Annots'), arr);
  return doc.save({ useObjectStreams: false });
}

/** Count strongly-red and strongly-green pixels in a data URL (JPEG, so tolerances are wide). */
async function countColours(dataUrl: string): Promise<{ red: number; green: number }> {
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('thumbnail image failed to load'));
    img.src = dataUrl;
  });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const cx = c.getContext('2d') as CanvasRenderingContext2D;
  cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  let red = 0, green = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 150 && g < 110 && b < 110) red++;
    if (g > 150 && r < 110 && b < 110) green++;
  }
  return { red, green };
}

async function thumbnailFor(
  opts: { rotation?: number; crop?: { x: number; y: number; width: number; height: number } },
): Promise<{ red: number; green: number }> {
  const bytes = await buildAnnotatedPdfBytes();
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const docPage = {
    id: 'p1', sourcePdfId: 's1', sourcePageNum: 1,
    rotation: opts.rotation ?? 0, ...(opts.crop ? { crop: opts.crop } : {}),
  };
  // A redaction element's coordinates are DISPLAY space — i.e. relative to the page as the user
  // currently sees it. Holding them fixed while rotating the page would move the burn off the
  // annotation for real, so the test would be asserting a leak that is not one. Derive the rect
  // per rotation from the annotation's content-space box instead, inflated by a margin, which is
  // what "the user drew a box over this annotation" actually means at that rotation.
  const rot = ((opts.rotation ?? 0) % 360 + 360) % 360;
  const d = contentRectToDisplay(
    { x: COVERED.x, y: COVERED.y, width: COVERED.w, height: COVERED.h }, W, H, rot,
  );
  const M = 10;
  const redaction = new RedactionElement(
    d.x - M, d.y - M, d.width + 2 * M, d.height + 2 * M, 'p1', '#000000',
  );
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  const ctx = {
    documentModel: {
      pageCount: 1, currentPageIndex: 0, pages: [docPage],
      sourcePdfs: new Map([['s1', { bytes, doc }]]),
      watermark: { enabled: false }, bates: { enabled: false },
    },
    elements: [redaction],
    formValues: {}, currentFilename: 'x.pdf', exportPassword: null,
    inkLayer: { getStrokes: () => [] },
    reportError: { info() {}, warn() {}, error() {} },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {}, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
  } as unknown as IExportContext;

  // Scale 2 so the annotations cover enough pixels for the colour counts to be unambiguous.
  const url = await new ExportService(ctx).renderThumbnailWithOverlays(0, 2);
  expect(url).toBeTruthy();
  return countColours(url as string);
}

describe('annotation strip on the thumbnail / image-export path', () => {
  it('rotation 0, no crop (regression): red burned, green kept', async () => {
    const { red, green } = await thumbnailFor({});
    expect(red).toBe(0);
    expect(green).toBeGreaterThan(500);
  }, 60_000);

  for (const rotation of [90, 180, 270]) {
    it(`rotation ${rotation}: the covered annotation is still burned`, async () => {
      // Pre-fix the strip is handed srcRot + 2*userRot, so at 90/270 it tests a region rotated
      // 180 away from the truth, keeps the annotation, and pdf.js repaints it over the burn.
      const { red, green } = await thumbnailFor({ rotation });
      expect(red).toBe(0);
      expect(green).toBeGreaterThan(500);
    }, 60_000);
  }

  it('with a crop: the covered annotation is still burned', async () => {
    // Pre-fix getPageCropBox is read after setCropBox narrowed it, so the redaction maps into
    // the wrong frame and the annotation survives.
    const { red, green } = await thumbnailFor({ crop: { ...CROP } });
    expect(red).toBe(0);
    expect(green).toBeGreaterThan(500);
  }, 60_000);

  it('crop AND rotation together', async () => {
    const { red } = await thumbnailFor({ rotation: 90, crop: { ...CROP } });
    expect(red).toBe(0);
  }, 60_000);
});
