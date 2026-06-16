/**
 * ExportService — all PDF/image/docx/markdown export operations extracted from PDFTurboApp.
 *
 * Depends only on IExportContext (the narrow slice of app state it needs), not on the
 * concrete PDFTurboApp class, so it can be tested and evolved independently.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { buildPageOverlays, rasterizePageWithRedactions, type BuildPageCtx } from './exportPipeline';
import { reconstructPage, assignHeadings, pickImageMime, decomposeImageCtm, type FlowDoc, type FlowImage, type FlowLinkRect, type FontInfoMap, type RawTextItem, type RedactionRect, type RuleRect } from '../utils/flowDoc';
import { walkPageOps, type ImagePlacement } from './opStreamWalker';
import { encryptPdf } from './encryption';
import { pickSaveTarget, writeToHandle, type SaveTarget } from '../utils/fileSystemAccess';
import { buildTableGrid, gridToCsv, type TableTextItem } from '../utils/tableExtract';
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
    const filename = this._exportBaseName() + '-edited.pdf';
    // #54: acquire the save target within the click's activation window, BEFORE
    // the slow assembly — showSaveFilePicker requires transient user activation.
    // 'cancelled' (user dismissed the dialog) is a silent no-op; 'download' is
    // the fallback for browsers without the File System Access API.
    const target = await pickSaveTarget(filename);
    if (target === 'cancelled') return;
    this._ctx.cleanEmptyTextElements();
    const _prog = progress.begin('progress.generatingPdf');
    try {
      const pdfDoc = await this._assemblePdfDoc(
        (done, total) => _prog.setFraction(total ? done / total : null),
      );
      // Pages assembled; the final save/encrypt step has no page granularity.
      _prog.setFraction(null);
      await this._applyExportPassword(pdfDoc);
      const bytes = await pdfDoc.save({ useObjectStreams: false });
      await this._saveBytesTo(target, bytes, filename);
      if (target === 'download') reportError.info('toast.pdfDownloaded');
      else reportError.info('toast.pdfSaved', { name: target.name });
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
   * Extract the given pages (0-based document indices, in the supplied order)
   * into a new PDF with all edits/overlays baked in, then save it (native picker
   * or download). Out-of-range indices are dropped; empty selection warns. #59.
   */
  async downloadPageRange(indices: number[]): Promise<void> {
    const { documentModel, reportError, progress } = this._ctx;
    const pages = indices
      .map(i => documentModel.pages[i])
      .filter((p): p is NonNullable<typeof p> => !!p);
    if (!pages.length) { reportError.warn('toast.extractNoPages'); return; }
    const filename = `${this._exportBaseName()}-extract.pdf`;
    const target = await pickSaveTarget(filename);
    if (target === 'cancelled') return;
    this._ctx.cleanEmptyTextElements();
    const _prog = progress.begin('progress.generatingPdf');
    try {
      const pdfDoc = await this._assemblePdfDoc(
        (done, total) => _prog.setFraction(total ? done / total : null),
        pages,
      );
      _prog.setFraction(null);
      await this._applyExportPassword(pdfDoc);
      const bytes = await pdfDoc.save({ useObjectStreams: false });
      await this._saveBytesTo(target, bytes, filename);
      if (target === 'download') reportError.info('toast.extractDone', { count: pages.length });
      else reportError.info('toast.pdfSaved', { name: target.name });
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
   * Flatten and save (#62). Like downloadPDF, but flattens EVERY source's
   * AcroForm — not just the ones the user typed into — so all interactive form
   * fields (and their widget annotations) are baked into static page content.
   * The app's own overlay annotations are already baked flat by the overlay
   * pipeline; source markup annotations (notes/stamps authored elsewhere) are a
   * documented ceiling (#62b). Save target acquired pre-assembly (#54 activation).
   */
  async downloadFlattened(): Promise<void> {
    const { documentModel, reportError, progress } = this._ctx;
    if (!documentModel.pageCount) return;
    const filename = this._exportBaseName() + '-flattened.pdf';
    const target = await pickSaveTarget(filename);
    if (target === 'cancelled') return;
    this._ctx.cleanEmptyTextElements();
    const _prog = progress.begin('progress.generatingPdf');
    try {
      const pdfDoc = await this._assemblePdfDoc(
        (done, total) => _prog.setFraction(total ? done / total : null),
        undefined,
        { flattenAllForms: true },
      );
      _prog.setFraction(null);
      await this._applyExportPassword(pdfDoc);
      const bytes = await pdfDoc.save({ useObjectStreams: false });
      await this._saveBytesTo(target, bytes, filename);
      if (target === 'download') reportError.info('toast.flattenDone');
      else reportError.info('toast.pdfSaved', { name: target.name });
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
   * Sanitize the assembled (edits-baked-in) document and download a clean copy:
   * strips /Info metadata, XMP, /OpenAction, /AA, document-level JavaScript and
   * embedded files (see utils/pdfSanitizer). Operates on the share-ready export
   * rather than the raw source, so the downloaded copy carries the user's edits.
   */
  async sanitizeAndDownload(): Promise<void> {
    const { documentModel, reportError, progress } = this._ctx;
    if (!documentModel.pageCount) return;
    const _prog = progress.begin('progress.sanitizing');
    try {
      const assembled = await this.assemblePdfBytes();
      const { sanitizePdf, anyRemoved } = await import('../utils/pdfSanitizer');
      const { bytes, report } = await sanitizePdf(assembled);
      this._downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }), this._exportBaseName() + '-sanitized.pdf');
      if (anyRemoved(report)) {
        reportError.info('toast.sanitized', { count: Object.values(report).filter(Boolean).length });
      } else {
        reportError.info('toast.sanitizeNothing');
      }
      _prog.done();
    } catch (err) {
      reportError.error('toast.sanitizeFailed', err);
      _prog.failed();
    }
  }

  /**
   * Extract a ruled (lattice) table from a page into CSV and download it (#56).
   * Clusters the page's horizontal + vertical grid rules into cells and assigns
   * the page text to them. Warns when no grid is detected. Source-PDF text only;
   * borderless tables are not detected (ceiling). Plain download (CSV is small).
   */
  async exportTableCsv(pageIdx?: number): Promise<void> {
    const { documentModel, reportError, progress } = this._ctx;
    const idx = pageIdx ?? documentModel.currentPageIndex;
    const docPage = documentModel.pages[idx];
    if (!docPage || docPage.sourcePdfId === 'blank') { reportError.warn('toast.noTableFound'); return; }
    const _prog = progress.begin('progress.extractingTable');
    try {
      const data = await this._extractPageTableData(docPage);
      const grid = data ? buildTableGrid(data.hRules, data.vRules, data.items) : null;
      if (!grid) { reportError.warn('toast.noTableFound'); _prog.done(); return; }
      const blob = new Blob([gridToCsv(grid)], { type: 'text/csv;charset=utf-8' });
      this._downloadBlob(blob, `${this._exportBaseName()}-table.csv`);
      reportError.info('toast.tableExtracted', { rows: grid.rows, cols: grid.cols });
      _prog.done();
    } catch (err) {
      reportError.error('toast.tableExtractFailed', err);
      _prog.failed();
    }
  }

  /**
   * Pull a page's table inputs from pdf.js: horizontal + vertical grid rules (the
   * op-walk) and positioned text items (text content, baseline origin in PDF
   * user space, y-up). Returns null when the source/op-list is unavailable.
   */
  private async _extractPageTableData(
    docPage: import('../core/documentModel').DocumentPage,
  ): Promise<{ hRules: RuleRect[]; vRules: RuleRect[]; items: TableTextItem[] } | null> {
    const src = this._ctx.documentModel.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return null;
    const page = await src.doc.getPage(docPage.sourcePageNum);
    const [content, opList] = await Promise.all([
      page.getTextContent(),
      page.getOperatorList().catch(() => null),
    ]);
    if (!opList) return null;
    const ops = walkPageOps(opList, pdfjsLib.OPS as unknown as Record<string, number>);
    const items: TableTextItem[] = (content.items as RawTextItem[])
      .filter(it => typeof it.str === 'string' && it.str.trim().length > 0 && Array.isArray(it.transform))
      .map(it => ({ x: it.transform[4], y: it.transform[5], text: it.str }));
    return { hRules: ops.rules, vRules: ops.vRules, items };
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

  /**
   * Build the flattened, edits-baked-in pdf-lib document (no save, no encrypt).
   * @param onPage optional per-page progress callback (done, total) — used by
   *   downloadPDF to drive the determinate overlay bar; the sign path omits it.
   * @param pagesSubset optional explicit list of pages to include, in output
   *   order (defaults to the whole document). Used by the Extract-pages feature.
   */
  private async _assemblePdfDoc(
    onPage?: (done: number, total: number) => void,
    pagesSubset?: import('../core/documentModel').DocumentPage[],
    opts?: { flattenAllForms?: boolean },
  ): Promise<import('@cantoo/pdf-lib').PDFDocument> {
    const { documentModel, elements, reportError, formValues } = this._ctx;
    const docPages = pagesSubset ?? documentModel.pages;
    const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
    {
      const pdfDoc = await PDFDocument.create();

      // Load each source PDF once
      const srcDocs = new Map<string, import('@cantoo/pdf-lib').PDFDocument>();
      for (const [id, src] of documentModel.sourcePdfs) {
        srcDocs.set(id, await PDFDocument.load(src.bytes));
      }

      // Fill and flatten form fields. By default this only touches sources the
      // user actually typed into (their entries are baked static); with
      // flattenAllForms (#62 — the "Flatten & download" button) EVERY source's
      // form is flattened regardless, so an opened PDF's untouched interactive
      // fields are baked into static content and the export carries no widgets.
      for (const [id, srcDoc] of srcDocs) {
        const vals = formValues[id];
        const hasVals = !!vals && Object.keys(vals).length > 0;
        if (!hasVals && !opts?.flattenAllForms) continue;
        try {
          const form = srcDoc.getForm();
          if (hasVals) {
            for (const [fieldName, value] of Object.entries(vals)) {
              try { form.getTextField(fieldName).setText(value); } catch { /* field missing */ }
            }
          }
          form.flatten();
        } catch { /* no form fields in this source */ }
      }

      // Pre-copy all needed pages from each source (one copyPages call per source)
      const copiedPages = new Map<string, import('@cantoo/pdf-lib').PDFPage>();
      for (const [id, srcDoc] of srcDocs) {
        const indices = [...new Set(
          docPages.filter(p => p.sourcePdfId === id).map(p => p.sourcePageNum - 1)
        )].sort((a, b) => a - b);
        const pages = await pdfDoc.copyPages(srcDoc, indices);
        indices.forEach((idx: number, i: number) => copiedPages.set(`${id}:${idx}`, pages[i]));
      }

      // Add pages in document order and draw overlays
      const totalPages = docPages.length;
      let pagesDone = 0;
      for (const docPage of docPages) {
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
        } else if (hasRedaction) {
          const srcDoc = srcDocs.get(docPage.sourcePdfId);
          if (srcDoc) {
            await rasterizePageWithRedactions(srcDoc, docPage, pageElements, pdfDoc, { rgb, StandardFonts, degrees }, documentModel.watermark, this._ctx.inkLayer, reportError);
          }
        } else {
          const key = `${docPage.sourcePdfId}:${docPage.sourcePageNum - 1}`;
          const page = copiedPages.get(key);
          if (page) {
            pdfDoc.addPage(page);
            await this._applyOverlaysToPage(pdfDoc, page, docPage, pageElements, { rgb, degrees, StandardFonts });
          }
        }
        onPage?.(++pagesDone, totalPages);
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

  /**
   * Write already-serialized PDF bytes to a resolved save target (#54): a file
   * handle (native save) or the anchor download. `target` must not be 'cancelled'
   * (callers handle that earlier). Returns which path was taken so the caller can
   * pick the right toast by branching on `target` themselves (which narrows it).
   */
  private async _saveBytesTo(target: Exclude<SaveTarget, 'cancelled'>, bytes: Uint8Array, filename: string): Promise<void> {
    if (target === 'download') {
      this._downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }), filename);
    } else {
      await writeToHandle(target, bytes);
    }
  }

  private _downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private async _applyExportPassword(pdfDoc: BuildPageCtx['pdfDoc']): Promise<void> {
    const pw = this._ctx.exportPassword;
    if (!pw) return;
    // CORE-P0-2: AES-256 + full usage permissions (see export/encryption.ts).
    await encryptPdf(pdfDoc, { userPassword: pw.user, ownerPassword: pw.owner });
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
    await this._applyExportPassword(pdfDoc);
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
      // export (DOCX/MD/TXT). Rects live in editor DISPLAYED space (top-left origin,
      // rotated orientation); reconstructPage un-rotates them via `totalRot` so they
      // match pdf.js's UNROTATED content-space text items (CORE-P0-1 — without this,
      // redacted text leaked on rotated pages). The raster PDF path is unaffected.
      const totalRot = (((page.rotate ?? 0) + (docPage.rotation ?? 0)) % 360 + 360) % 360;
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
      let colorMap = new Map<string, string>();
      let pageRules: RuleRect[] = [];
      const pageImages: FlowImage[] = [];

      if (opList) {
        // Pure operator-list walk → text colors, rules, image placements (M2 #22).
        const OPS = pdfjsLib.OPS as unknown as Record<string, number>;
        const ops = walkPageOps(opList, OPS);
        colorMap = ops.colorMap;
        pageRules = ops.rules;
        if (ops.images.length > 0) {
          // Render off-screen so pdfjs-dist v6 commits all image XObjects to
          // page.objs before we read them. Without this, page.objs is empty on
          // pages that have never been displayed (bitmap data arrives via async
          // worker messages only while an intent state is active).
          const renderCanvas = document.createElement('canvas');
          renderCanvas.width = Math.ceil(vp.width);
          renderCanvas.height = Math.ceil(vp.height);
          const renderCtx = renderCanvas.getContext('2d');
          if (renderCtx) {
            await page.render({ canvas: renderCanvas, canvasContext: renderCtx, viewport: vp }).promise;
          }
          for (const placement of ops.images) {
            const img = this._rasterizeImagePlacement(page, placement, vp.height);
            if (img) pageImages.push(img);
          }
        }
      }

      const flowPage = reconstructPage(items, fonts, vp.width, vp.height, colorMap, redactions, links.length ? links : undefined, pageRules.length ? pageRules : undefined, totalRot);
      if (pageImages.length > 0) flowPage.images = pageImages;
      flowDoc.pages.push(flowPage);
    }
    assignHeadings(flowDoc);
    return flowDoc;
  }

  /**
   * Rasterize one image-XObject placement (from walkPageOps) into a FlowImage:
   * resolve its bitmap from page.objs / commonObjs, draw it, pick PNG vs JPEG by
   * alpha + size (Gap 7), and decompose the draw CTM for true on-page size +
   * rotation (Gap d). Returns null when the bitmap is unavailable or sub-10pt.
   * DOM-dependent (canvas) — the impure complement to the pure walkPageOps.
   */
  private _rasterizeImagePlacement(
    page: { objs: { has(id: string): boolean; get(id: string): unknown }; commonObjs: { has(id: string): boolean; get(id: string): unknown } },
    placement: ImagePlacement,
    viewportHeight: number,
  ): FlowImage | null {
    const { name: imageName, ctm } = placement;
    try {
      // Images reused across ≥2 pages are promoted by pdf.js's GlobalImageCache to
      // the document-global `commonObjs` store with a `g_`-prefixed name; page-local
      // images stay in `page.objs`. Resolve from whichever store holds this name —
      // reading the wrong store throws and silently drops the image.
      const store = imageName.startsWith('g_') ? page.commonObjs : page.objs;
      if (!store.has(imageName)) return null;
      const imgData = store.get(imageName) as { width: number; height: number; bitmap?: CanvasImageSource } | null;
      if (!imgData?.bitmap) return null;
      const imgCanvas = document.createElement('canvas');
      imgCanvas.width = imgData.width;
      imgCanvas.height = imgData.height;
      const imgCtx = imgCanvas.getContext('2d');
      if (!imgCtx) return null;
      imgCtx.drawImage(imgData.bitmap, 0, 0);
      // Gap 7: pick PNG vs JPEG. Detect alpha (any non-opaque pixel) so transparent
      // images stay PNG; large opaque rasters become JPEG to avoid multi-MB
      // lossless PNG bloat for scanned photos.
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
      if (!base64) return null;
      // Decompose scale + rotation from the draw CTM. For axis-aligned images this
      // reduces to width=|a|, height=|d|; for rotated ones it recovers the true
      // on-page size AND the rotation angle (was silently dropped — Gap d).
      const { scaleX, scaleY, rotation } = decomposeImageCtm(ctm);
      const w = scaleX, h = scaleY;
      if (w <= 10 || h <= 10) return null;
      const img: FlowImage = {
        x: ctm[4], y: viewportHeight - ctm[5] - h,
        width: w, height: h,
        base64, mimeType,
      };
      // Snap near-zero noise to 0; store only meaningful rotation.
      if (rotation > 0.5 && rotation < 359.5) img.rotation = Math.round(rotation);
      return img;
    } catch {
      return null; // graceful skip if bitmap unavailable
    }
  }
}
