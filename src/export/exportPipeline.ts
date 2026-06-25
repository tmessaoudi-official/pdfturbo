/**
 * exportPipeline — pure shared helpers for PDF page assembly.
 *
 * Extracted from ExportService to eliminate the rotation/cropBox/watermark/ink
 * pipeline that was duplicated across downloadPDF, downloadPage, downloadPageAsImage,
 * and _rasterizePageWithRedactions.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { renderElementToPdfLib, type PdfRenderCtx } from './pdfElementRenderer';
import { transformPoint, hexToRgbValues, contentCropToPdfCropBox } from '../utils/geometry';
import { dataUrlToUint8Array } from '../utils/binaryUtils';
import { densitySpacingFactor } from '../utils/watermarkDensity';
import type { PDFElement } from '../elements/annotationElement';
import type { DocumentPage, WatermarkSettings } from '../core/documentModel';
import type { InkLayer } from '../infra/inkLayer';
import type { IErrorReporter } from '../core/errorReporter';
import type { PdfLibOps, PdfLibDrawOps } from '../utils/pdfLibTypes';
import { batesStampText, batesPosition, type BatesSettings } from './batesStamp';

// ── Shared context for page overlay assembly ─────────────────────────────────

export interface BuildPageCtx {
  pdfDoc: import('@cantoo/pdf-lib').PDFDocument;
  page: import('@cantoo/pdf-lib').PDFPage;
  docPage: DocumentPage;
  elements: PDFElement[];
  pdfLib: PdfLibOps;
  userRot: number;
  sourceRot: number;
  watermark: WatermarkSettings;
  inkLayer: InkLayer;
  reportError: IErrorReporter;
  /** #61 Bates / page-number stamp; omitted or disabled = no stamp. */
  bates?: BatesSettings;
  /** 1-based full-document position of this page (for the stamp number). */
  pageNumber?: number;
  /** Full-document page count (for "N / total"). */
  pageCount?: number;
  /**
   * #QA-2026-06-23 — when true, skip the final `page.setCropBox` call only. The redaction
   * rasterizer sets this so it renders the FULL (uncropped) page and clips the canvas to the
   * crop window LAST — keeping the burn and content in one coordinate space so the burn can
   * never drift off the secret. All other overlay drawing is unchanged.
   */
  skipCropBox?: boolean;
}

// ── Pure geometry helper ─────────────────────────────────────────────────────

export function getPageCropBox(
  page: import('@cantoo/pdf-lib').PDFPage,
): { x: number; y: number; width: number; height: number } {
  try {
    const cb = page.getCropBox?.();
    if (cb && typeof cb.width === 'number') return { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
  } catch { /* no CropBox */ }
  const { width, height } = page.getSize();
  return { x: 0, y: 0, width, height };
}

// ── Ink layer helper ─────────────────────────────────────────────────────────

export function renderInkForExport(
  inkLayer: InkLayer,
  pageId: string,
  W_orig: number,
  H_orig: number,
  totalRot: number,
): string | null {
  const strokes = inkLayer.getStrokes(pageId);
  if (!strokes.length) return null;

  const SCALE = 2;
  const c = document.createElement('canvas');
  c.width  = Math.round(W_orig * SCALE);
  c.height = Math.round(H_orig * SCALE);
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    ctx.save();
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke.width * SCALE;
    if (stroke.type === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color;
    }
    const pts = stroke.points.map(p => {
      const pdf = transformPoint(p.x, p.y, W_orig, H_orig, totalRot);
      return { x: pdf.x * SCALE, y: (H_orig - pdf.y) * SCALE };
    });
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return c.toDataURL('image/png');
  }
  return null;
}

// ── Watermark helper ─────────────────────────────────────────────────────────

