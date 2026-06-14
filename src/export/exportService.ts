/**
 * ExportService — all PDF/image/docx/markdown export operations extracted from PDFTurboApp.
 *
 * Depends only on IExportContext (the narrow slice of app state it needs), not on the
 * concrete PDFTurboApp class, so it can be tested and evolved independently.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { buildPageOverlays, rasterizePageWithRedactions, type BuildPageCtx } from './exportPipeline';
import { reconstructPage, assignHeadings, pickImageMime, fillOpToHex, type FlowDoc, type FlowImage, type FlowLinkRect, type FontInfoMap, type RawTextItem, type RedactionRect } from '../utils/flowDoc';
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
    const { documentModel, reportError, progress } = this._ctx;
    if (!documentModel.pageCount) return;
    this._ctx.cleanEmptyTextElements();
    const _prog = progress.begin('progress.generatingPdf');
    try {
      const pdfDoc = await this._assemblePdfDoc();
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

  /**
   * Return the current document — every edit, annotation, overlay, redaction,
   * form-fill and watermark baked in — as PDF bytes. Shares downloadPDF()'s
   * assembly pipeline so callers operate on the user's EDITED document, not the
   * raw source. Exposed for the e-signing flow ("sign WITH edits").
   *
   * Encryption is intentionally NOT applied: the signer needs a plain byte
   * stream to compute its /ByteRange, and encrypt-then-sign is out of v1 scope.
   *
   * @throws {Error} when no document is loaded.
   */
  async assemblePdfBytes(): Promise<Uint8Array> {
    if (!this._ctx.documentModel.pageCount) {
      throw new Error('No document loaded to assemble.');
    }
    this._ctx.cleanEmptyTextElements();
    const pdfDoc = await this._assemblePdfDoc();
    return pdfDoc.save({ useObjectStreams: false });
  }

  /** Build the flattened, edits-baked-in pdf-lib document (no save, no encrypt). */
  private async _assemblePdfDoc(): Promise<import('@cantoo/pdf-lib').PDFDocument> {
    const { documentModel, elements, reportError, formValues } = this._ctx;
    const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
    {
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

      return pdfDoc;
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

      const [content, opList, annotations] = await Promise.all([
        page.getTextContent(),
        page.getOperatorList().catch(() => null),
        page.getAnnotations().catch(() => [] as unknown[]),
      ]);

      // Gap 2: Link annotations → hyperlinks. pdf.js gives each Link a `url` and a
      // `rect` [x0,y0,x1,y1] in PDF user space (y-up) — the same space the text
      // item transforms live in, so reconstructPage can bbox-match words to URLs.
      const links: FlowLinkRect[] = (annotations as Array<{ subtype?: string; url?: string; rect?: number[] }>)
        .filter(a => a.subtype === 'Link' && typeof a.url === 'string' && !!a.url && Array.isArray(a.rect) && a.rect.length === 4)
        .map(a => {
          const [rx0, ry0, rx1, ry1] = a.rect as number[];
          return {
            url: a.url as string,
            x0: Math.min(rx0, rx1), y0: Math.min(ry0, ry1),
            x1: Math.max(rx0, rx1), y1: Math.max(ry0, ry1),
          };
        });

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
          // Current text fill color as an uppercase 6-hex string (no '#').
          // pdf.js v6 pre-resolves RGB/Gray/CMYK/Separation/spot color spaces
          // and delivers `setFillRGBColor` with a single "#rrggbb" string arg —
          // `fillOpToHex` normalizes that (and the legacy float shapes).
          let fillHex = '000000';
          // Text matrix (Tm), text-line matrix (Tlm) and leading (TL) — tracked
          // so the fill-color attaches at the SAME position getTextContent will
          // report for each show op. pdf.js v6 packs the Tm as a single
          // Float32Array arg (not 6 scalars), and text is positioned via Td/TD/T*
          // far more often than via Tm — both must be handled or the color key
          // never matches the text item and every colored run silently goes black.
          let textMatrix = [1, 0, 0, 1, 0, 0];
          let textLineMatrix = [1, 0, 0, 1, 0, 0];
          let textLeading = 0;
          const unpackMatrix = (a: unknown[]): number[] => {
            const a0 = a[0];
            const m = (Array.isArray(a0) || ArrayBuffer.isView(a0))
              ? (a0 as ArrayLike<number>)
              : (a as ArrayLike<number>);
            return [Number(m[0]), Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
          };
          // Tlm := [1 0 0 1 tx ty] × Tlm ; Tm := Tlm  (PDF Td/TD/T* semantics).
          const translateTextLine = (tx: number, ty: number) => {
            const [a, b, c, d, e, f] = textLineMatrix;
            textLineMatrix = [a, b, c, d, tx * a + ty * c + e, tx * b + ty * d + f];
            textMatrix = [...textLineMatrix];
          };
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
                // Gap 7: pick PNG vs JPEG. Detect alpha (any non-opaque pixel)
                // so transparent images stay PNG; large opaque rasters become
                // JPEG to avoid multi-MB lossless PNG bloat for scanned photos.
                let hasAlpha = false;
                try {
                  const px = imgCtx.getImageData(0, 0, imgCanvas.width, imgCanvas.height).data;
                  for (let p = 3; p < px.length; p += 4) {
                    if (px[p] < 255) { hasAlpha = true; break; }
                  }
                } catch { hasAlpha = true; /* unreadable/tainted → safe lossless PNG */ }
                const mimeType = pickImageMime({ width: imgData.width, height: imgData.height, hasAlpha });
                const dataUrl = imgCanvas.toDataURL(mimeType, mimeType === 'image/jpeg' ? 0.85 : undefined);
                const base64 = dataUrl.split(',')[1];
                if (base64) {
                  // Axis-aligned: width=|a|, height=|d|; PDF y-up → DOCX y-down
                  const w = Math.abs(ctm[0]) || Math.abs(ctm[2]);
                  const h = Math.abs(ctm[3]) || Math.abs(ctm[1]);
                  if (w > 10 && h > 10) {
                    pageImages.push({
                      x: ctm[4], y: vp.height - ctm[5] - h,
                      width: w, height: h,
                      base64, mimeType,
                    });
                  }
                }
              } catch { /* graceful skip if bitmap unavailable */ }
            } else if (fn === OPS['setFillRGBColor']) {
              fillHex = fillOpToHex('rgb', args as unknown[]) ?? fillHex;
            } else if (fn === OPS['setFillGray']) {
              // Defensive: v6 rewrites gray→setFillRGBColor, kept for resilience.
              fillHex = fillOpToHex('gray', args as unknown[]) ?? fillHex;
            } else if (fn === OPS['setFillCMYKColor']) {
              // Defensive: v6 rewrites cmyk→setFillRGBColor, kept for resilience.
              fillHex = fillOpToHex('cmyk', args as unknown[]) ?? fillHex;
            } else if (fn === OPS['beginText']) {
              textMatrix = [1, 0, 0, 1, 0, 0];
              textLineMatrix = [1, 0, 0, 1, 0, 0];
            } else if (fn === OPS['setTextMatrix']) {
              textMatrix = unpackMatrix(args as unknown[]);
              textLineMatrix = [...textMatrix];
            } else if (fn === OPS['setLeading']) {
              textLeading = Number(args[0]);
            } else if (fn === OPS['moveText']) {
              translateTextLine(Number(args[0]), Number(args[1]));
            } else if (fn === OPS['setLeadingMoveText']) {
              textLeading = -Number(args[1]);
              translateTextLine(Number(args[0]), Number(args[1]));
            } else if (fn === OPS['nextLine']) {
              translateTextLine(0, -textLeading);
            } else if (
              fn === OPS['showText'] ||
              fn === OPS['showSpacedText'] ||
              fn === OPS['nextLineShowText'] ||
              fn === OPS['nextLineSetSpacingShowText']
            ) {
              // ' and " advance to the next line before showing (implicit T*).
              if (fn === OPS['nextLineShowText'] || fn === OPS['nextLineSetSpacingShowText']) {
                translateTextLine(0, -textLeading);
              }
              // Text origin in page user space = Tm translation × CTM, matching
              // the position getTextContent reports for this item.
              const ox = textMatrix[4], oy = textMatrix[5];
              const px = Math.round(ctm[0] * ox + ctm[2] * oy + ctm[4]);
              const py = Math.round(ctm[1] * ox + ctm[3] * oy + ctm[5]);
              // Only record non-black so reconstructPage defaults to black text.
              if (fillHex !== '000000') {
                colorMap.set(`${px},${py}`, fillHex);
              }
            }
          }
        } catch { /* operator list unavailable */ }
      }

      const flowPage = reconstructPage(items, fonts, vp.width, vp.height, colorMap, redactions, links.length ? links : undefined);
      if (pageImages.length > 0) flowPage.images = pageImages;
      flowDoc.pages.push(flowPage);
    }
    assignHeadings(flowDoc);
    return flowDoc;
  }
}
