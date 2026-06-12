/**
 * ExportService — all PDF/image/docx/markdown export operations extracted from PDFEditorApp.
 *
 * Depends only on IExportContext (the narrow slice of app state it needs), not on the
 * concrete PDFEditorApp class, so it can be tested and evolved independently.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { renderElementToPdfLib, type PdfRenderCtx } from './pdfElementRenderer';
import { reconstructPage, assignHeadings, type FlowDoc, type FontInfoMap, type RawTextItem } from '../utils/flowDoc';
import { flowDocToDocxBlob, flowDocToMarkdown } from '../utils/flowDocWriters';
import { transformPoint, hexToRgbValues } from '../utils/geometry';
import { dataUrlToUint8Array } from '../utils/binaryUtils';
import type { PDFElement } from '../elements/annotationElement';
import type { DocumentModel, DocumentPage } from '../core/documentModel';
import type { InkLayer } from '../infra/inkLayer';
import type { IErrorReporter } from '../core/errorReporter';
import type { IProgressManager } from '../ui/progressManager';
import type { PdfLibOps, PdfLibDrawOps } from '../utils/pdfLibTypes';

// ── Context interface ────────────────────────────────────────────────────────

export interface IExportContext {
  documentModel: DocumentModel;
  elements: PDFElement[];
  reportError: IErrorReporter;
  progress: IProgressManager;
  currentFilename: string | null;
  exportPassword: { user: string; owner: string } | null;
  formValues: Record<string, Record<string, string>>;
  inkLayer: InkLayer;
  cleanEmptyTextElements(): void;
  renderCurrentPage(): Promise<void>;
  rebuildElementLayer(): void;
}

// ── ExportService ────────────────────────────────────────────────────────────

export class ExportService {
  constructor(private readonly _ctx: IExportContext) {}

  // ── Public export entry points ───────────────────────────────────────────

  async downloadPDF(): Promise<void> {
    const { documentModel, elements, reportError, progress, formValues } = this._ctx;
    if (!documentModel.pageCount) return;
    this._ctx.cleanEmptyTextElements();
    const _prog = progress.begin('progress.generatingPdf');
    const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
    try {
      const pdfDoc = await PDFDocument.create();

      // Load each source PDF once
      const srcDocs = new Map<string, import('@cantoo/pdf-lib').PDFDocument>();
      for (const [id, src] of documentModel.sourcePdfs) {
        srcDocs.set(id, await PDFDocument.load(src.bytes));
      }

      // Fill and flatten form fields for sources with user-entered values
      for (const [id, srcDoc] of srcDocs) {
        const vals = formValues[id];
        if (!vals || !Object.keys(vals).length) continue;
        try {
          const form = srcDoc.getForm();
          for (const [fieldName, value] of Object.entries(vals)) {
            try { form.getTextField(fieldName).setText(value); } catch { /* field missing */ }
          }
          form.flatten();
        } catch { /* no form fields in this source */ }
      }

      // Pre-copy all needed pages from each source (one copyPages call per source)
      const copiedPages = new Map<string, import('@cantoo/pdf-lib').PDFPage>();
      for (const [id, srcDoc] of srcDocs) {
        const indices = [...new Set(
          documentModel.pages.filter(p => p.sourcePdfId === id).map(p => p.sourcePageNum - 1)
        )].sort((a, b) => a - b);
        const pages = await pdfDoc.copyPages(srcDoc, indices);
        indices.forEach((idx: number, i: number) => copiedPages.set(`${id}:${idx}`, pages[i]));
      }

      // Add pages in document order and draw overlays
      for (const docPage of documentModel.pages) {
        const pageElements = elements.filter(el => el.pageId === docPage.id);
        const hasRedaction = pageElements.some(el => el.type === 'redaction');

        // Blank page: create fresh page at specified dimensions
        if (docPage.sourcePdfId === 'blank') {
          const W_orig = docPage.blankWidth ?? 595;
          const H_orig = docPage.blankHeight ?? 842;
          const blankPage = pdfDoc.addPage([W_orig, H_orig]);
          blankPage.drawRectangle({ x: 0, y: 0, width: W_orig, height: H_orig, color: rgb(1, 1, 1), borderWidth: 0 });
          const exportErrors: string[] = [];
          for (const element of pageElements) {
            try {
              await renderElementToPdfLib(element, { pdfDoc, page: blankPage, libs: { rgb, StandardFonts, degrees }, h: H_orig, w: W_orig, W_orig, H_orig, totalRot: 0, cropOriginX: 0, cropOriginY: 0 } satisfies PdfRenderCtx);
            } catch {
              exportErrors.push(`${element.type} (id ${element.id})`);
            }
          }
          if (exportErrors.length > 0) {
            reportError.warn('toast.elementRenderFailed', { count: exportErrors.length });
            reportError.silent(undefined, `Blank-page export failed: ${exportErrors.join(', ')}`);
          }
          const inkDataUrl = this._renderInkForExport(docPage.id, W_orig, H_orig, 0);
          if (inkDataUrl) {
            const inkImg = await pdfDoc.embedPng(dataUrlToUint8Array(inkDataUrl));
            blankPage.drawImage(inkImg, { x: 0, y: 0, width: W_orig, height: H_orig });
          }
          continue;
        }

        if (hasRedaction) {
          const srcDoc = srcDocs.get(docPage.sourcePdfId);
          if (srcDoc) {
            await this._rasterizePageWithRedactions(srcDoc, docPage, pageElements, pdfDoc, { rgb, StandardFonts, degrees });
          }
          continue;
        }

        const key = `${docPage.sourcePdfId}:${docPage.sourcePageNum - 1}`;
        const page = copiedPages.get(key);
        if (!page) continue;
        pdfDoc.addPage(page);

        const userRot = docPage.rotation ?? 0;
        const sourceRot = page.getRotation().angle as number;
        await this._applyPageOverlays(pdfDoc, page, docPage, pageElements, { rgb, degrees, StandardFonts }, userRot, sourceRot);
      }

      this._applyExportPassword(pdfDoc);
      const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = this._exportBaseName() + '-edited.pdf';
      link.click();
      reportError.info('toast.pdfDownloaded');
      URL.revokeObjectURL(url);
      _prog.done();
    } catch (err) {
      reportError.error('toast.pdfExportFailed', err);
      _prog.failed();
    } finally {
      await this._ctx.renderCurrentPage();
      this._ctx.rebuildElementLayer();
    }
  }

  async downloadPage(pageIdx: number): Promise<void> {
    const { documentModel, elements, reportError, progress } = this._ctx;
    const docPage = documentModel.pages[pageIdx];
    if (!docPage) return;
    const _prog = progress.begin('progress.exportingPage');
    const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
    try {
      const srcEntry = documentModel.sourcePdfs.get(docPage.sourcePdfId);
      if (!srcEntry) { _prog.failed(); return; }
      const srcDocLib = await PDFDocument.load(srcEntry.bytes);
      const pdfDoc    = await PDFDocument.create();
      const pageElements = elements.filter(el => el.pageId === docPage.id);
      const hasRedaction = pageElements.some(el => el.type === 'redaction');

      if (hasRedaction) {
        await this._rasterizePageWithRedactions(srcDocLib, docPage, pageElements, pdfDoc, { rgb, StandardFonts, degrees });
      } else {
        const [page] = await pdfDoc.copyPages(srcDocLib, [docPage.sourcePageNum - 1]);
        pdfDoc.addPage(page);
        const userRot = docPage.rotation ?? 0;
        const srcRot  = page.getRotation().angle as number;
        await this._applyPageOverlays(pdfDoc, page, docPage, pageElements, { rgb, degrees, StandardFonts }, userRot, srcRot);
      }

      this._applyExportPassword(pdfDoc);
      const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${this._exportBaseName()}-page${pageIdx + 1}.pdf`;
      link.click();
      reportError.info('toast.pageDownloaded', { page: pageIdx + 1 });
      URL.revokeObjectURL(url);
      _prog.done();
    } catch (err) {
      reportError.error('toast.pageExportFailed', err);
      _prog.failed();
    }
  }

  async downloadPageAsImage(pageIdx?: number): Promise<void> {
    const { documentModel, elements, reportError, progress } = this._ctx;
    const idx = pageIdx ?? documentModel.currentPageIndex;
    const docPage = documentModel.pages[idx];
    if (!docPage) return;
    const _prog = progress.begin('progress.exportingImage');
    try {
      const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
      const srcEntry = documentModel.sourcePdfs.get(docPage.sourcePdfId);
      if (!srcEntry) {
        reportError.error('toast.exportSourceNotFound');
        _prog.failed();
        return;
      }
      const srcDoc = await PDFDocument.load(srcEntry.bytes);
      const pdfDoc = await PDFDocument.create();
      const [page] = await pdfDoc.copyPages(srcDoc, [docPage.sourcePageNum - 1]);
      pdfDoc.addPage(page);

      const userRot  = docPage.rotation ?? 0;
      const srcRot   = page.getRotation().angle as number;
      const pageElements = elements.filter(el => el.pageId === docPage.id);
      await this._applyPageOverlays(pdfDoc, page, docPage, pageElements, { rgb, degrees, StandardFonts }, userRot, srcRot);

      const pdfBytes   = await pdfDoc.save({ useObjectStreams: false });
      const renderDoc  = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      const renderPage = await renderDoc.getPage(1);
      const SCALE = 2;
      const vp = renderPage.getViewport({ scale: SCALE });
      const offscreen = document.createElement('canvas');
      offscreen.width  = Math.round(vp.width);
      offscreen.height = Math.round(vp.height);
      const ctx = offscreen.getContext('2d');
      if (!ctx) { reportError.error('toast.canvasUnavailable'); _prog.failed(); return; }
      await renderPage.render({ canvas: offscreen, viewport: vp }).promise;

      offscreen.toBlob((blob) => {
        if (!blob) { reportError.error('toast.imageExportFailed'); _prog.failed(); return; }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${this._exportBaseName()}-page${idx + 1}.png`;
        link.click();
        reportError.info('toast.imageExported', { page: idx + 1 });
        URL.revokeObjectURL(url);
        _prog.done();
      }, 'image/png');
    } catch (err) {
      reportError.error('toast.imageExportFailed', err);
      _prog.failed();
    }
  }

  async exportAsDocx(): Promise<void> {
    const { reportError, progress } = this._ctx;
    const _prog = progress.begin('progress.generatingDocx');
    try {
      const flowDoc = await this._extractFlowDoc();
      if (!flowDoc.pages.some(p => p.paragraphs.length > 0)) {
        reportError.warn('toast.exportNoText');
        _prog.done();
        return;
      }
      const blob = await flowDocToDocxBlob(flowDoc);
      this._downloadBlob(blob, this._exportBaseName() + '.docx');
      reportError.info('toast.docxExported');
      _prog.done();
    } catch (err) {
      reportError.error('toast.exportFailed', err);
      _prog.failed();
    }
  }

  async exportAsMarkdown(): Promise<void> {
    const { reportError, progress } = this._ctx;
    const _prog = progress.begin('progress.generatingMarkdown');
    try {
      const flowDoc = await this._extractFlowDoc();
      const md = flowDocToMarkdown(flowDoc);
      if (!md.trim()) {
        reportError.warn('toast.exportNoText');
        _prog.done();
        return;
      }
      this._downloadBlob(new Blob([md], { type: 'text/markdown' }), this._exportBaseName() + '.md');
      reportError.info('toast.mdExported');
      _prog.done();
    } catch (err) {
      reportError.error('toast.exportFailed', err);
      _prog.failed();
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _exportBaseName(): string {
    return (this._ctx.currentFilename || 'document').replace(/\.pdf$/i, '');
  }

  private _downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private _applyExportPassword(pdfDoc: { encrypt(opts: { userPassword: string; ownerPassword: string }): void }): void {
    const pw = this._ctx.exportPassword;
    if (!pw) return;
    pdfDoc.encrypt({ userPassword: pw.user, ownerPassword: pw.owner });
  }

  private async _applyPageOverlays(
    pdfDoc: import('@cantoo/pdf-lib').PDFDocument,
    page: import('@cantoo/pdf-lib').PDFPage,
    docPage: DocumentPage,
    pageElements: PDFElement[],
    pdfLib: PdfLibOps,
    userRot: number,
    sourceRot: number
  ): Promise<void> {
    const { documentModel, reportError } = this._ctx;
    const { rgb, degrees, StandardFonts } = pdfLib;
    const totalRot = ((sourceRot + userRot) % 360 + 360) % 360;
    if (userRot) page.setRotation(degrees(totalRot));

    const cropBox = this._getPageCropBox(page);
    const W_orig = cropBox.width;
    const H_orig = cropBox.height;
    const cropOriginX = cropBox.x;
    const cropOriginY = cropBox.y;
    const w_eff = (totalRot === 90 || totalRot === 270) ? H_orig : W_orig;
    const h_eff = (totalRot === 90 || totalRot === 270) ? W_orig : H_orig;

    const exportErrors: string[] = [];
    for (const element of pageElements) {
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

    if (documentModel.watermark.enabled) {
      await this._drawWatermark(page, W_orig, H_orig, cropOriginX, cropOriginY, { rgb, degrees, pdfDoc, StandardFonts });
    }

    const inkDataUrl = this._renderInkForExport(docPage.id, W_orig, H_orig, totalRot);
    if (inkDataUrl) {
      const inkPng = dataUrlToUint8Array(inkDataUrl);
      const inkImg = await pdfDoc.embedPng(inkPng);
      page.drawImage(inkImg, { x: cropOriginX, y: cropOriginY, width: W_orig, height: H_orig });
    }
  }

  private async _rasterizePageWithRedactions(
    srcDoc: import('@cantoo/pdf-lib').PDFDocument,
    docPage: DocumentPage,
    elements: PDFElement[],
    pdfDoc: import('@cantoo/pdf-lib').PDFDocument,
    libs: PdfLibOps,
  ): Promise<void> {
    const { documentModel, reportError } = this._ctx;
    const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
    void rgb; void StandardFonts;

    const tempDoc = await PDFDocument.create();
    const [tempPage] = await tempDoc.copyPages(srcDoc, [docPage.sourcePageNum - 1]);
    tempDoc.addPage(tempPage);

    const userRot  = docPage.rotation ?? 0;
    const srcRot   = tempPage.getRotation().angle as number;
    const totalRot = ((srcRot + userRot) % 360 + 360) % 360;
    if (userRot) tempPage.setRotation(degrees(totalRot));

    const cropBoxR = this._getPageCropBox(tempPage);
    const W_orig = cropBoxR.width;
    const H_orig = cropBoxR.height;
    const cropOriginX = cropBoxR.x;
    const cropOriginY = cropBoxR.y;
    const w_eff = (totalRot === 90 || totalRot === 270) ? H_orig : W_orig;
    const h_eff = (totalRot === 90 || totalRot === 270) ? W_orig : H_orig;

    const nonRedactions = elements.filter(e => e.type !== 'redaction');
    const rasterErrors: string[] = [];
    for (const el of nonRedactions) {
      try {
        await renderElementToPdfLib(el, { pdfDoc: tempDoc, page: tempPage, libs, h: h_eff, w: w_eff, W_orig, H_orig, totalRot, cropOriginX, cropOriginY } satisfies PdfRenderCtx);
      } catch {
        rasterErrors.push(`${el.type} (id ${el.id})`);
      }
    }
    if (rasterErrors.length > 0) {
      reportError.warn('toast.elementRenderFailed', { count: rasterErrors.length });
      reportError.silent(undefined, `Redaction skipped: ${rasterErrors.join(', ')}`);
    }

    if (documentModel.watermark.enabled) {
      await this._drawWatermark(tempPage, W_orig, H_orig, cropOriginX, cropOriginY, {
        rgb: libs.rgb, degrees, pdfDoc: tempDoc, StandardFonts: libs.StandardFonts,
      });
    }
    const inkDataUrlRast = this._renderInkForExport(docPage.id, W_orig, H_orig, totalRot);
    if (inkDataUrlRast) {
      const inkImg = await tempDoc.embedPng(dataUrlToUint8Array(inkDataUrlRast));
      tempPage.drawImage(inkImg, { x: cropOriginX, y: cropOriginY, width: W_orig, height: H_orig });
    }

    const tempBytes  = await tempDoc.save({ useObjectStreams: false });
    const renderDoc  = await pdfjsLib.getDocument({ data: tempBytes }).promise;
    const renderPage = await renderDoc.getPage(1);
    const SCALE = 2;
    const vp = renderPage.getViewport({ scale: SCALE });

    const offscreen = document.createElement('canvas');
    offscreen.width    = Math.round(vp.width);
    offscreen.height   = Math.round(vp.height);
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

    const pngBytes = await new Promise<Uint8Array>((resolve, reject) => {
      offscreen.toBlob((blob) => {
        if (!blob) { reject(new Error('canvas toBlob failed')); return; }
        blob.arrayBuffer().then(ab => resolve(new Uint8Array(ab)), reject);
      }, 'image/png');
    });

    const pngImg  = await pdfDoc.embedPng(pngBytes);
    const newPage = pdfDoc.addPage([w_eff, h_eff]);
    newPage.drawImage(pngImg, { x: 0, y: 0, width: w_eff, height: h_eff });
  }

  private _renderInkForExport(pageId: string, W_orig: number, H_orig: number, totalRot: number): string | null {
    const strokes = this._ctx.inkLayer.getStrokes(pageId);
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

  private _getPageCropBox(page: import('@cantoo/pdf-lib').PDFPage): { x: number; y: number; width: number; height: number } {
    try {
      const cb = page.getCropBox?.();
      if (cb && typeof cb.width === 'number') return { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
    } catch { /* no CropBox */ }
    const { width, height } = page.getSize();
    return { x: 0, y: 0, width, height };
  }

  private async _drawWatermark(
    page: import('@cantoo/pdf-lib').PDFPage,
    W_orig: number,
    H_orig: number,
    cropOriginX: number,
    cropOriginY: number,
    libs: PdfLibDrawOps
  ): Promise<void> {
    const { rgb, degrees, pdfDoc, StandardFonts } = libs;
    const wm = this._ctx.documentModel.watermark;
    const col = hexToRgbValues(wm.color);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const textWidth = font.widthOfTextAtSize(wm.text, wm.fontSize);
    const densityFactors = [0, 2.0, 1.5, 1.0, 0.7, 0.5];
    const spacingFactor = densityFactors[Math.max(1, Math.min(5, wm.density ?? 3))];
    const stepX = Math.max(textWidth + wm.fontSize * 0.8, W_orig / 5) * spacingFactor;
    const stepY = Math.max(wm.fontSize * 2, H_orig / 4) * spacingFactor;
    for (let y = cropOriginY - (stepY / 2); y < cropOriginY + H_orig + stepY; y += stepY) {
      for (let x = cropOriginX - (stepX / 2); x < cropOriginX + W_orig + stepX; x += stepX) {
        page.drawText(wm.text, {
          x: x - textWidth / 2,
          y,
          size: wm.fontSize,
          font,
          color: rgb(col.r, col.g, col.b),
          opacity: wm.opacity,
          rotate: degrees(wm.angle),
        });
      }
    }
  }

  /**
   * Reconstruct a flow-document model from source PDF text layers for DOCX/MD export.
   * Blank pages and pages without a source are skipped.
   */
  private async _extractFlowDoc(): Promise<FlowDoc> {
    const { documentModel } = this._ctx;
    const flowDoc: FlowDoc = { pages: [] };
    for (const docPage of documentModel.pages) {
      const src = documentModel.sourcePdfs.get(docPage.sourcePdfId);
      if (!src || !docPage.sourcePageNum) continue;
      const page = await src.doc.getPage(docPage.sourcePageNum);

      const [content, opList] = await Promise.all([
        page.getTextContent(),
        page.getOperatorList().catch(() => null),
      ]);

      const items = content.items as RawTextItem[];
      const styles = content.styles as Record<string, { fontFamily?: string }>;

      const fonts: FontInfoMap = {};
      for (const it of items) {
        if (fonts[it.fontName]) continue;
        let realName = it.fontName;
        try {
          const f = page.commonObjs.get(it.fontName) as { name?: string } | null;
          if (f?.name) realName = f.name;
        } catch {
          const psMatch = it.fontName.match(/\+(.+)$/);
          realName = psMatch ? psMatch[1] : it.fontName;
        }
        fonts[it.fontName] = { name: realName, family: styles[it.fontName]?.fontFamily };
      }

      const colorMap = new Map<string, string>();
      if (opList) {
        try {
          const OPS = pdfjsLib.OPS as unknown as Record<string, number>;
          let fillR = 0, fillG = 0, fillB = 0;
          let textMatrix = [1, 0, 0, 1, 0, 0];
          for (let i = 0; i < opList.fnArray.length; i++) {
            const fn = opList.fnArray[i];
            const args = opList.argsArray[i] as number[];
            if (fn === OPS['setFillRGBColor']) {
              [fillR, fillG, fillB] = args;
            } else if (fn === OPS['setFillGray']) {
              fillR = fillG = fillB = args[0];
            } else if (fn === OPS['setFillCMYKColor']) {
              const [c, m, y, k] = args;
              fillR = (1 - c) * (1 - k);
              fillG = (1 - m) * (1 - k);
              fillB = (1 - y) * (1 - k);
            } else if (fn === OPS['setTextMatrix']) {
              textMatrix = args.slice(0, 6);
            } else if (
              fn === OPS['showText'] ||
              fn === OPS['showSpacedText'] ||
              fn === OPS['nextLineShowText'] ||
              fn === OPS['nextLineSetSpacingShowText']
            ) {
              const px = Math.round(textMatrix[4]);
              const py = Math.round(textMatrix[5]);
              if (fillR !== 0 || fillG !== 0 || fillB !== 0) {
                const toHex = (v: number) =>
                  Math.round(Math.max(0, Math.min(255, v * 255)))
                    .toString(16).padStart(2, '0').toUpperCase();
                colorMap.set(`${px},${py}`, toHex(fillR) + toHex(fillG) + toHex(fillB));
              }
            }
          }
        } catch { /* operator list unavailable */ }
      }

      const vp = page.getViewport({ scale: 1 });
      flowDoc.pages.push(reconstructPage(items, fonts, vp.width, vp.height, colorMap));
    }
    assignHeadings(flowDoc);
    return flowDoc;
  }
}
