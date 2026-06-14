/**
 * ExportService — all PDF/image/docx/markdown export operations extracted from PDFTurboApp.
 *
 * Depends only on IExportContext (the narrow slice of app state it needs), not on the
 * concrete PDFTurboApp class, so it can be tested and evolved independently.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { buildPageOverlays, rasterizePageWithRedactions, type BuildPageCtx } from './exportPipeline';
import { reconstructPage, assignHeadings, type FlowDoc, type FlowImage, type FontInfoMap, type RawTextItem, type RedactionRect } from '../utils/flowDoc';
import { flowDocToDocxBlob, flowDocToMarkdown } from '../utils/flowDocWriters';
import type { PDFElement } from '../elements/annotationElement';
import type { DocumentModel } from '../core/documentModel';
import type { InkLayer } from '../infra/inkLayer';
import type { IErrorReporter } from '../core/errorReporter';
import type { IProgressManager } from '../ui/progressManager';

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
          await buildPageOverlays({
            pdfDoc, page: blankPage, docPage,
            elements: pageElements,
            pdfLib: { rgb, degrees, StandardFonts },
            userRot: 0, sourceRot: 0,
            watermark: documentModel.watermark,
            inkLayer: this._ctx.inkLayer,
            reportError,
          });
          continue;
        }

        if (hasRedaction) {
          const srcDoc = srcDocs.get(docPage.sourcePdfId);
          if (srcDoc) {
            await rasterizePageWithRedactions(srcDoc, docPage, pageElements, pdfDoc, { rgb, StandardFonts, degrees }, documentModel.watermark, this._ctx.inkLayer, reportError);
          }
          continue;
        }

        const key = `${docPage.sourcePdfId}:${docPage.sourcePageNum - 1}`;
        const page = copiedPages.get(key);
        if (!page) continue;
        pdfDoc.addPage(page);

        await this._applyOverlaysToPage(pdfDoc, page, docPage, pageElements, { rgb, degrees, StandardFonts });
      }

      await this._savePdfDocAndDownload(pdfDoc, this._exportBaseName() + '-edited.pdf');
      reportError.info('toast.pdfDownloaded');
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
        await rasterizePageWithRedactions(srcDocLib, docPage, pageElements, pdfDoc, { rgb, StandardFonts, degrees }, documentModel.watermark, this._ctx.inkLayer, reportError);
      } else {
        const [page] = await pdfDoc.copyPages(srcDocLib, [docPage.sourcePageNum - 1]);
        pdfDoc.addPage(page);
        await this._applyOverlaysToPage(pdfDoc, page, docPage, pageElements, { rgb, degrees, StandardFonts });
      }

      await this._savePdfDocAndDownload(pdfDoc, `${this._exportBaseName()}-page${pageIdx + 1}.pdf`);
      reportError.info('toast.pageDownloaded', { page: pageIdx + 1 });
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

      const pageElements = elements.filter(el => el.pageId === docPage.id);
      await this._applyOverlaysToPage(pdfDoc, page, docPage, pageElements, { rgb, degrees, StandardFonts });

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
        this._downloadBlob(blob, `${this._exportBaseName()}-page${idx + 1}.png`);
        reportError.info('toast.imageExported', { page: idx + 1 });
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
      // Emit a DOCX when there is text OR images. Only a document with neither
      // (e.g. a scanned PDF before OCR) is rejected — and even then with a
      // visible toast, never a silent no-op.
      const hasContent = flowDoc.pages.some(
        p => p.paragraphs.length > 0 || (p.images?.length ?? 0) > 0,
      );
      if (!hasContent) {
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

  private async _applyOverlaysToPage(
    pdfDoc: BuildPageCtx['pdfDoc'],
    page: BuildPageCtx['page'],
    docPage: BuildPageCtx['docPage'],
    pageElements: BuildPageCtx['elements'],
    pdfLib: BuildPageCtx['pdfLib'],
  ): Promise<void> {
    await buildPageOverlays({
      pdfDoc, page, docPage,
      elements: pageElements,
      pdfLib,
      userRot: docPage.rotation ?? 0,
      sourceRot: page.getRotation().angle as number,
      watermark: this._ctx.documentModel.watermark,
      inkLayer: this._ctx.inkLayer,
      reportError: this._ctx.reportError,
    });
  }

  private async _savePdfDocAndDownload(pdfDoc: BuildPageCtx['pdfDoc'], filename: string): Promise<void> {
    this._applyExportPassword(pdfDoc);
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    this._downloadBlob(new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' }), filename);
  }

  /**
   * Reconstruct a flow-document model from source PDF text layers for DOCX/MD export.
   * Blank pages and pages without a source are skipped.
   */
  private async _extractFlowDoc(): Promise<FlowDoc> {
    const { documentModel, elements } = this._ctx;
    const flowDoc: FlowDoc = { pages: [] };
    for (const docPage of documentModel.pages) {
      const src = documentModel.sourcePdfs.get(docPage.sourcePdfId);
      if (!src || !docPage.sourcePageNum) continue;
      const page = await src.doc.getPage(docPage.sourcePageNum);

      // Redaction-aware extraction: drop any source text item that sits under a
      // redaction box on this page so redacted text never leaks into the flow
      // export (DOCX/MD/TXT). Rects are in editor space (top-left origin), the
      // same space rasterizePageWithRedactions fills for the PDF export path.
      const redactions: RedactionRect[] = elements
        .filter(el => el.pageId === docPage.id && el.type === 'redaction')
        .map(el => ({ x: el.x, y: el.y, width: el.width, height: el.height }));

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

      const vp = page.getViewport({ scale: 1 });
      const colorMap = new Map<string, string>();
      const pageImages: FlowImage[] = [];

      if (opList) {
        try {
          const OPS = pdfjsLib.OPS as unknown as Record<string, number>;
          let fillR = 0, fillG = 0, fillB = 0;
          let textMatrix = [1, 0, 0, 1, 0, 0];
          // CTM stack for image position/size extraction (q/Q/cm operators)
          type Ctm = [number, number, number, number, number, number];
          const ctmStack: Ctm[] = [];
          let ctm: Ctm = [1, 0, 0, 1, 0, 0];
          // Render off-screen so pdfjs-dist v6 commits all image XObjects to
          // page.objs before we iterate. Without this, page.objs is empty on
          // pages that have never been displayed (bitmap data arrives via async
          // worker messages only while an intent state is active).
          if (opList.fnArray.includes(OPS['paintImageXObject'])) {
            const renderCanvas = document.createElement('canvas');
            renderCanvas.width = Math.ceil(vp.width);
            renderCanvas.height = Math.ceil(vp.height);
            const renderCtx = renderCanvas.getContext('2d');
            if (renderCtx) {
              await page.render({ canvas: renderCanvas, canvasContext: renderCtx, viewport: vp }).promise;
            }
          }
          for (let i = 0; i < opList.fnArray.length; i++) {
            const fn = opList.fnArray[i];
            const args = opList.argsArray[i] as number[];
            if (fn === OPS['save']) {
              ctmStack.push([...ctm] as Ctm);
            } else if (fn === OPS['restore']) {
              const prev = ctmStack.pop();
              if (prev) ctm = prev;
            } else if (fn === OPS['transform']) {
              const [a, b, c, d, e, f] = args;
              ctm = [
                ctm[0]*a + ctm[2]*b, ctm[1]*a + ctm[3]*b,
                ctm[0]*c + ctm[2]*d, ctm[1]*c + ctm[3]*d,
                ctm[0]*e + ctm[2]*f + ctm[4], ctm[1]*e + ctm[3]*f + ctm[5],
              ];
            } else if (fn === OPS['paintImageXObject']) {
              const imageName = args[0] as unknown as string;
              try {
                // Images reused across ≥2 pages are promoted by pdf.js's
                // GlobalImageCache to the document-global `commonObjs` store with
                // a `g_`-prefixed name; page-local images stay in `page.objs`.
                // Resolve from whichever store actually holds this name —
                // reading the wrong store throws and silently drops the image.
                const store = (imageName.startsWith('g_') ? page.commonObjs : page.objs) as {
                  has(id: string): boolean;
                  get(id: string): unknown;
                };
                if (!store.has(imageName)) continue;
                const imgData = store.get(imageName) as { width: number; height: number; bitmap?: CanvasImageSource } | null;
                if (!imgData?.bitmap) continue;
                const imgCanvas = document.createElement('canvas');
                imgCanvas.width = imgData.width;
                imgCanvas.height = imgData.height;
                const imgCtx = imgCanvas.getContext('2d');
                if (!imgCtx) continue;
                imgCtx.drawImage(imgData.bitmap, 0, 0);
                const dataUrl = imgCanvas.toDataURL('image/png');
                const base64 = dataUrl.split(',')[1];
                if (base64) {
                  // Axis-aligned: width=|a|, height=|d|; PDF y-up → DOCX y-down
                  const w = Math.abs(ctm[0]) || Math.abs(ctm[2]);
                  const h = Math.abs(ctm[3]) || Math.abs(ctm[1]);
                  if (w > 10 && h > 10) {
                    pageImages.push({
                      x: ctm[4], y: vp.height - ctm[5] - h,
                      width: w, height: h,
                      base64, mimeType: 'image/png',
                    });
                  }
                }
              } catch { /* graceful skip if bitmap unavailable */ }
            } else if (fn === OPS['setFillRGBColor']) {
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

      const flowPage = reconstructPage(items, fonts, vp.width, vp.height, colorMap, redactions);
      if (pageImages.length > 0) flowPage.images = pageImages;
      flowDoc.pages.push(flowPage);
    }
    assignHeadings(flowDoc);
    return flowDoc;
  }
}