export async function drawWatermarkOnPage(
  page: import('@cantoo/pdf-lib').PDFPage,
  W_orig: number,
  H_orig: number,
  cropOriginX: number,
  cropOriginY: number,
  watermark: WatermarkSettings,
  libs: PdfLibDrawOps,
): Promise<void> {
  const { rgb, degrees, pdfDoc, StandardFonts } = libs;
  const col = hexToRgbValues(watermark.color);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const textWidth = font.widthOfTextAtSize(watermark.text, watermark.fontSize);
  const spacingFactor = densitySpacingFactor(watermark.density ?? 3);
  const stepX = Math.max(textWidth + watermark.fontSize * 0.8, W_orig / 5) * spacingFactor;
  const stepY = Math.max(watermark.fontSize * 2, H_orig / 4) * spacingFactor;
  for (let y = cropOriginY - (stepY / 2); y < cropOriginY + H_orig + stepY; y += stepY) {
    for (let x = cropOriginX - (stepX / 2); x < cropOriginX + W_orig + stepX; x += stepX) {
      page.drawText(watermark.text, {
        x: x - textWidth / 2,
        y,
        size: watermark.fontSize,
        font,
        color: rgb(col.r, col.g, col.b),
        opacity: watermark.opacity,
        rotate: degrees(watermark.angle),
      });
    }
  }
}

// ── Bates / page-number helper ───────────────────────────────────────────────

export async function drawBatesOnPage(
  page: import('@cantoo/pdf-lib').PDFPage,
  W_orig: number,
  H_orig: number,
  cropOriginX: number,
  cropOriginY: number,
  bates: BatesSettings,
  pageNumber: number,
  pageCount: number,
  libs: PdfLibDrawOps,
  totalRot = 0,
): Promise<void> {
  const { rgb, pdfDoc, StandardFonts } = libs;
  const text = batesStampText(bates, pageNumber, pageCount);
  if (!text) return;
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const textWidth = font.widthOfTextAtSize(text, bates.fontSize);
  const MARGIN = 24;
  const rot = ((totalRot % 360) + 360) % 360;

  // The user picks a corner of the VISUAL (rotated) page, so place the stamp in
  // the rotated frame (dims swapped for 90/270), then map that anchor back to
  // unrotated content space via transformPoint — the page's /Rotate re-rotates
  // the drawn text so it appears upright at the chosen corner (same mechanism
  // the element renderer uses). At rot=0 transformPoint is the identity y-flip,
  // so this is byte-identical to the pre-fix path (with or without a crop).
  const visW = (rot === 90 || rot === 270) ? H_orig : W_orig;
  const visH = (rot === 90 || rot === 270) ? W_orig : H_orig;
  const { x: vx, y: vyUp } = batesPosition(bates.position, visW, visH, textWidth, bates.fontSize, MARGIN);
  // batesPosition returns a y-UP baseline anchor in the visual box; convert to
  // display (y-down) for transformPoint, which maps display→content (y-up).
  const content = transformPoint(vx, visH - vyUp, W_orig, H_orig, rot);
  const col = hexToRgbValues(bates.color);
  page.drawText(text, {
    x: cropOriginX + content.x,
    y: cropOriginY + content.y,
    size: bates.fontSize,
    font,
    color: rgb(col.r, col.g, col.b),
  });
}

// ── Core pipeline: apply overlays to a pdf-lib page ─────────────────────────

