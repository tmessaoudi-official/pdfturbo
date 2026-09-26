/**
 * B1 (real Chrome) — the export's page frame must be the page VIEW pdf.js shows.
 *
 * Every editor coordinate is measured against pdf.js's view: a valid, non-empty /CropBox intersected
 * with the /MediaBox, else the /MediaBox, else US Letter (`pdf.worker.mjs:59242-59276`, 6.3.289).
 * `getPageCropBox` used to return pdf-lib's RAW /CropBox, and a (0,0)-origin box when pdf-lib threw on
 * a malformed one. Measured before the fix, each of these four shapes passes the source loader and then
 * leaves a redacted secret VISIBLE in the exported raster:
 *
 *   - a malformed /CropBox on a MediaBox whose origin is (50,50): the burn lands 50pt off;
 *   - a /CropBox extending past the MediaBox: the burn shifts and the page grows to the raw box;
 *   - a /CropBox that does not meet the MediaBox: the page is cut to the raw box and no burn shows;
 *   - a zero-area /CropBox: a blank 612x792 page (content lost rather than leaked).
 *
 * The parity half compares the function with pdf.js ITSELF rather than with a copy of its rule, so a
 * future pdf.js that changes the rule reds here instead of silently disagreeing. The leak half drives
 * the real rasterizer and demands positive evidence: the secret's band covered in ink, not merely the
 * text unextractable (rasterisation alone satisfies that). The page is NON-SQUARE and the MediaBox
 * origin asymmetric-free but non-zero, and one case is rotated, because a square or unrotated fixture
 * cannot see a width/height swap.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { rasterizePageWithRedactions, getPageCropBox } from '../../src/export/exportPipeline';
import { RedactionElement } from '../../src/elements/redactionElement';
import { InkLayer } from '../../src/infra/inkLayer';
import { loadPdfDocument } from '../../src/utils/pdfLoadGuard';
import { contentRectToDisplay } from '../../src/utils/geometry';
import type { DocumentPage, WatermarkSettings } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const SECRET = 'CONFIDENTIAL-CASE-4417';
/** Content space (y-down from the VIEW's top-left): the secret's baseline sits 62pt below the top. */
const COVER = { x: 30, y: 40, width: 260, height: 30 };

const failLoud = {
  info() {},
  silent(_e?: unknown, msg?: string) { throw new Error(`export reported: ${msg}`); },
  warn(key: string) { throw new Error(`export warned: ${key}`); },
  error(key: string, err?: unknown) { throw new Error(`export errored: ${key} ${String(err)}`); },
} as unknown as IErrorReporter;
const noWatermark: WatermarkSettings = { enabled: false, text: '', opacity: 0, angle: 0, color: '#000000', fontSize: 10 };

interface Shape { media?: unknown; crop?: unknown; parentCrop?: unknown; rotate?: number }

/**
 * One page carrying `SECRET` 62pt below the top of the box pdf.js will show (`view`), 32pt from its left.
 */
