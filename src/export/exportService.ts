/**
 * ExportService — all PDF/image/docx/markdown export operations extracted from PDFTurboApp.
 *
 * Depends only on IExportContext (the narrow slice of app state it needs), not on the
 * concrete PDFTurboApp class, so it can be tested and evolved independently.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { buildPageOverlays, rasterizePageWithRedactions, stripRedactedAnnotations, getPageCropBox, type BuildPageCtx } from './exportPipeline';
import { reconstructPage, translateItemsToCropOrigin, assignHeadings, flattenOutline, applyRepeatedBands, pickImageMime, decomposeImageCtm, textElementsToFlowParagraphs, ocrTextToFlowDoc, interleaveByReadingOrder, isItemRedacted, type FlowDoc, type FlowImage, type FlowLinkRect, type FontInfoMap, type MarkedContentMarker, type OverlayTextLike, type RawTextItem, type RedactionRect, type RuleRect, type StructTreeNodeLike } from '../utils/flowDoc';
import { redactionRectToPageSpace, rotatedElementFootprint, type RotatableRect } from '../utils/geometry';
import { walkPageOps, type ImagePlacement } from './opStreamWalker';
import { encryptPdf } from './encryption';
import { pickSaveTarget, writeToHandle, type SaveTarget, type SaveFileType } from '../utils/fileSystemAccess';
import { buildTableGrid, gridToCsv, type TableGrid, type TableTextItem } from '../utils/tableExtract';
import { inferBorderlessGrid } from '../utils/borderlessTable';
import { stripDocMetadata, dpiToScale, clampQuality, COMPRESS_DPI_DEFAULT, COMPRESS_QUALITY_DEFAULT, type CompressOptions } from './compress';
import { buildXfdf, type XfdfAnnot } from '../utils/xfdf';
import { elementToXfdfAnnot, pageHeightPt } from './xfdfMapping';
import { flowDocToDocxBlob, flowDocToMarkdown } from '../utils/flowDocWriters';
import { PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFTextField, type PDFForm } from '@cantoo/pdf-lib';
import type { PDFElement } from '../elements/annotationElement';
import type { TextElement } from '../elements/textElement';
import type { DocumentModel, DocumentPage } from '../core/documentModel';
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

// ── Form-field fill (G14) ──────────────────────────────────────────────────

/**
 * Apply one persisted form value to its AcroForm field, dispatching on the
 * field's actual pdf-lib type (the value store is type-blind: a flat
 * `fieldName → string` map, no schema). String encoding per type:
 *   - text     : the raw string                               → setText
 *   - checkbox : the field's on-value when ticked, "" untick   → check / uncheck
 *   - radio    : the selected option's export (button) value   → select
 *   - dropdown : the selected export value                      → select
 *   - listbox  : selected export values joined by "\n" (multi)  → select([...])
 *
 * A name that does not resolve to a field (getField throws), or a field type
 * the lib cannot fill, is a silent no-op — never throws, never drops a value
 * onto the wrong field. Push-buttons and signatures carry no fillable value, so
 * they fall through here (and are excluded from the interactive overlay too).
 */
export function applyFormFieldValue(form: PDFForm, fieldName: string, value: string): boolean {
  let field;
  try {
    field = form.getField(fieldName);
  } catch {
    return true; // field missing in this source — there is no value to drop
  }
  try {
    if (field instanceof PDFTextField) {
      field.setText(value);
    } else if (field instanceof PDFCheckBox) {
      if (value) field.check();
      else field.uncheck();
    } else if (field instanceof PDFRadioGroup) {
      if (value) field.select(value);
      else field.clear();
    } else if (field instanceof PDFDropdown) {
      if (value) field.select(value);
      else field.clear();
    } else if (field instanceof PDFOptionList) {
      const opts = value === '' ? [] : value.split('\n');
      if (opts.length > 0) field.select(opts);
      else field.clear();
    }
    // else: push-button / signature / unknown — no fillable value.
    return true;
  } catch {
    // B1: a value that doesn't match the field's options (stale option, type
    // mismatch) must not abort the whole export — skip just this field, but
    // return false so the caller can surface the silently-dropped value.
    return false;
  }
}

// ── Save file types (#54/G19) ──────────────────────────────────────────────
// Advertised in the native Save dialog's type filter + reused as the Blob MIME
// for the anchor-download fallback, so every export path carries the right
// extension whichever save route the browser takes.
const SAVE_PDF: SaveFileType = { description: 'PDF document', mime: 'application/pdf', ext: '.pdf' };
const SAVE_PNG: SaveFileType = { description: 'PNG image', mime: 'image/png', ext: '.png' };
const SAVE_JPG: SaveFileType = { description: 'JPEG image', mime: 'image/jpeg', ext: '.jpg' };
const SAVE_CSV: SaveFileType = { description: 'CSV spreadsheet', mime: 'text/csv', ext: '.csv' };
const SAVE_XLSX: SaveFileType = {
  description: 'Excel workbook',
  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ext: '.xlsx',
};

// ── Page-image export options (G20) ────────────────────────────────────────
export type ImageExportFormat = 'png' | 'jpeg';
export interface ImageExportOptions {
  /** Render scale → resolution. 2 ≈ 144 DPI (the historic default). Clamped to [1, 6] (~72–432 DPI). */
  scale?: number;
  /** Output encoding. 'png' (lossless, default) or 'jpeg' (smaller). */
  format?: ImageExportFormat;
  /** JPEG quality, ignored for PNG. Clamped to [0.5, 1]. Default 0.92. */
  quality?: number;
}
const IMG_SCALE_MIN = 1;
const IMG_SCALE_MAX = 6;
const IMG_QUALITY_MIN = 0.5;
const IMG_QUALITY_MAX = 1;
const IMG_DEFAULTS: Required<ImageExportOptions> = { scale: 2, format: 'png', quality: 0.92 };

/**
 * Drop every non-redaction element whose box intersects a redaction on the same page, keeping the
 * redactions themselves. Used for BLANK pages, which have no source document to rasterise, so this is
 * the only way a redaction there can actually REMOVE rather than merely cover (see the call site).
 *
 * Intersection, not containment: a word only partly under the box still has part of itself hidden, so
 * leaving it would leak that part — the same rule `isItemRedacted` applies to source text.
 *
 * Both sides are tested by {@link rotatedElementFootprint}, not by the stored box: an element's own
 * `rotation` is applied when it is DRAWN but was not applied when it was TESTED until WS4-B, so a
 * rotated element could protrude into a redaction — or a rotated redaction cover an element — with
 * neither side noticing. That helper also does the negative-extent normalisation this used to do
 * inline (a negative width/height is reachable via `interactionHandler.resize` and would make the
 * raw comparisons fail OPEN).
 * Exported for direct testing; the geometry is trivial but the SAFETY depends on it.
 */
/**
 * Does a source image XObject placement fall under a redaction, and so have to be kept out of the
 * flow (DOCX/MD/TXT) export?
 *
 * `ctm` is the placement's draw matrix from `walkPageOps`; `redactions` and `pageTopY` must both
 * come from {@link redactionRectToPageSpace} / the page's `viewBox[3]`, i.e. x in absolute user
 * space and y measured down from the crop top.
 *
 * Exported for direct testing. Trivial geometry, but the SAFETY depends on it — the same reason
 * {@link dropElementsUnderRedactions} is exported.
 */