export async function buildPageOverlays(ctx: BuildPageCtx): Promise<void> {
  const { pdfDoc, page, docPage, elements, pdfLib, userRot, sourceRot, watermark, inkLayer, reportError } = ctx;
  const { rgb, degrees, StandardFonts } = pdfLib;

  const totalRot = ((sourceRot + userRot) % 360 + 360) % 360;
  if (userRot) page.setRotation(degrees(totalRot));

  const cropBox = getPageCropBox(page);
  const { width: W_orig, height: H_orig, x: cropOriginX, y: cropOriginY } = cropBox;
  const w_eff = (totalRot === 90 || totalRot === 270) ? H_orig : W_orig;
  const h_eff = (totalRot === 90 || totalRot === 270) ? W_orig : H_orig;

  // #G23 crop: a user crop narrows the visible page to a sub-box. Elements + ink keep their
  // SOURCE-box coordinates (the CropBox clips them); the watermark + Bates use the cropped
  // "effective box" so they tile/anchor inside the crop. No crop → effBox === cropBox, so the
  // export is byte-identical to the pre-crop path.
  const effBox = docPage.crop ? contentCropToPdfCropBox(docPage.crop, cropBox) : cropBox;

  const exportErrors: string[] = [];
  const exportErrorTypes = new Set<string>();
  for (const element of elements) {
    try {
      await renderElementToPdfLib(element, { pdfDoc, page, libs: { rgb, StandardFonts, degrees }, h: h_eff, w: w_eff, W_orig, H_orig, totalRot, cropOriginX, cropOriginY } satisfies PdfRenderCtx);
    } catch (e) {
      // Fail-CLOSED for redactions: a swallowed redaction render would leave the
      // source content it must destroy visible in the export (a security leak).
      // Better to abort the export than to ship an un-redacted page.
      if (element.type === 'redaction') throw e;
      exportErrors.push(`${element.type} (id ${element.id})`);
      exportErrorTypes.add(element.type);
    }
  }
  if (exportErrors.length > 0) {
    // Name the element type(s) so the user knows WHAT failed (not just a count).
    reportError.warn('toast.elementRenderFailed', { count: exportErrors.length, types: [...exportErrorTypes].join(', ') });
    reportError.silent(undefined, `Export render failed: ${exportErrors.join(', ')}`);
  }

  if (watermark.enabled) {
    await drawWatermarkOnPage(page, effBox.width, effBox.height, effBox.x, effBox.y, watermark, { rgb, degrees, pdfDoc, StandardFonts });
  }

  const inkDataUrl = renderInkForExport(inkLayer, docPage.id, W_orig, H_orig, totalRot);
  if (inkDataUrl) {
    const inkImg = await pdfDoc.embedPng(dataUrlToUint8Array(inkDataUrl));
    page.drawImage(inkImg, { x: cropOriginX, y: cropOriginY, width: W_orig, height: H_orig });
  }

  // #61 Bates / page number — drawn last so it sits above content; uses the
  // page's full-document position so single-page / range exports stay correct.
  if (ctx.bates?.enabled && ctx.pageNumber !== undefined && ctx.pageCount !== undefined) {
    await drawBatesOnPage(page, effBox.width, effBox.height, effBox.x, effBox.y, ctx.bates, ctx.pageNumber, ctx.pageCount, { rgb, degrees, pdfDoc, StandardFonts }, totalRot);
  }

  // #G23 crop: clip the page to the user crop. Applied LAST — after overlays draw in
  // source-box space — so element/ink positions are unaffected; the viewer then shows only
  // the crop window. The redaction rasterizer passes skipCropBox=true and clips the CANVAS
  // instead (so its full-page burn coords stay correct — #QA-2026-06-23).
  if (docPage.crop && !ctx.skipCropBox) {
    page.setCropBox(effBox.x, effBox.y, effBox.width, effBox.height);
  }
}

// ── Redaction rasterizer ─────────────────────────────────────────────────────

