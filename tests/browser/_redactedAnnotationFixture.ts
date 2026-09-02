/**
 * Shared fixture for the "a source annotation under a redaction must not survive" guards.
 *
 * Two export paths call `_applyOverlaysToPage` and then rasterize what it produces —
 * `renderThumbnailWithOverlays` and `downloadPageAsImage` — and they are the only two callers
 * where `stripRedactedAnnotations` has work to do (every other caller routes a redaction-bearing
 * page to the rasterizer instead). They therefore share one leak and must share one fixture: a
 * copy per file is how a frame fix lands on one path and not the other, which is the exact defect
 * these tests exist to pin (see CLAUDE.md § "A source annotation under a redaction was painted
 * OVER the burn").
 *
 * The page carries two FreeText annotations with appearance streams:
 *   COVERED — red,   sits under the redaction, must be gone from the output.
 *   CONTROL — green, clear of every redaction, must SURVIVE.
 * The control is the load-bearing half: `annotationMode: DISABLE` would satisfy the leak
 * assertion while silently deleting every annotation on the page.
 */
import { RedactionElement } from '../../src/elements/redactionElement';
import { contentRectToDisplay } from '../../src/utils/geometry';
import type { IExportContext } from '../../src/export/exportService';
import * as pdfjsLib from 'pdfjs-dist';

export const W = 300, H = 600;
export const COVERED = { x: 120, y: 200, w: 100, h: 60 };  // red — under the burn
export const CONTROL = { x: 120, y: 400, w: 100, h: 60 };  // green — must survive

/**
 * Contains BOTH annotations, and its ORIGIN (100,150) is deliberately large.
 *
 * A first version used a (10,20) origin and PASSED against the unfixed code: a 10pt shift still
 * left the mis-framed redaction overlapping the annotation, so the case proved nothing. Sized so
 * that reading the NARROWED box instead of the source box moves the redaction clear —
 * with the narrowed frame the redaction lands at x 210..330 / y-down 190..270 while the
 * annotation sits at y-down 50..110, i.e. disjoint.
 */
export const CROP = { x: 100, y: 150, width: 180, height: 380 };

const toPdfRect = (r: { x: number; y: number; w: number; h: number }): number[] =>
  [r.x, H - r.y - r.h, r.x + r.w, H - r.y];

/** A one-page PDF carrying the COVERED (red) and CONTROL (green) annotations. */
export async function buildAnnotatedPdfBytes(): Promise<Uint8Array> {
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

/**
 * Count strongly-red and strongly-green pixels in a rendered page.
 *
 * Accepts a data URL (the thumbnail path returns JPEG) or a Blob (the image export returns the
 * encoder's bytes). Tolerances are wide enough for JPEG; PNG lands on the pure values.
 */
export async function countColours(src: string | Blob): Promise<{ red: number; green: number }> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('exported image failed to load'));
      img.src = url;
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
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}

export interface RedactedCtxOpts {
  rotation?: number;
  crop?: { x: number; y: number; width: number; height: number };
  /** Called for every `reportError.error`, so a bailed export fails loudly instead of timing out. */
  onError?: (key: string, err?: unknown) => void;
  /**
   * Freehand strokes for the page's ink layer, in editor DISPLAY space (WS4-A). Default empty, so
   * every pre-existing caller is unchanged. The ink layer is stamped AFTER the burn, so this is
   * what lets a guard drive the "handwriting under a redaction" leak end-to-end.
   */
  strokes?: Array<{ type: 'ink' | 'erase'; width: number; color: string; points: Array<{ x: number; y: number }> }>;
}

/**
 * An `IExportContext` for a one-page document whose single redaction covers COVERED.
 *
 * A redaction element's coordinates are DISPLAY space — i.e. relative to the page as the user
 * currently sees it. Holding them fixed while rotating the page would move the burn off the
 * annotation for real, so the test would be asserting a leak that is not one. The rect is derived
 * per rotation from the annotation's content-space box instead, inflated by a margin, which is
 * what "the user drew a box over this annotation" actually means at that rotation.
 */
export async function buildRedactedCtx(opts: RedactedCtxOpts): Promise<IExportContext> {
  const bytes = await buildAnnotatedPdfBytes();
  // pdf.js DETACHES the buffer it is handed, so `bytes` must be sliced here or the pdf-lib load
  // inside the export reads zero bytes (CLAUDE.md § the orphan-leak scan that could not fail).
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const docPage = {
    id: 'p1', sourcePdfId: 's1', sourcePageNum: 1,
    rotation: opts.rotation ?? 0, ...(opts.crop ? { crop: opts.crop } : {}),
  };
  const rot = ((opts.rotation ?? 0) % 360 + 360) % 360;
  const d = contentRectToDisplay(
    { x: COVERED.x, y: COVERED.y, width: COVERED.w, height: COVERED.h }, W, H, rot,
  );
  const M = 10;
  const redaction = new RedactionElement(
    d.x - M, d.y - M, d.width + 2 * M, d.height + 2 * M, 'p1', '#000000',
  );
  const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
  return {
    documentModel: {
      pageCount: 1, currentPageIndex: 0, pages: [docPage],
      sourcePdfs: new Map([['s1', { bytes, doc }]]),
      watermark: { enabled: false }, bates: { enabled: false },
    },
    elements: [redaction],
    formValues: {}, currentFilename: 'x.pdf', exportPassword: null,
    inkLayer: { getStrokes: () => opts.strokes ?? [] },
    reportError: {
      info() {}, warn() {},
      error(key: string, err?: unknown) { opts.onError?.(key, err); },
    },
    progress: { begin: () => handle },
    cleanEmptyTextElements() {}, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
  } as unknown as IExportContext;
}