export function imagePlacementRedacted(
  ctm: readonly number[],
  redactions: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
  pageTopY: number,
): boolean {
  if (redactions.length === 0) return false;
  const [a, b, c, d, e, f] = ctm;
  // PDF paints an image XObject through the UNIT SQUARE, so the true footprint is that square
  // under the CTM. All four corners are transformed rather than reading |a|/|d| as the size:
  // for a rotated or sheared placement an |a|/|d| box is too SMALL, and under-dropping is the
  // one direction a leak filter must never err in. Over-approximating is safe here.
  const xs = [e, a + e, c + e, a + c + e];
  const ys = [f, b + f, d + f, b + d + f];
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  // y-up user space → y-down from the crop top, matching the redaction rects' convention.
  const yTop = pageTopY - Math.max(...ys), yBot = pageTopY - Math.min(...ys);
  return redactions.some(r =>
    x0 < r.x + r.width && x1 > r.x && yTop < r.y + r.height && yBot > r.y);
}

export function dropElementsUnderRedactions(pageElements: PDFElement[]): PDFElement[] {
  const reds = pageElements.filter(el => el.type === 'redaction');
  if (reds.length === 0) return pageElements;
  // NORMALISE before testing. A negative width/height is reachable (`interactionHandler.resize` can
  // produce one when an element sits past the canvas edge) and would make the raw comparisons FAIL OPEN —
  // the footprint genuinely overlaps, yet the element is kept and drawn as live text. Same defect shape as
  // the `#bg-fill` negative-height rect in § Gotchas, so it gets the same treatment.
  // WS4-B — the footprint, not the stored box: an element's `rotation` is applied when it is
  // drawn but was never applied when it was tested, so a rotated element could protrude into a
  // redaction (or a rotated redaction could cover an element) with neither side noticing.
  // `rotatedElementFootprint` also does the negative-extent normalisation this used to do inline.
  const box = (e: RotatableRect) => {
    const f = rotatedElementFootprint(e);
    return { x0: f.x, x1: f.x + f.width, y0: f.y, y1: f.y + f.height };
  };
  const redBoxes = reds.map(box);
  return pageElements.filter((el) => {
    if (el.type === 'redaction') return true;
    const e = box(el);
    return !redBoxes.some(r => e.x0 < r.x1 && e.x1 > r.x0 && e.y0 < r.y1 && e.y1 > r.y0);
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Human-readable byte size for toast messages (e.g. "1.2 MB", "840 KB"). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Encode a canvas as JPEG bytes at the given quality (#60 lossy compress). */
function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) { reject(new Error('JPEG encode failed')); return; }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(reject);
      },
      'image/jpeg',
      quality,
    );
  });
}
const SAVE_DOCX: SaveFileType = {
  description: 'Word document',
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ext: '.docx',
};

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
        undefined,
        { cleanMetadata: true },
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
        { cleanMetadata: true },
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
        { flattenAllForms: true, cleanMetadata: true },
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
    const filename = this._exportBaseName() + '-sanitized.pdf';
    // #54: pick the save target BEFORE assembling + sanitizing (both async).
    const target = await pickSaveTarget(filename, SAVE_PDF);
    if (target === 'cancelled') return;
    const _prog = progress.begin('progress.sanitizing');
    try {
      const assembled = await this.assemblePdfBytes();
      const { sanitizePdf, anyRemoved } = await import('../utils/pdfSanitizer');
      const { bytes, report } = await sanitizePdf(assembled);
      await this._saveOrDownload(target, bytes, filename, 'application/pdf');
      if (target !== 'download') {
        reportError.info('toast.pdfSaved', { name: target.name });
      } else if (anyRemoved(report)) {
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
   * Compress the assembled (edits-baked-in) document and save a smaller copy (#60).
   *
   *  - LOSSLESS "quick optimize" — re-serialize with object streams + strip /Info
   *    and XMP metadata. Selectable text / vectors / form fields survive.
   *  - LOSSY "flatten to images" — render each page to a JPEG at the chosen
   *    DPI/quality and rebuild an image-only PDF. Big win on scans; selectable text
   *    is dropped (a documented trade-off shown in the modal).
   *
   * Operates on `assemblePdfBytes()` so the user's edits are baked in first. The
   * export password (if set) is applied to the SAME save as the object-stream
   * optimization, so encrypting never undoes the size win. Save target is acquired
   * BEFORE the async assembly (#54 transient-activation).
   */
  async compressAndDownload(opts: CompressOptions): Promise<void> {
    const { documentModel, reportError, progress } = this._ctx;
    if (!documentModel.pageCount) return;
    const filename = this._exportBaseName() + '-compressed.pdf';
    const target = await pickSaveTarget(filename, SAVE_PDF);
    if (target === 'cancelled') return;
    const _prog = progress.begin('progress.compressing');
    try {
      const assembled = await this.assemblePdfBytes();
      const out = opts.mode === 'lossy'
        ? await this._compressLossy(assembled, opts, (d, t) => _prog.setFraction(t ? d / t : null))
        : await this._compressLossless(assembled);
      _prog.setFraction(null);
      await this._saveOrDownload(target, out, filename, 'application/pdf');
      const saved = assembled.length - out.length;
      if (target !== 'download') {
        reportError.info('toast.pdfSaved', { name: target.name });
      } else if (saved > 0) {
        reportError.info('toast.compressDone', { size: formatBytes(out.length), percent: Math.round((saved / assembled.length) * 100) });
      } else {
        reportError.info('toast.compressNoGain', { size: formatBytes(out.length) });
      }
      _prog.done();
    } catch (err) {
      reportError.error('toast.compressFailed', err);
      _prog.failed();
    } finally {
      await this._ctx.renderCurrentPage();
      this._ctx.rebuildElementLayer();
    }
  }

  /**
   * Lossless re-serialize: strip metadata + write object streams, applying the
   * export password (if any) to the same save so the encryption doesn't undo the
   * size win. Loads with updateMetadata:false to avoid pdf-lib's load-time
   * Producer/ModDate re-stamp (which would re-inject the metadata we strip).
   */
  private async _compressLossless(assembled: Uint8Array): Promise<Uint8Array> {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.load(assembled, { updateMetadata: false });
    await stripDocMetadata(doc);
    await this._applyExportPassword(doc);
    return doc.save({ useObjectStreams: true });
  }

  /**
   * Lossy "flatten to images": rasterize every page of the assembled PDF to a
   * JPEG at the requested DPI (pdf.js viewport honours page rotation, so the
   * raster is already correctly oriented) and rebuild an image-only PDF whose
   * pages keep their original point dimensions. Selectable text is dropped. The
   * temporary pdf.js doc is destroyed so the worker doesn't leak.
   */
  private async _compressLossy(
    assembled: Uint8Array,
    opts: CompressOptions,
    onPage: (done: number, total: number) => void,
  ): Promise<Uint8Array> {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const scale = dpiToScale(opts.dpi ?? COMPRESS_DPI_DEFAULT);
    const quality = clampQuality(opts.quality ?? COMPRESS_QUALITY_DEFAULT);
    let renderDoc: pdfjsLib.PDFDocumentProxy | undefined;
    try {
      renderDoc = await pdfjsLib.getDocument({ data: assembled }).promise;
      const out = await PDFDocument.create();
      const total = renderDoc.numPages;
      for (let i = 1; i <= total; i++) {
        const page = await renderDoc.getPage(i);
        const ptVp = page.getViewport({ scale: 1 });        // page size in points
        const vp = page.getViewport({ scale });             // raster resolution
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(vp.width));
        canvas.height = Math.max(1, Math.round(vp.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas unavailable for compression raster');
        await page.render({ canvas, viewport: vp }).promise;
        const jpeg = await canvasToJpegBytes(canvas, quality);
        const img = await out.embedJpg(jpeg);
        const p = out.addPage([ptVp.width, ptVp.height]);
        p.drawImage(img, { x: 0, y: 0, width: ptVp.width, height: ptVp.height });
        onPage(i, total);
      }
      await this._applyExportPassword(out);
      return out.save({ useObjectStreams: true });
    } finally {
      const task = (renderDoc as { loadingTask?: { destroy?: () => Promise<void> } } | undefined)?.loadingTask;
      if (task && typeof task.destroy === 'function') void task.destroy().catch(() => {});
    }
  }

  /**
   * Export the document's annotations as an Adobe XFDF file (#57) — shareable
   * markup without the PDF, round-trippable with Acrobat. Walks every page,
   * converts each supported element (highlight / comment / text) from editor
   * display space to PDF user space (per-page y-flip), and downloads a plain
   * `.xfdf`. Unsupported element types are skipped; a document with no
   * exportable annotation warns rather than emitting an empty file.
   */
  async exportXfdf(): Promise<void> {
    const { documentModel, elements, reportError } = this._ctx;
    if (!documentModel.pageCount) return;
    try {
      const annots: XfdfAnnot[] = [];
      for (let i = 0; i < documentModel.pages.length; i++) {
        const docPage = documentModel.pages[i];
        // Redacted overlays are dropped here too: an XFDF carries the annotation's TEXT, so exporting a
        // comment or text box the user had covered would hand it back in a plain-text sidecar file.
        const pageEls = dropElementsUnderRedactions(elements.filter(el => el.pageId === docPage.id));
        if (!pageEls.length) continue;
        const h = await pageHeightPt(docPage, documentModel.sourcePdfs);
        for (const el of pageEls) {
          const a = elementToXfdfAnnot(el.toJSON(), i, h);
          if (a) annots.push(a);
        }
      }
      if (!annots.length) { reportError.warn('toast.xfdfNoAnnots'); return; }
      const xml = buildXfdf(annots);
      this._downloadBlob(new Blob([xml], { type: 'application/vnd.adobe.xfdf' }), this._exportBaseName() + '.xfdf');
      reportError.info('toast.xfdfExported', { count: annots.length });
    } catch (err) {
      reportError.error('toast.exportFailed', err);
    }
  }

  /**
   * Resolve a page's table grid: ruled (lattice) FIRST, then whitespace inference (EH-E).
   *
   * The precedence lives HERE and nowhere else, so CSV and XLSX can never drift apart — this repo has
   * been bitten by triplicated export logic before (see CLAUDE.md § Export paths are consolidated).
   * Lattice first means a ruled table's output is byte-identical to before EH-E; the borderless
   * detector runs only where the answer would otherwise be "no table found", and refuses rather than
   * guesses (`src/utils/borderlessTable.ts`). That fallback is acceptable on these two exports because
   * the user explicitly asked for a table by invoking them, and is deliberately NOT in the DOCX flow,
   * where a false positive would silently turn prose into a table.
   */
  private async _resolveTableGrid(docPage: DocumentPage): Promise<TableGrid | null> {
    const data = await this._extractPageTableData(docPage);
    if (!data) return null;
    return buildTableGrid(data.hRules, data.vRules, data.items) ?? inferBorderlessGrid(data.items);
  }

  /**
   * Extract a table from a page into a real .xlsx workbook and download it (#56b). Same detection as
   * the CSV export; the difference is on the way out — numeric cells become actual numbers, so the
   * result can be summed instead of merely read. No new dependency: XLSX is OPC, and this repo already
   * writes OPC zips with fflate (`src/export/xlsxWriter.ts`, dynamically imported to keep it lazy).
   */
  async exportTableXlsx(pageIdx?: number): Promise<void> {
    const { documentModel, reportError, progress } = this._ctx;
    const idx = pageIdx ?? documentModel.currentPageIndex;
    const docPage = documentModel.pages[idx];
    if (!docPage || docPage.sourcePdfId === 'blank') { reportError.warn('toast.noTableFound'); return; }
    const filename = `${this._exportBaseName()}-table.xlsx`;
    // #54: acquire the picker BEFORE the async extraction, inside the transient-activation window.
    const target = await pickSaveTarget(filename, SAVE_XLSX);
    if (target === 'cancelled') return;
    const _prog = progress.begin('progress.extractingTable');
    try {
      const grid = await this._resolveTableGrid(docPage);
      if (!grid) { reportError.warn('toast.noTableFound'); _prog.done(); return; }
      const { buildXlsxBytes } = await import('./xlsxWriter');
      const bytes = await buildXlsxBytes(grid);
      const blob = new Blob([bytes as BlobPart], { type: SAVE_XLSX.mime });
      await this._saveOrDownload(target, blob, filename, SAVE_XLSX.mime);
      if (target === 'download') reportError.info('toast.tableExtracted', { rows: grid.rows, cols: grid.cols });
      else reportError.info('toast.pdfSaved', { name: target.name });
      _prog.done();
    } catch (err) {
      reportError.error('toast.tableExtractFailed', err);
      _prog.failed();
    }
  }

  /**
   * Extract a table from a page into CSV and download it (#56). Clusters the page's horizontal +
   * vertical grid rules into cells and assigns the page text to them; when there is no ruled grid,
   * falls back to whitespace inference (EH-E, `borderlessTable.ts`), which refuses rather than guesses.
   * Warns when neither finds a table. Source-PDF text only. Plain download (CSV is small).
   */
  async exportTableCsv(pageIdx?: number): Promise<void> {
    const { documentModel, reportError, progress } = this._ctx;
    const idx = pageIdx ?? documentModel.currentPageIndex;
    const docPage = documentModel.pages[idx];
    if (!docPage || docPage.sourcePdfId === 'blank') { reportError.warn('toast.noTableFound'); return; }
    const filename = `${this._exportBaseName()}-table.csv`;
    // #54: pick the save target BEFORE the async pdf.js text/op extraction. When
    // no grid is found we simply never write — the picked handle is abandoned
    // (no file is created until createWritable+write), so the only cost of a
    // miss after picking is the dialog itself.
    const target = await pickSaveTarget(filename, SAVE_CSV);
    if (target === 'cancelled') return;
    const _prog = progress.begin('progress.extractingTable');
    try {
      const grid = await this._resolveTableGrid(docPage);
      if (!grid) { reportError.warn('toast.noTableFound'); _prog.done(); return; }
      // Prepend a UTF-8 BOM (#QA-2026-06-23 P3 #28) so Excel auto-detects UTF-8 and renders
      // accented/non-ASCII cells correctly instead of mojibake.
      const blob = new Blob(['﻿' + gridToCsv(grid)], { type: 'text/csv;charset=utf-8' });
      await this._saveOrDownload(target, blob, filename, 'text/csv;charset=utf-8');
      if (target === 'download') reportError.info('toast.tableExtracted', { rows: grid.rows, cols: grid.cols });
      else reportError.info('toast.pdfSaved', { name: target.name });
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

    // REDACTION LEAK FIX: drop any source text item sitting under a redaction box, exactly as
    // `_extractFlowDoc` does for DOCX/MD/TXT. Without this the CSV and XLSX exports read the RAW
    // `getTextContent()` and hand redacted text straight back — measured: redact a name in a ruled
    // table, export to Excel, and the name is a cell. The flow path had the guard and this one did
    // not, which is the shape a green test suite cannot catch: two sibling extractors, one filtered.
    // `rotation: 0` is LOAD-BEARING. `redactionRectToContent` and `isItemRedacted` both want the
    // UNROTATED content dimensions (see the former's docstring, and `PageService._pageGeom`, which is
    // the repo's canonical accessor). `getViewport({ scale: 1 })` defaults `rotation` to `page.rotate`,
    // so on a `/Rotate 90|270` page it returns SWAPPED dims and the filter silently no-ops — measured:
    // the secret still exports and, at some rotations, innocent cells get dropped instead. Mirroring a
    // sibling call site is not verification of it; this convention was checked against the contract.
    // The `viewBox` term is the SECOND half of this mapping and is just as load-bearing as
    // `rotation: 0`. pdf.js reports items in ABSOLUTE user space while a redaction rect is
    // relative to the rendered (crop) box, so on a page with a non-zero CropBox ORIGIN the two
    // are compared in different frames, nothing matches, and the secret exports into the CSV /
    // XLSX. Measured on `/CropBox [50 50 350 350]`: `SECRETWORD|PUBLICWORD`. Same class as the
    // `/Rotate` bug above — see `redactionRectToPageSpace`, which handles both together.
    const vp = page.getViewport({ scale: 1, rotation: 0 });
    const totalRot = (((page.rotate ?? 0) + (docPage.rotation ?? 0)) % 360 + 360) % 360;
    const contentRedactions = this._ctx.elements
      .filter(el => el.pageId === docPage.id && el.type === 'redaction')
      .map(el => redactionRectToPageSpace(
        el, vp.viewBox, totalRot,
      ));

    const items: TableTextItem[] = (content.items as RawTextItem[])
      .filter(it => typeof it.str === 'string' && it.str.trim().length > 0 && Array.isArray(it.transform))
      .filter(it => !contentRedactions.some(r => isItemRedacted(it, r, vp.viewBox[3])))
      .map(it => ({ x: it.transform[4], y: it.transform[5], text: it.str, width: it.width }));
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
    opts?: { flattenAllForms?: boolean; cleanMetadata?: boolean },
  ): Promise<import('@cantoo/pdf-lib').PDFDocument> {
    const { documentModel, elements, reportError, formValues } = this._ctx;
    const docPages = pagesSubset ?? documentModel.pages;
    const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
    {
      // P3 (QA sweep 2026-06-19): with opts.cleanMetadata, build the doc with
      // updateMetadata:false so pdf-lib does NOT stamp its own /Producer + /Creator
      // ("…Hopding/pdf-lib") + CreationDate/ModDate at save time. Only the user-facing
      // download paths (downloadPDF / range / flattened) opt in; assemblePdfBytes keeps
      // the default, so the sign/compress/sanitize paths see byte-identical input (the
      // sanitize feature still has the producer stamp to strip).
      const pdfDoc = await PDFDocument.create(opts?.cleanMetadata ? { updateMetadata: false } : {});

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
      const droppedFields: string[] = [];
      for (const [id, srcDoc] of srcDocs) {
        const vals = formValues[id];
        const hasVals = !!vals && Object.keys(vals).length > 0;
        if (!hasVals && !opts?.flattenAllForms) continue;
        try {
          const form = srcDoc.getForm();
          if (hasVals) {
            // G14: dispatch on the field's real type (text / checkbox / radio /
            // dropdown / listbox) so every persisted choice bakes in, not just text.
            for (const [fieldName, value] of Object.entries(vals)) {
              // B1: a value that doesn't match a dropdown/radio/listbox option is
              // skipped (never aborts the export) — collect it so we can warn.
              if (!applyFormFieldValue(form, fieldName, value)) droppedFields.push(fieldName);
            }
          }
          form.flatten();
        } catch { /* no form fields in this source */ }
      }
      // B1: surface silently-dropped form values once, rather than losing them
      // without a trace. A warn (not an error) — the export still succeeds.
      if (droppedFields.length) {
        this._ctx.reportError.warn('toast.formValueDropped', { count: droppedFields.length });
      }

      // Pre-copy all needed pages from each source (one copyPages call per source).
      //
      // REDACTION LEAK FIX (P0) — do NOT remove this filter. A redaction-bearing page must not be
      // pre-copied: it takes the rasterise branch below and its copy is never `addPage`d, but pdf-lib
      // does not garbage-collect, so `save()` still serialises it. The un-redacted page content stream
      // then ships inside the exported file as an orphan — absent from `/Pages`, so `getTextContent()`
      // reports the secret gone, while the text is recoverable from the raw bytes.
      //
      // MEASURED, and the measurement is worth the warning: reverting this line makes
      // `tests/browser/redaction-orphan-leak.browser.test.ts` fail with the source text present in the
      // exported bytes. An earlier revision of this comment claimed the leak "does not reproduce
      // end-to-end" — that was wrong, and wrong because the test's own scan was inert: pdf.js's
      // `getDocument({ data })` TRANSFERS the buffer, so scanning the same `Uint8Array` afterwards reads
      // zero bytes and always answers "clean". The scan now slices, and refuses an empty buffer.
      //
      // Keyed on the DOC PAGE, not the source index, so a source page used twice — once redacted,
      // once not — is still copied for the clean instance: the filter keeps any index that at least
      // one non-redacted doc page needs.
      const pageHasRedaction = (p: typeof docPages[number]): boolean =>
        elements.some(el => el.pageId === p.id && el.type === 'redaction');
      const copiedPages = new Map<string, import('@cantoo/pdf-lib').PDFPage>();
      for (const [id, srcDoc] of srcDocs) {
        const indices = [...new Set(
          docPages
            .filter(p => p.sourcePdfId === id && !pageHasRedaction(p))
            .map(p => p.sourcePageNum - 1)
        )].sort((a, b) => a - b);
        if (indices.length === 0) continue;
        const pages = await pdfDoc.copyPages(srcDoc, indices);
        indices.forEach((idx: number, i: number) => copiedPages.set(`${id}:${idx}`, pages[i]));
      }

      // Add pages in document order and draw overlays
      const totalPages = docPages.length;
      let pagesDone = 0;
      // Bates / page numbers reflect the page's FULL-document position (not its
      // index within a subset), so a range export still reads "page 5 of 10".
      const docTotal = documentModel.pages.length;
      for (const docPage of docPages) {
        const pageElements = elements.filter(el => el.pageId === docPage.id);
        const hasRedaction = pageElements.some(el => el.type === 'redaction');
        const pageNumber = documentModel.pages.indexOf(docPage) + 1;

        // Blank page: create fresh page at specified dimensions
        if (docPage.sourcePdfId === 'blank') {
          const W_orig = docPage.blankWidth ?? 595;
          const H_orig = docPage.blankHeight ?? 842;
          const blankPage = pdfDoc.addPage([W_orig, H_orig]);
          blankPage.drawRectangle({ x: 0, y: 0, width: W_orig, height: H_orig, color: rgb(1, 1, 1), borderWidth: 0 });
          // REDACTION LEAK FIX (P0): this branch is checked BEFORE `hasRedaction`, so a blank page's
          // redaction never reaches the rasteriser — it was baked as an opaque vector rect over live,
          // fully extractable overlay text. There is no source document to rasterise here, so removal
          // is achieved the only other way available: the covered elements are not drawn at all. The
          // rect is opaque, so for a fully-covered element the visual result is identical. Two bounds are
          // real and are disclosed in SECURITY.md rather than claimed away: a PARTIALLY covered element
          // disappears entirely, and so does one the user deliberately stacked ABOVE the redaction (the
          // raster path draws that one above the burn, so the two paths differ by design). Nothing
          // surfaces either at export time — the earlier claim that the loss is "visible to the user" was
          // wrong, they have to open the file.
          const blankElements = dropElementsUnderRedactions(pageElements);
          await buildPageOverlays({
            pdfDoc, page: blankPage, docPage,
            elements: blankElements,
            pdfLib: { rgb, degrees, StandardFonts },
            userRot: 0, sourceRot: 0,
            watermark: documentModel.watermark,
            inkLayer: this._ctx.inkLayer,
            reportError,
            bates: documentModel.bates, pageNumber, pageCount: docTotal,
          });
        } else if (hasRedaction) {
          const srcDoc = srcDocs.get(docPage.sourcePdfId);
          if (srcDoc) {
            await rasterizePageWithRedactions(srcDoc, docPage, pageElements, pdfDoc, { rgb, StandardFonts, degrees }, documentModel.watermark, this._ctx.inkLayer, reportError, documentModel.bates, pageNumber, docTotal);
          }
        } else {
          const key = `${docPage.sourcePdfId}:${docPage.sourcePageNum - 1}`;
          const page = copiedPages.get(key);
          if (page) {
            pdfDoc.addPage(page);
            await this._applyOverlaysToPage(pdfDoc, page, docPage, pageElements, { rgb, degrees, StandardFonts }, pageNumber, docTotal);
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
    const filename = `${this._exportBaseName()}-page${pageIdx + 1}.pdf`;
    // #54: pick the save target inside the click's activation window, BEFORE the
    // async source load + page assembly (those awaits would outlive activation).
    const target = await pickSaveTarget(filename, SAVE_PDF);
    if (target === 'cancelled') return;
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
        await rasterizePageWithRedactions(srcDocLib, docPage, pageElements, pdfDoc, { rgb, StandardFonts, degrees }, documentModel.watermark, this._ctx.inkLayer, reportError, documentModel.bates, pageIdx + 1, documentModel.pageCount);
      } else {
        const [page] = await pdfDoc.copyPages(srcDocLib, [docPage.sourcePageNum - 1]);
        pdfDoc.addPage(page);
        await this._applyOverlaysToPage(pdfDoc, page, docPage, pageElements, { rgb, degrees, StandardFonts }, pageIdx + 1, documentModel.pageCount);
      }

      await this._applyExportPassword(pdfDoc);
      const bytes = await pdfDoc.save({ useObjectStreams: false });
      await this._saveOrDownload(target, bytes, filename, 'application/pdf');
      if (target === 'download') reportError.info('toast.pageDownloaded', { page: pageIdx + 1 });
      else reportError.info('toast.pdfSaved', { name: target.name });
      _prog.done();
    } catch (err) {
      reportError.error('toast.pageExportFailed', err);
      _prog.failed();
    }
  }

  /**
   * Render a page to a raster image and save it. G20: resolution + format are
   * caller-controlled via `opts` — `scale` drives the pdf.js viewport (clamped to
   * [1,6], ~72–432 DPI), `format` picks PNG (lossless) vs JPEG, `quality` is the
   * JPEG encoder quality (clamped [0.5,1], ignored for PNG). A no-arg / no-opts
   * call is byte-identical to the historic export: scale 2, PNG, `.png` name.
   * Overlays still composite via the shared buildPageOverlays path; the save
   * target is acquired BEFORE the async raster (#54 transient-activation).
   */
  async downloadPageAsImage(pageIdx?: number, opts?: ImageExportOptions): Promise<void> {
    const { documentModel, elements, reportError, progress } = this._ctx;
    const idx = pageIdx ?? documentModel.currentPageIndex;
    const docPage = documentModel.pages[idx];
    if (!docPage) return;
    const scale  = clamp(opts?.scale ?? IMG_DEFAULTS.scale, IMG_SCALE_MIN, IMG_SCALE_MAX);
    const format: ImageExportFormat = opts?.format ?? IMG_DEFAULTS.format;
    const quality = clamp(opts?.quality ?? IMG_DEFAULTS.quality, IMG_QUALITY_MIN, IMG_QUALITY_MAX);
    const type = format === 'jpeg' ? SAVE_JPG : SAVE_PNG;
    // PNG ignores the quality arg; pass undefined so the call matches the historic
    // single-arg toBlob (and the lossless encoder isn't handed a no-op number).
    const blobQuality = format === 'jpeg' ? quality : undefined;
    const filename = `${this._exportBaseName()}-page${idx + 1}${type.ext}`;
    // #54: pick the save target BEFORE the pdf-lib assembly + pdf.js raster +
    // toBlob — all async, each would outlive the click's transient activation.
    const target = await pickSaveTarget(filename, type);
    if (target === 'cancelled') return;
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
      await this._applyOverlaysToPage(pdfDoc, page, docPage, pageElements, { rgb, degrees, StandardFonts }, idx + 1, documentModel.pageCount);

      const pdfBytes   = await pdfDoc.save({ useObjectStreams: false });
      const renderDoc  = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      const renderPage = await renderDoc.getPage(1);
      const vp = renderPage.getViewport({ scale });
      const offscreen = document.createElement('canvas');
      offscreen.width  = Math.round(vp.width);
      offscreen.height = Math.round(vp.height);
      const ctx = offscreen.getContext('2d');
      if (!ctx) { reportError.error('toast.canvasUnavailable'); _prog.failed(); return; }
      await renderPage.render({ canvas: offscreen, viewport: vp }).promise;
      // #QA-2026-06-23 P2: release the pdf.js worker doc now that the canvas is rasterized
      // (the async toBlob below works on the canvas, not the doc).
      {
        const task = (renderDoc as { loadingTask?: { destroy?: () => Promise<void> } }).loadingTask;
        if (task && typeof task.destroy === 'function') void task.destroy().catch(() => {});
      }

      offscreen.toBlob((blob) => {
        if (!blob) { reportError.error('toast.imageExportFailed'); _prog.failed(); return; }
        // Target was acquired pre-raster; write/anchor it now. Save errors must
        // settle the progress bar, so route the async save through .then/.catch.
        this._saveOrDownload(target, blob, filename, type.mime)
          .then(() => {
            if (target === 'download') reportError.info('toast.imageExported', { page: idx + 1 });
            else reportError.info('toast.pdfSaved', { name: target.name });
            _prog.done();
          })
          .catch((err) => { reportError.error('toast.imageExportFailed', err); _prog.failed(); });
      }, type.mime, blobQuality);
    } catch (err) {
      reportError.error('toast.imageExportFailed', err);
      _prog.failed();
    }
  }

  /**
   * G17 — render a page thumbnail that INCLUDES the user's overlay annotations
   * (every element type) + ink, by reusing the same compositor as the PNG export
   * (`_applyOverlaysToPage` → `buildPageOverlays`) at thumbnail scale.
   *
   * Returns `null` when the page has no overlay elements AND no ink: the caller
   * then falls back to the plain source raster, so an unedited thumbnail is
   * byte-identical to the pre-G17 path and costs nothing extra. A redaction is
   * composited as its visible fill rect. Source annotations under a redaction ARE stripped
   * here (via `_applyOverlaysToPage`), the same as on the PNG export — an earlier version of
   * this comment called the thumbnail "a preview, not the true content-stripping export path"
   * and paired it with the PNG export, which SECURITY.md grades as removal-grade.
   *
   * Mirrors `downloadPageAsImage` but returns a JPEG data URL (matching
   * `PDFRenderer.generateThumbnail`'s format/quality) and destroys the temporary
   * pdf.js doc — this path runs repeatedly as the user edits, so the worker must
   * not leak.
   */
  async renderThumbnailWithOverlays(pageIdx: number, thumbScale = 0.15): Promise<string | null> {
    const { documentModel, elements, inkLayer, reportError } = this._ctx;
    const docPage = documentModel.pages[pageIdx];
    if (!docPage) return null;

    const pageElements = elements.filter(el => el.pageId === docPage.id);
    const hasInk = inkLayer.getStrokes(docPage.id).length > 0;
    // Nothing to composite → let the caller use the cheaper source-only raster.
    if (pageElements.length === 0 && !hasInk) return null;

    let renderDoc: pdfjsLib.PDFDocumentProxy | undefined;
    try {
      const { PDFDocument, rgb, StandardFonts, degrees } = await import('@cantoo/pdf-lib');
      const pdfDoc = await PDFDocument.create();
      const libs = { rgb, degrees, StandardFonts };
      const pageNumber = pageIdx + 1;

      if (docPage.sourcePdfId === 'blank') {
        const W = docPage.blankWidth ?? 595;
        const H = docPage.blankHeight ?? 842;
        const blankPage = pdfDoc.addPage([W, H]);
        blankPage.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1), borderWidth: 0 });
        await this._applyOverlaysToPage(pdfDoc, blankPage, docPage, pageElements, libs, pageNumber, documentModel.pageCount);
      } else {
        const srcEntry = documentModel.sourcePdfs.get(docPage.sourcePdfId);
        if (!srcEntry) return null;
        const srcDoc = await PDFDocument.load(srcEntry.bytes);
        const [page] = await pdfDoc.copyPages(srcDoc, [docPage.sourcePageNum - 1]);
        pdfDoc.addPage(page);
        await this._applyOverlaysToPage(pdfDoc, page, docPage, pageElements, libs, pageNumber, documentModel.pageCount);
      }

      const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
      renderDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      const renderPage = await renderDoc.getPage(1);
      const vp = renderPage.getViewport({ scale: thumbScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(vp.width));
      canvas.height = Math.max(1, Math.round(vp.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      await renderPage.render({ canvas, viewport: vp }).promise;
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch (err) {
      // Never break the thumbnail strip — fall back to the source-only raster.
      reportError.silent(err, `renderThumbnailWithOverlays failed for page ${pageIdx}`);
      return null;
    } finally {
      const task = (renderDoc as { loadingTask?: { destroy?: () => Promise<void> } } | undefined)?.loadingTask;
      if (task && typeof task.destroy === 'function') void task.destroy().catch(() => {});
    }
  }

  async exportAsDocx(): Promise<void> {
    const { reportError, progress } = this._ctx;
    const filename = this._exportBaseName() + '.docx';
    // #54: pick the save target BEFORE the heavy flow extraction + DOCX build.
    // A content-less document never writes (the handle is abandoned, so no empty
    // file is created) — the dialog is the only cost of that rare miss.
    const target = await pickSaveTarget(filename, SAVE_DOCX);
    if (target === 'cancelled') return;
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
      await this._saveOrDownload(target, blob, filename, SAVE_DOCX.mime);
      if (target === 'download') reportError.info('toast.docxExported');
      else reportError.info('toast.pdfSaved', { name: target.name });
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

  /**
   * Export recognized OCR text as a plain-text download, and best-effort copy it
   * to the clipboard. READ-ONLY: does NOT modify the document (unlike the in-page
   * 'visible'/'searchable' OCR modes). Empty text → warn, never an empty file.
   *
   * The clipboard write is a progressive enhancement — `navigator.clipboard` is
   * absent in insecure contexts and `writeText` legitimately rejects when the
   * permission is denied. Neither must block or fail the guaranteed .txt download,
   * so the failure is swallowed and reflected only in which toast is shown.
   */
  async exportOcrText(text: string): Promise<void> {
    const { reportError } = this._ctx;
    const body = text.trim();
    if (!body) { reportError.warn('toast.exportNoText'); return; }
    let copied = false;
    try {
      const clip = navigator.clipboard;
      if (clip && typeof clip.writeText === 'function') {
        await clip.writeText(body);
        copied = true;
      }
    } catch {
      copied = false;
    }
    this._downloadBlob(new Blob([body], { type: 'text/plain;charset=utf-8' }), this._exportBaseName() + '.txt');
    reportError.info(copied ? 'toast.ocrTextCopied' : 'toast.ocrTextExported');
  }

  /**
   * Export recognized OCR text as an editable Word (.docx) — the clean, editable
   * deliverable for a scanned page. Builds a linear, reading-order transcription
   * (the scan's column/table layout is NOT reconstructed — documented ceiling).
   * Empty text → warn, never an empty file.
   */
  async exportOcrDocx(text: string): Promise<void> {
    const { reportError, progress } = this._ctx;
    const body = text.trim();
    if (!body) { reportError.warn('toast.exportNoText'); return; }
    const _prog = progress.begin('progress.generatingDocx');
    try {
      const blob = await flowDocToDocxBlob(ocrTextToFlowDoc(body));
      this._downloadBlob(blob, this._exportBaseName() + '.docx');
      reportError.info('toast.docxExported');
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
   *
   * PDF-bytes shim over `_saveOrDownload` — kept so the historic PDF callers
   * (downloadPDF / downloadPageRange / downloadFlattened) read unchanged.
   */
  private async _saveBytesTo(target: Exclude<SaveTarget, 'cancelled'>, bytes: Uint8Array, filename: string): Promise<void> {
    await this._saveOrDownload(target, bytes, filename, 'application/pdf');
  }

  /**
   * Write export output to a resolved save target (#54/G19): a file handle
   * (native "Save As") or the anchor-download fallback. Accepts PDF/image bytes
   * (`Uint8Array`) or a ready Blob (CSV / DOCX / PNG) — the download path wraps
   * bytes in a `mime` Blob; the handle path writes either as-is. `target` must
   * not be 'cancelled' (callers handle the user-cancel no-op before any work).
   */
  private async _saveOrDownload(
    target: Exclude<SaveTarget, 'cancelled'>,
    data: Uint8Array | Blob,
    filename: string,
    mime: string,
  ): Promise<void> {
    if (target === 'download') {
      const blob = data instanceof Blob ? data : new Blob([data.buffer as ArrayBuffer], { type: mime });
      this._downloadBlob(blob, filename);
    } else {
      await writeToHandle(target, data);
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
    pageNumber?: number,
    pageCount?: number,
  ): Promise<void> {
    const sourceRot = page.getRotation().angle as number;

    // Source annotations over a redaction must go before ANY pdf.js raster of this page. The
    // burn sits in the content stream and pdf.js paints annotation appearance streams after it,
    // so a covered FreeText note / stamp / un-flattened widget is repainted ON TOP of the burn
    // and baked into the exported pixels — visibly. `downloadPageAsImage` and
    // `renderThumbnailWithOverlays` both rasterize what this method produces, so the strip
    // belongs HERE rather than at those two call sites: a per-site fix would leave the next
    // rasterizing caller on the same cliff. No-op on a page with no redaction, which is every
    // page reaching this method from the PDF export path (those route to the rasterizer).
    //
    // It runs BEFORE `buildPageOverlays`, and that ordering is load-bearing: `buildPageOverlays`
    // MUTATES the page it is given — `page.setRotation(totalRot)` and `page.setCropBox(effBox)`
    // — so reading either afterwards yields a DOUBLED rotation (`srcRot + 2·userRot`) and the
    // NARROWED crop box, while the redaction elements are still in source-box display coords.
    // That combination silently un-did the strip on exactly these two callers; the rasterizer
    // escaped it only by capturing `srcRot` early and passing `skipCropBox`. Pinned at every
    // rotation and with a crop by tests/browser/redaction-annotation-frames.browser.test.ts.
    await stripRedactedAnnotations(
      page, pageElements, docPage.id, getPageCropBox(page),
      ((sourceRot + (docPage.rotation ?? 0)) % 360 + 360) % 360,
    );

    await buildPageOverlays({
      pdfDoc, page, docPage,
      elements: pageElements,
      pdfLib,
      userRot: docPage.rotation ?? 0,
      sourceRot,
      watermark: this._ctx.documentModel.watermark,
      inkLayer: this._ctx.inkLayer,
      reportError: this._ctx.reportError,
      bates: this._ctx.documentModel.bates, pageNumber, pageCount,
    });
  }

  /**
   * Reconstruct a flow-document model from source PDF text layers for DOCX/MD export.
   * Blank pages and pages without a source are skipped.
   */
  private async _extractFlowDoc(): Promise<FlowDoc> {
    const { documentModel, elements } = this._ctx;
    const flowDoc: FlowDoc = { pages: [] };
    for (const docPage of documentModel.pages) {
      // Text the user TYPED on this page (overlay TextElements). `el.text` is logical
      // Unicode, so this exports correctly in DOCX/MD — including Arabic (#4).
      // Interleaved into the source text by reading order on a source page (G12);
      // emitted alone on a blank page. The reading-order `y` is attached below for
      // a source page (it needs the source page height, known after getPage).
      // `dropElementsUnderRedactions` FIRST: the PDF export removes overlay text under a redaction, and
      // this path must agree. Without it, redacting a typed note removed it from the exported PDF while
      // "Export to Word" on the same page handed it back — promoted to a heading if it was styled as one.
      // Both this and the redaction live in editor display space, so no conversion is involved.
      const overlayEls: OverlayTextLike[] = dropElementsUnderRedactions(
        elements.filter(el => el.pageId === docPage.id),
      )
        .filter((el): el is TextElement => el.type === 'text')
        .map((el) => ({
          text: el.text, x: el.x, y: el.y, fontSize: el.fontSize,
          color: el.color, fontFamily: el.fontFamily, bold: el.bold, italic: el.italic,
        }));
      const src = documentModel.sourcePdfs.get(docPage.sourcePdfId);
      if (!src || !docPage.sourcePageNum) {
        // Blank page (no source) carrying typed text: emit it so the text isn't dropped
        // — this is the "blank page + typed Arabic → empty DOCX" bug. No pageHeight is
        // passed: overlay-only order is already correct via the function's x/y sort, so
        // these paragraphs carry no reading-order `y` (G12 only matters when merging
        // with source paragraphs).
        const blankParas = textElementsToFlowParagraphs(overlayEls);
        if (blankParas.length > 0) {
          flowDoc.pages.push({
            width: docPage.blankWidth ?? 595,
            height: docPage.blankHeight ?? 842,
            paragraphs: blankParas,
          });
        }
        continue;
      }
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
        .map(el => ({ x: el.x, y: el.y, width: el.width, height: el.height, rotation: el.rotation }));

      // B1: a tagged PDF carries a struct tree. When present, request the
      // marked-content text variant (markers tie struct leaves to text items) so
      // reconstructPage can take the exact-replace path. Untagged pages keep the
      // plain getTextContent() call → byte-identical extraction (~85% of files).
      const structTree = (await page.getStructTree().catch(() => null)) as StructTreeNodeLike | null;
      const useStruct = !!structTree?.children?.length;
      const [content, opList, annotations] = await Promise.all([
        page.getTextContent(useStruct ? { includeMarkedContent: true } : undefined),
        page.getOperatorList().catch(() => null),
        page.getAnnotations().catch(() => [] as unknown[]),
      ]);

      // `rotation: 0` — pdf.js reports text items in UNROTATED content space, and `reconstructPage`
      // uses these dims both to flip y for `isItemRedacted` and to un-rotate the redaction rects. With
      // the default (`page.rotate`) the dims are swapped on a `/Rotate 90|270` page, so the redaction
      // filter mis-maps and redacted source text leaked into DOCX/MD/TXT. CORE-P0-1's comment claimed
      // rotated pages were covered; it had only fixed 0/180, where the error cancels.
      const vp = page.getViewport({ scale: 1, rotation: 0 });

      // ── C22 — ONE FRAME, established once, here ────────────────────────────────────────
      // pdf.js reports every CONTENT channel in ABSOLUTE user space: text items, operator-list
      // CTMs (rules, images, colour keys) and Link rects alike. But the page box handed to
      // `reconstructPage` is the CROP box. On a `/CropBox [0 0 w h]` page the frames coincide;
      // give the page an origin and the flow model's margins, image anchors and reading order are
      // all computed against a box its coordinates do not belong to (C22).
      //
      // Measured on `/CropBox [50 50 350 350]` before this fix: item (100,300), rule (100,296),
      // colour key "100,300", image ctm e/f (120,200) — all absolute, and all mutually CONSISTENT.
      // That consistency is what makes one translation safe, and it is also the hazard: colour,
      // underline and hyperlink are matched BY POSITION, so moving the words without moving those
      // channels would fix the layout and silently break all three. Every channel below therefore
      // moves together, and the two that carry several channels at once (`walkPageOps` via its
      // base transform) do so by construction rather than by discipline.
      const cropOriginX = vp.viewBox[0], cropOriginY = vp.viewBox[1];
      // The page box in the normalised frame. Equal to `vp.viewBox` on a zero-origin page, which
      // is why every existing fixture is byte-identical and the whole flow suite is the guard.
      const cropFrame = [0, 0, vp.width, vp.height];

      // Gap 2: Link annotations → hyperlinks. pdf.js gives each Link a `url` and a
      // `rect` [x0,y0,x1,y1] in PDF user space (y-up) — the same space the text
      // item transforms live in, so reconstructPage can bbox-match words to URLs.
      const links: FlowLinkRect[] = (annotations as Array<{ subtype?: string; url?: string; rect?: number[] }>)
        .filter(a => a.subtype === 'Link' && typeof a.url === 'string' && !!a.url && Array.isArray(a.rect) && a.rect.length === 4)
        .map(a => {
          const [rx0, ry0, rx1, ry1] = a.rect as number[];
          return {
            url: a.url as string,
            x0: Math.min(rx0, rx1) - cropOriginX, y0: Math.min(ry0, ry1) - cropOriginY,
            x1: Math.max(rx0, rx1) - cropOriginX, y1: Math.max(ry0, ry1) - cropOriginY,
          };
        });

      // When the marked-content variant was requested, the stream interleaves
      // boundary markers (carry `type`) with text items; the heuristic path + font
      // map want text items only. markedItems keeps the full stream for the struct path.
      // C22: translated HERE, before anything downstream reads a position — the struct-tree path
      // consumes `markedItems` directly, so normalising only the filtered `items` would leave a
      // tagged PDF on the old frame.
      const markedItems = translateItemsToCropOrigin(
        content.items as unknown as Array<RawTextItem | MarkedContentMarker>,
        cropOriginX, cropOriginY,
      );
      const items = (useStruct ? markedItems.filter(it => !('type' in it)) : markedItems) as RawTextItem[];
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

      // Redaction rects mapped ONCE into the frame pdf.js reports both text items and image
      // placements in (x in that frame, y measured down from the crop top). The image channel
      // below is filtered with these; `reconstructPage` is handed the same `cropFrame` and derives
      // the same thing for the text channels, so all three agree by construction.
      //
      // The frame is `cropFrame`, NOT `vp.viewBox`: the items have already been translated to the
      // crop origin above, so mapping the rects into absolute space here would re-introduce the
      // offset on one side of the comparison and the filter would silently stop matching. The two
      // are equal on a zero-origin page, and the invariance is exact on any other — an item's
      // distance below the crop top is `(y1 − y0) − (y − y0) = y1 − y`, which is what this
      // computed before. `redaction-crop-origin.browser.test.ts` is the guard.
      const pageSpaceRedactions = redactions.map(
        r => redactionRectToPageSpace(r, cropFrame, totalRot),
      );
      let colorMap = new Map<string, string>();
      let pageRules: RuleRect[] = [];
      let pageVRules: RuleRect[] = [];
      const pageImages: FlowImage[] = [];

      if (opList) {
        // Pure operator-list walk → text colors, rules, image placements (M2 #22).
        const OPS = pdfjsLib.OPS as unknown as Record<string, number>;
        // C22: the origin argument carries `rules`, `vRules`, the image CTMs AND the `colorMap`
        // keys into the crop frame together — they all derive from the walker's ctm, so this one
        // argument is what makes a partial normalisation of those four unexpressible.
        const ops = walkPageOps(opList, OPS, { x: cropOriginX, y: cropOriginY });
        colorMap = ops.colorMap;
        pageRules = ops.rules;
        pageVRules = ops.vRules;
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
            // REDACTION LEAK FIX: the four TEXT channels were filtered and this one was not, so
            // a redaction over a picture removed the words on top of it while the picture itself
            // was embedded whole in the DOCX/MD/TXT export. On a SCANNED page that is the entire
            // page as one image XObject, which is the canonical redaction case — the tool's core
            // promise, inverted. Measured: `images_under_redaction = 1`.
            // Dropping the whole image is deliberate and matches the blank-page precedent: for a
            // leak filter, over-approximating is the only safe direction. The cost is real and is
            // disclosed in SECURITY.md — one redaction anywhere on a scan removes that scan from
            // these exports. Burning the box into the bitmap (as the OCR path already does) is the
            // follow-up that would let the rest of the scan survive.
            // `cropFrame[3]` (= vp.height), not `vp.viewBox[3]`: the placement CTM is now in the
            // crop frame, so the top edge it is measured down from is the crop HEIGHT. Identical
            // on a zero-origin page.
            if (imagePlacementRedacted(placement.ctm, pageSpaceRedactions, cropFrame[3])) continue;
            const img = this._rasterizeImagePlacement(page, placement, vp.height);
            if (img) pageImages.push(img);
          }
        }
      }

      // The last argument is the page box in the frame the items are now in, and it is
      // load-bearing: `reconstructPage` maps the redaction rects through it, so a mismatch with
      // the items' frame makes the filter silently no-op (pinned by
      // tests/browser/redaction-crop-origin.browser.test.ts). It is a ZERO origin BY CONSTRUCTION
      // here rather than by luck — `cropFrame` is passed explicitly, and identically to
      // `pageSpaceRedactions` above, so the two cannot drift apart in a later edit.
      const flowPage = reconstructPage(items, fonts, vp.width, vp.height, colorMap, redactions, links.length ? links : undefined, pageRules.length ? pageRules : undefined, totalRot, pageVRules.length ? pageVRules : undefined, useStruct ? { tree: structTree, markedItems } : undefined, cropFrame);
      if (pageImages.length > 0) flowPage.images = pageImages;
      // Interleave typed overlay text into the source paragraphs by reading order
      // (G12) instead of appending it at the end. The overlay paragraphs get a PDF
      // y-up `y` from the SOURCE page height (vp.height, NOT the blank fallback) so
      // a note typed mid-page exports mid-page. No overlay → flowPage.paragraphs is
      // returned unchanged (byte-identical pre-G12 output).
      const overlayParas = textElementsToFlowParagraphs(overlayEls, vp.height);
      flowPage.paragraphs = interleaveByReadingOrder(flowPage.paragraphs, overlayParas);
      flowDoc.pages.push(flowPage);
    }
    assignHeadings(flowDoc);
    // B3: attach the source PDF outline (bookmarks) so the DOCX writer can emit a
    // Word TOC field. v1 uses the FIRST source PDF carrying a non-empty outline
    // (multi-source merge = v1b). No outline → field stays unset → byte-identical.
    try {
      for (const [, src] of documentModel.sourcePdfs) {
        const raw = (await src.doc.getOutline()) as Array<{ title?: string; items?: unknown[] }> | null;
        const items = raw?.length ? flattenOutline(raw as Parameters<typeof flattenOutline>[0]) : [];
        if (items.length) { flowDoc.outline = items; break; }
      }
    } catch { /* no outline available → no TOC, export unchanged */ }
    // B5: hoist a running header/footer (repeated top/bottom band across pages)
    // into doc.header/footer and drop the inline duplicates. No band → no-op.
    applyRepeatedBands(flowDoc);
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