export async function rasterizePageWithRedactions(
  srcDoc: import('@cantoo/pdf-lib').PDFDocument,
  docPage: DocumentPage,
  elements: PDFElement[],
  targetPdfDoc: import('@cantoo/pdf-lib').PDFDocument,
  libs: PdfLibOps,
  watermark: WatermarkSettings,
  inkLayer: InkLayer,
  reportError: IErrorReporter,
  bates?: BatesSettings,
  pageNumber?: number,
  pageCount?: number,
): Promise<void> {
  const { PDFDocument, rgb, StandardFonts } = await import('@cantoo/pdf-lib');
  void rgb; void StandardFonts;

  const tempDoc = await PDFDocument.create();
  const [tempPage] = await tempDoc.copyPages(srcDoc, [docPage.sourcePageNum - 1]);
  tempDoc.addPage(tempPage);

  const userRot  = docPage.rotation ?? 0;
  const srcRot   = tempPage.getRotation().angle as number;

  // Draw ALL elements (redactions included) in array/stacking order through the vector bake,
  // then rasterize the whole page. Array order == on-screen stacking, so an overlay placed ON
  // TOP of a redaction renders above the burn (the user-requested behavior) while one placed
  // under it stays under. The redaction is an OPAQUE filled rect (renderRedaction), so it still
  // destroys the SOURCE content beneath it once flattened — and renderRedaction now anchors via
  // the rotation-correct rectAnchor (see pdfElementRenderer), so the burn covers its target on
  // rotated pages too. A redaction render failure is fail-CLOSED in buildPageOverlays (re-throws).
  await buildPageOverlays({
    pdfDoc: tempDoc,
    page: tempPage,
    docPage,
    elements,
    pdfLib: libs,
    userRot,
    sourceRot: srcRot,
    watermark,
    inkLayer,
    reportError,
    bates, pageNumber, pageCount,
    // Render the FULL (uncropped) page; the crop is applied as a canvas clip below so the
    // overlay/burn coords stay in full-page space (#QA-2026-06-23 leak fix).
    skipCropBox: true,
  });

  const totalRot = ((srcRot + userRot) % 360 + 360) % 360;
  const cropBoxR = getPageCropBox(tempPage);
  const { width: W_orig, height: H_orig } = cropBoxR;
  const w_eff = (totalRot === 90 || totalRot === 270) ? H_orig : W_orig;
  const h_eff = (totalRot === 90 || totalRot === 270) ? W_orig : H_orig;

  const tempBytes  = await tempDoc.save({ useObjectStreams: false });
  const renderDoc  = await pdfjsLib.getDocument({ data: tempBytes }).promise;
  const renderPage = await renderDoc.getPage(1);
  const SCALE = 2;
  const vp = renderPage.getViewport({ scale: SCALE });

  const offscreen = document.createElement('canvas');
  offscreen.width  = Math.round(vp.width);
  offscreen.height = Math.round(vp.height);
  await renderPage.render({ canvas: offscreen, viewport: vp }).promise;

  // Redactions, text, and every other overlay were drawn (in array/stacking order) into the
  // page above and flattened by this rasterization — no separate post-raster burn/text pass is
  // needed. Source content under each opaque redaction rect is destroyed in these pixels.

  // #QA-2026-06-23 — apply the crop by clipping the rendered CANVAS (not via setCropBox before
  // render). Everything above is drawn in full-page coords matching the full render, so it can
  // never drift off its target; here we extract only the crop window. No crop → embed the full
  // canvas (byte-identical to the pre-fix uncropped path).
  let outCanvas: HTMLCanvasElement = offscreen;
  let outW = w_eff, outH = h_eff;
  if (docPage.crop) {
    const effBox = contentCropToPdfCropBox(docPage.crop, cropBoxR);
    // Map the crop window's user-space corners to canvas pixels — convertToViewportPoint
    // applies the viewport's rotation + scale, so this is correct for /Rotate'd pages too.
    const [ax, ay] = vp.convertToViewportPoint(effBox.x, effBox.y);
    const [bx, by] = vp.convertToViewportPoint(effBox.x + effBox.width, effBox.y + effBox.height);
    const clipX = Math.round(Math.min(ax, bx));
    const clipY = Math.round(Math.min(ay, by));
    const clipW = Math.max(1, Math.round(Math.abs(bx - ax)));
    const clipH = Math.max(1, Math.round(Math.abs(by - ay)));
    const clip = document.createElement('canvas');
    clip.width = clipW;
    clip.height = clipH;
    const cctx = clip.getContext('2d') as CanvasRenderingContext2D;
    cctx.drawImage(offscreen, -clipX, -clipY);
    outCanvas = clip;
    outW = clipW / SCALE;
    outH = clipH / SCALE;
  }

  const pngBytes = await new Promise<Uint8Array>((resolve, reject) => {
    outCanvas.toBlob((blob) => {
      if (!blob) { reject(new Error('canvas toBlob failed')); return; }
      blob.arrayBuffer().then(ab => resolve(new Uint8Array(ab)), reject);
    }, 'image/png');
  });

  const pngImg  = await targetPdfDoc.embedPng(pngBytes);
  const newPage = targetPdfDoc.addPage([outW, outH]);
  newPage.drawImage(pngImg, { x: 0, y: 0, width: outW, height: outH });

  // #QA-2026-06-23 P2: release the pdf.js worker doc (doc.destroy() is a v6 no-op — the
  // loadingTask owns the worker). Matches the _compressLossy cleanup in exportService.
  const task = (renderDoc as { loadingTask?: { destroy?: () => Promise<void> } }).loadingTask;
  if (task && typeof task.destroy === 'function') void task.destroy().catch(() => {});
}
