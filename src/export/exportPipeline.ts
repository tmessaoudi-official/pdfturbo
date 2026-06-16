/**
 * exportPipeline — pure shared helpers for PDF page assembly.
 *
 * Extracted from ExportService to eliminate the rotation/cropBox/watermark/ink
 * pipeline that was duplicated across downloadPDF, downloadPage, downloadPageAsImage,
 * and _rasterizePageWithRedactions.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { renderElementToPdfLib, type PdfRenderCtx } from './pdfElementRenderer';
import { transformPoint, hexToRgbValues } from '../utils/geometry';
import { dataUrlToUint8Array } from '../utils/binaryUtils';
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
  const densityFactors = [0, 2.0, 1.5, 1.0, 0.7, 0.5];
  const spacingFactor = densityFactors[Math.max(1, Math.min(5, watermark.density ?? 3))];
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
): Promise<void> {
  const { rgb, pdfDoc, StandardFonts } = libs;
  const text = batesStampText(bates, pageNumber, pageCount);
  if (!text) return;
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const textWidth = font.widthOfTextAtSize(text, bates.fontSize);
  const MARGIN = 24;
  const { x, y } = batesPosition(bates.position, W_orig, H_orig, textWidth, bates.fontSize, MARGIN);
  const col = hexToRgbValues(bates.color);
  page.drawText(text, {
    x: cropOriginX + x,
    y: cropOriginY + y,
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

  const exportErrors: string[] = [];
  for (const element of elements) {
    try {
      await renderElementToPdfLib(element, { pdfDoc, page, libs: { rgb, StandardFonts, degrees }, h: h_eff, w: w_eff, W_orig, H_orig, totalRot, cropOriginX, cropOriginY } satisfies PdfRenderCtx);
    } catch {
      exportErrors.push(`${element.type} (id ${element.id})`);
    }
  }
  if (exportErrors.length > 0) {
    reportError.warn('toast.elementRenderFailed', { count: exportErrors.length });
    reportError.silent(undefined, `Export render failed: ${exportErrors.join(', ')}`);
  }

  if (watermark.enabled) {
    await drawWatermarkOnPage(page, W_orig, H_orig, cropOriginX, cropOriginY, watermark, { rgb, degrees, pdfDoc, StandardFonts });
  }

  const inkDataUrl = renderInkForExport(inkLayer, docPage.id, W_orig, H_orig, totalRot);
  if (inkDataUrl) {
    const inkImg = await pdfDoc.embedPng(dataUrlToUint8Array(inkDataUrl));
    page.drawImage(inkImg, { x: cropOriginX, y: cropOriginY, width: W_orig, height: H_orig });
  }

  // #61 Bates / page number — drawn last so it sits above content; uses the
  // page's full-document position so single-page / range exports stay correct.
  if (ctx.bates?.enabled && ctx.pageNumber !== undefined && ctx.pageCount !== undefined) {
    await drawBatesOnPage(page, W_orig, H_orig, cropOriginX, cropOriginY, ctx.bates, ctx.pageNumber, ctx.pageCount, { rgb, degrees, pdfDoc, StandardFonts });
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

  // Exclude TextElement overlays from the pdf-lib pass — they are drawn on canvas AFTER
  // redaction fillRects so they appear on top of redactions in the final raster image.
  // The Bates stamp rides this same pre-raster pass, so it's baked into the flattened image.
  const nonRedactionNonText = elements.filter(e => e.type !== 'redaction' && e.type !== 'text');
  await buildPageOverlays({
    pdfDoc: tempDoc,
    page: tempPage,
    docPage,
    elements: nonRedactionNonText,
    pdfLib: libs,
    userRot,
    sourceRot: srcRot,
    watermark,
    inkLayer,
    reportError,
    bates, pageNumber, pageCount,
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
  const ctx = offscreen.getContext('2d') as CanvasRenderingContext2D;
  await renderPage.render({ canvas: offscreen, viewport: vp }).promise;

  for (const el of elements.filter(e => e.type === 'redaction')) {
    ctx.fillStyle = (el as { color?: string }).color ?? '#000000';
    ctx.fillRect(
      Math.round(el.x * SCALE),
      Math.round(el.y * SCALE),
      Math.round(el.width  * SCALE),
      Math.round(el.height * SCALE),
    );
  }

  // Draw overlay TextElements on top of redactions using canvas 2D API.
  for (const el of elements.filter(e => e.type === 'text')) {
    const te = el as import('../elements/textElement').TextElement;
    if (!te.text) continue;
    ctx.save();
    const fontPx = Math.round(te.fontSize * SCALE);
    ctx.font = `${te.italic ? 'italic ' : ''}${te.bold ? 'bold ' : ''}${fontPx}px ${te.fontFamily || 'Arial'}, sans-serif`;
    ctx.fillStyle = te.color || '#000000';
    const lineHeight = te.fontSize * 1.2 * SCALE;
    te.text.split('\n').forEach((line, i) => {
      if (!line) return;
      ctx.fillText(line, Math.round(te.x * SCALE), Math.round((te.y + te.fontSize * 0.9) * SCALE + i * lineHeight));
    });
    ctx.restore();
  }

  const pngBytes = await new Promise<Uint8Array>((resolve, reject) => {
    offscreen.toBlob((blob) => {
      if (!blob) { reject(new Error('canvas toBlob failed')); return; }
      blob.arrayBuffer().then(ab => resolve(new Uint8Array(ab)), reject);
    }, 'image/png');
  });

  const pngImg  = await targetPdfDoc.embedPng(pngBytes);
  const newPage = targetPdfDoc.addPage([w_eff, h_eff]);
  newPage.drawImage(pngImg, { x: 0, y: 0, width: w_eff, height: h_eff });
}