async function build(s: Shape, view: [number, number, number, number]): Promise<Uint8Array> {
  const { PDFDocument, PDFName, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  if (s.media !== undefined) page.node.set(PDFName.of('MediaBox'), ctx.obj(s.media as number[]));
  if (s.crop !== undefined) page.node.set(PDFName.of('CropBox'), ctx.obj(s.crop as number[]));
  if (s.parentCrop !== undefined) {
    (page.node.lookup(PDFName.of('Parent')) as import('@cantoo/pdf-lib').PDFDict)
      .set(PDFName.of('CropBox'), ctx.obj(s.parentCrop as number[]));
  }
  if (s.rotate) page.node.set(PDFName.of('Rotate'), ctx.obj(s.rotate));
  page.drawText(SECRET, { x: view[0] + 32, y: view[3] - 62, size: 12, font });
  return doc.save({ useObjectStreams: false });
}

async function pdfjsView(bytes: Uint8Array): Promise<number[]> {
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  return Array.from((await pdf.getPage(1)).getViewport({ scale: 1, rotation: 0 }).viewBox);
}

const PARITY: Array<[string, Shape, [number, number, number, number]]> = [
  ['no /CropBox, MediaBox origin (50,60)', { media: [50, 60, 450, 360] }, [50, 60, 450, 360]],
  ['/CropBox inside the MediaBox', { media: [0, 0, 400, 300], crop: [30, 70, 330, 290] }, [30, 70, 330, 290]],
  ['/CropBox past the MediaBox', { media: [0, 0, 400, 300], crop: [-40, -30, 440, 330] }, [0, 0, 400, 300]],
  ['/CropBox partly past the MediaBox', { media: [0, 0, 400, 300], crop: [100, 50, 500, 250] }, [100, 50, 400, 250]],
  ['malformed /CropBox, MediaBox origin (50,50)', { media: [50, 50, 450, 350], crop: [0, 0, 400] }, [50, 50, 450, 350]],
  ['zero-area /CropBox', { media: [0, 0, 400, 300], crop: [100, 100, 100, 100] }, [0, 0, 400, 300]],
  ['disjoint /CropBox', { media: [0, 0, 400, 300], crop: [500, 500, 700, 700] }, [0, 0, 400, 300]],
  ['/CropBox touching the MediaBox edge', { media: [0, 0, 400, 300], crop: [400, 0, 500, 300] }, [0, 0, 400, 300]],
  ['reversed corners', { media: [400, 300, 0, 0], crop: [330, 290, 30, 70] }, [30, 70, 330, 290]],
  ['inherited /CropBox', { media: [0, 0, 400, 300], parentCrop: [30, 70, 330, 290] }, [30, 70, 330, 290]],
  ['invalid nearest /CropBox over a valid inherited one', { media: [0, 0, 400, 300], crop: [1, 2], parentCrop: [30, 70, 330, 290] }, [0, 0, 400, 300]],
  ['malformed /MediaBox', { media: [0, 0, 400] }, [0, 0, 612, 792]],
];

describe('B1 — getPageCropBox equals the view pdf.js shows', () => {
  for (const [name, shape, view] of PARITY) {
    it(name, async () => {
      const bytes = await build(shape, view);
      const shown = await pdfjsView(bytes);
      // The fixture is what it claims: pdf.js really shows `view` for this shape.
      expect(shown).toEqual(view);
      const lib = await loadPdfDocument(bytes, { viewerCheck: false, updateMetadata: false });
      const cb = getPageCropBox(lib.getPage(0));
      expect([cb.x, cb.y, cb.x + cb.width, cb.y + cb.height]).toEqual(shown);
    });
  }
});

/** Average darkness (0 white … 255 black) of a 6x6 patch, and the page size, as real pdf.js renders it. */
async function renderAt(bytes: Uint8Array, px: number, py: number): Promise<{ dark: number; size: number[] }> {
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const pg = await pdf.getPage(1);
  const vp = pg.getViewport({ scale: 1 });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const cx = c.getContext('2d') as CanvasRenderingContext2D;
  await pg.render({ canvas: c, canvasContext: cx, viewport: vp } as never).promise;
  const d = cx.getImageData(px - 3, py - 3, 6, 6).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
  return { dark: 255 - s / (d.length / 4), size: [vp.width, vp.height] };
}

async function allText(bytes: Uint8Array): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  return ((await (await pdf.getPage(1)).getTextContent()).items as Array<{ str?: string }>).map(t => t.str ?? '').join('');
}

const LEAKS: Array<[string, Shape, [number, number, number, number]]> = [
  ['CONTROL — ordinary page', { media: [0, 0, 400, 300] }, [0, 0, 400, 300]],
  ['malformed /CropBox, MediaBox origin (50,50)', { media: [50, 50, 450, 350], crop: [0, 0, 400] }, [50, 50, 450, 350]],
  ['/CropBox past the MediaBox', { media: [0, 0, 400, 300], crop: [-40, -30, 440, 330] }, [0, 0, 400, 300]],
  ['disjoint /CropBox', { media: [0, 0, 400, 300], crop: [500, 500, 700, 700] }, [0, 0, 400, 300]],
  ['zero-area /CropBox', { media: [0, 0, 400, 300], crop: [100, 100, 100, 100] }, [0, 0, 400, 300]],
  ['malformed /CropBox, MediaBox origin (50,50), /Rotate 90', { media: [50, 50, 450, 350], crop: [0, 0, 400], rotate: 90 }, [50, 50, 450, 350]],
];

describe('B1 — a redaction burns ON the secret whatever the page boxes say', () => {
  for (const [name, shape, view] of LEAKS) {
    it(name, async () => {
      const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
      const bytes = await build(shape, view);
      // Reachable in the product: the source loader accepts every one of these files.
      const src = await loadPdfDocument(bytes, { viewerCheck: 'source', updateMetadata: false });
      const rot = shape.rotate ?? 0;
      const W = view[2] - view[0], H = view[3] - view[1];
      const d = contentRectToDisplay(COVER, W, H, rot);
      const target = await PDFDocument.create();
      await rasterizePageWithRedactions(
        src, { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 } as DocumentPage,
        [new RedactionElement(d.x, d.y, d.width, d.height, 'p1', '#000000') as unknown as PDFElement],
        target, { rgb, StandardFonts, degrees }, noWatermark, new InkLayer(), failLoud,
      );
      const out = await target.save({ useObjectStreams: false });
      const at = await renderAt(out, d.x + d.width / 2, d.y + d.height / 2);
      // The exported page is the page the user saw — not the raw box, not Letter.
      const swap = rot === 90 || rot === 270;
      expect(at.size).toEqual(swap ? [H, W] : [W, H]);
      // POSITIVE evidence the burn landed on the secret's band.
      expect(at.dark, 'the burn must cover the secret').toBeGreaterThan(200);
      expect(await allText(out)).not.toContain(SECRET);
    });
  }
});
