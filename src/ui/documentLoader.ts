import * as pdfjsLib from 'pdfjs-dist';
import type { AppDOMRefs } from './uiController';
import type { PDFElement } from '../elements/annotationElement';
import type { DocumentModel } from '../core/documentModel';
import type { PDFRenderer } from '../infra/pdfRenderer';
import type { HistoryManager } from '../core/historyManager';
import type { FormFieldOverlay } from '../utils/formFieldOverlay';
import type { TextLayerManager } from '../utils/textLayer';
import type { TextSearchHandler } from '../handlers/textSearchHandler';
import type { InkLayer } from '../infra/inkLayer';
import type { IErrorReporter } from '../core/errorReporter';
import type { IProgressManager } from './progressManager';
import { ElementFactory } from '../utils/elementFactory';
import { loadState, clearState } from '../infra/storage';

export interface IDocumentLoaderContext {
  // Loading state
  readonly isLoading: boolean;
  setIsLoading(v: boolean): void;
  // Document model lifecycle
  readonly documentModel: DocumentModel;
  resetDocumentModel(): void;
  // Mutable state
  readonly elements: PDFElement[];
  setFormValues(v: Record<string, Record<string, string>>): void;
  setWarnedUnsupportedFields(v: boolean): void;
  setSelectedElement(el: PDFElement | null): void;
  setCurrentFilename(name: string | null): void;
  setClipboard(val: null): void;
  isFitMode: boolean;
  setPendingPasswordResolve(fn: ((pw: string | null) => void) | null): void;
  // Infrastructure refs
  readonly renderer: PDFRenderer;
  readonly historyManager: HistoryManager;
  readonly formFieldOverlay: FormFieldOverlay;
  readonly textLayerManager: TextLayerManager;
  readonly textSearch: TextSearchHandler;
  readonly inkLayer: InkLayer;
  readonly ui: AppDOMRefs;
  readonly reportError: IErrorReporter;
  readonly progress: IProgressManager;
  // Thumbnail panel
  reinitThumbnailPanel(): void;
  clearThumbnailPanel(): void;
  renderThumbnails(): Promise<void>;
  updateActiveThumbnail(): void;
  // Zoom
  setZoom(scale: number): void;
  applyZoom(scale: number): Promise<void>;
  // Coordinated actions
  renderCurrentPage(): Promise<void>;
  syncWatermarkBtn(): void;
  enableUI(): void;
  enableFileMenuDocItems(): void;
  disableFileMenuDocItems(): void;
  closeFindBar(): void;
  clearCanvases(): void;
  resetSearchOptions(): void;
  updateCopyPasteBtns(): void;
  autosave(): void;
  updatePageInfo(): void;
  rebuildElementLayer(): void;
}

export class DocumentLoader {
  constructor(private readonly _ctx: IDocumentLoaderContext) {}

  private _askRestoreSession(): Promise<boolean> {
    return new Promise(resolve => {
      const dialog = this._ctx.ui.restoreDialog;
      dialog.style.display = '';
      const onYes = () => { cleanup(); resolve(true); };
      const onNo  = () => { cleanup(); resolve(false); };
      const cleanup = () => {
        dialog.style.display = 'none';
        this._ctx.ui.restoreYesBtn.removeEventListener('click', onYes);
        this._ctx.ui.restoreNoBtn.removeEventListener('click', onNo);
      };
      this._ctx.ui.restoreYesBtn.addEventListener('click', onYes);
      this._ctx.ui.restoreNoBtn.addEventListener('click', onNo);
      this._ctx.ui.restoreYesBtn.focus();
    });
  }

  async restoreSession(): Promise<void> {
    const state = await loadState();
    if (!state?.pages?.length) return;
    if (this._ctx.isLoading) return;
    const shouldRestore = await this._askRestoreSession();
    if (!shouldRestore) { await clearState(); return; }
    this._ctx.setIsLoading(true);
    const restoreProg = this._ctx.progress.begin('progress.restoringSession');
    try {
      for (const sp of state.sourcePdfs) {
        const spBytes = sp.bytes instanceof Uint8Array ? sp.bytes : new Uint8Array(sp.bytes);
        const bytesToStore = spBytes.slice(0); // pdf.js transfers the ArrayBuffer; copy first
        const doc = await pdfjsLib.getDocument({ data: spBytes }).promise;
        const src = this._ctx.documentModel.addSourcePdf(doc, bytesToStore, sp.name);
        // Override auto-generated id with the saved one
        this._ctx.documentModel.sourcePdfs.delete(src.id);
        src.id = sp.id;
        this._ctx.documentModel.sourcePdfs.set(sp.id, src);
      }
      this._ctx.documentModel.pages = state.pages ?? [];
      this._ctx.documentModel.watermark = state.watermark ?? this._ctx.documentModel.watermark;
      this._ctx.syncWatermarkBtn();
      this._ctx.documentModel.currentPageIndex = Math.max(0, Math.min(
        state.currentPageIndex ?? 0, this._ctx.documentModel.pages.length - 1
      ));
      // Set renderer.pdfDoc to the current page's source
      const currentSrc = this._ctx.documentModel.sourcePdfs.get(
        this._ctx.documentModel.currentPage?.sourcePdfId ?? ''
      );
      if (currentSrc) this._ctx.renderer.pdfDoc = currentSrc.doc;

      const restored = (state.elements ?? [])
        .map(d => ElementFactory.fromJSON(d as Parameters<typeof ElementFactory.fromJSON>[0]))
        .filter(Boolean) as PDFElement[];
      this._ctx.elements.push(...restored);
      ElementFactory.syncIdCounter(this._ctx.elements);
      this._ctx.setFormValues(state.formValues ?? {});
      if (state.inkData) this._ctx.inkLayer.fromJSON(state.inkData);
      this._ctx.setCurrentFilename(state.sourcePdfs[0]?.name ?? null);

      // Compute initial scale
      this._ctx.isFitMode = true;
      const fitScale = await this._ctx.renderer.computeFitScale(this._ctx.ui.container.clientWidth);
      const isMobile = window.innerWidth <= 640;
      const scale = isMobile ? Math.max(fitScale, 0.65) : fitScale;
      this._ctx.setZoom(scale);

      // BUG-38: guard against empty pages after restore
      if (!this._ctx.documentModel.pages.length || !this._ctx.documentModel.currentPage) {
        throw new Error('No valid pages in saved session');
      }

      await this._ctx.renderCurrentPage();
      this._ctx.enableUI();
      this._ctx.enableFileMenuDocItems();

      (document.getElementById('emptyState') as HTMLElement).style.display = 'none';
      this._ctx.ui.pageThumbnailContainer.style.display = '';
      await this._ctx.renderThumbnails();
      this._ctx.updatePageInfo();
      this._ctx.rebuildElementLayer();
      this._ctx.reportError.info('toast.sessionRestored');
      restoreProg.done();
    } catch (err) {
      restoreProg.failed();
      // BUG-19: reset to clean state on partial restore failure
      this._ctx.reportError.silent(err, '_restoreSession');
      this._ctx.resetDocumentModel();
      this._ctx.elements.splice(0);
      this._ctx.clearThumbnailPanel();
      this._ctx.reportError.error('toast.sessionRestoreFailed', err);
    } finally {
      this._ctx.setIsLoading(false);
    }
  }

  clearSave(): void {
    this.closeDocument();
    this._ctx.reportError.info('toast.sessionCleared');
  }

  private _promptPassword(isRetry = false): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const modal = document.getElementById('pdfPasswordModal') as HTMLElement;
      const input = document.getElementById('pdfPasswordInput') as HTMLInputElement;
      const error = document.getElementById('pdfPasswordError') as HTMLElement;
      input.value = '';
      error.style.display = isRetry ? 'block' : 'none';
      modal.style.display = 'flex';
      input.focus();
      this._ctx.setPendingPasswordResolve(resolve);
    });
  }

  openBlankPageModal(): void {
    const modal = document.getElementById('blankPageModal') as HTMLElement;
    if (!modal) return;
    modal.style.display = 'flex';
  }

  closeDocument(): void {
    clearState().catch(() => {});
    this._ctx.resetDocumentModel();
    this._ctx.elements.splice(0);
    this._ctx.setSelectedElement(null);
    this._ctx.setClipboard(null);
    this._ctx.updateCopyPasteBtns();
    this._ctx.historyManager.clear();
    this._ctx.textSearch.clearCache();
    this._ctx.clearThumbnailPanel();
    this._ctx.closeFindBar();
    this._ctx.resetSearchOptions();
    this._ctx.setCurrentFilename(null);

    this._ctx.inkLayer.clearAll();
    this._ctx.clearCanvases();

    this._ctx.ui.pageThumbnailContainer.style.display = 'none';
    this._ctx.ui.pageThumbnailContainer.innerHTML = '';

    (document.getElementById('emptyState') as HTMLElement).style.display = 'flex';
    this._ctx.disableFileMenuDocItems();
    this._ctx.rebuildElementLayer(); // clear annotation DOM nodes after model is reset
    this._ctx.reportError.info('toast.documentClosed');
  }

  async imagesToPdf(imageFiles: File[]): Promise<{ bytes: Uint8Array; name: string }> {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const pdfDoc = await PDFDocument.create();
    for (const file of imageFiles) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isJpeg = file.type === 'image/jpeg' || file.type === 'image/jpg';
      const img = isJpeg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(
        await (async () => {
          // convert non-PNG/JPEG to PNG via canvas
          if (file.type === 'image/png') return bytes;
          return new Promise<Uint8Array>((resolve, reject) => {
            const blob = URL.createObjectURL(file);
            const imgEl = new Image();
            imgEl.onerror = () => { URL.revokeObjectURL(blob); reject(new Error(`Failed to decode image: ${file.name}`)); };
            imgEl.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = imgEl.naturalWidth;
              canvas.height = imgEl.naturalHeight;
              canvas.getContext('2d')?.drawImage(imgEl, 0, 0);
              canvas.toBlob((b) => {
                if (!b) { reject(new Error('canvas.toBlob returned null')); return; }
                b.arrayBuffer().then(ab => resolve(new Uint8Array(ab)), reject);
              }, 'image/png');
              URL.revokeObjectURL(blob);
            };
            imgEl.src = blob;
          });
        })()
      );
      const page = pdfDoc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    const bytes = await pdfDoc.save();
    const baseName = imageFiles.length === 1
      ? imageFiles[0].name.replace(/\.[^.]+$/, '')
      : 'images';
    return { bytes, name: `${baseName}.pdf` };
  }

  async load(e: Event): Promise<void> {
    if (this._ctx.isLoading) return;
    this._ctx.setIsLoading(true);
    const inputEl = e.target as HTMLInputElement;
    const files = Array.from(inputEl.files ?? []);
    inputEl.value = '';

    // Route image files through image→PDF conversion
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    const pdfFiles  = files.filter(f => f.type === 'application/pdf');
    let file: File;

    if (imageFiles.length > 0 && pdfFiles.length === 0) {
      const convProg = this._ctx.progress.begin('progress.convertingImages');
      try {
        const { bytes, name } = await this.imagesToPdf(imageFiles);
        file = new File([bytes.buffer as ArrayBuffer], name, { type: 'application/pdf' });
        convProg.done();
      } catch (err) {
        convProg.failed();
        this._ctx.reportError.error('toast.imageConversionFailed', err);
        this._ctx.setIsLoading(false);
        return;
      }
    } else if (pdfFiles.length === 1 && imageFiles.length === 0) {
      file = pdfFiles[0];
    } else {
      this._ctx.reportError.warn('toast.imageMixedError');
      this._ctx.setIsLoading(false);
      return;
    }

    const loadProg = this._ctx.progress.begin('progress.loadingDocument');
    try {
      const rawBytes = new Uint8Array(await file.arrayBuffer());
      const bytesToStore = rawBytes.slice(0); // pdf.js transfers the ArrayBuffer; copy first

      // Handle password-protected PDFs with retry loop
      let doc;
      let openPassword: string | undefined;
      let isRetry = false;
      for (;;) {
        try {
          const loadOpts: Record<string, unknown> = { data: rawBytes.slice(0) };
          if (openPassword) loadOpts['password'] = openPassword;
          doc = await pdfjsLib.getDocument(loadOpts).promise;
          break;
        } catch (err) {
          // pdfjs throws PasswordException (name: 'PasswordException') for encrypted PDFs
          const isPasswordError = err instanceof Error && (
            err.name === 'PasswordException' ||
            err.message.toLowerCase().includes('password')
          );
          if (!isPasswordError) throw err;
          const pw = await this._promptPassword(isRetry);
          if (!pw) { loadProg.failed(); this._ctx.setIsLoading(false); return; } // user cancelled
          openPassword = pw;
          isRetry = true;
        }
      }

      // Reset state for new document
      this._ctx.resetDocumentModel();
      this._ctx.elements.splice(0);
      this._ctx.setFormValues({});
      this._ctx.setWarnedUnsupportedFields(false);
      this._ctx.formFieldOverlay.clear();
      this._ctx.textLayerManager.clear();
      this._ctx.textSearch.clearCache();
      this._ctx.historyManager.clear();
      this._ctx.setSelectedElement(null);
      this._ctx.setCurrentFilename(file.name);

      // Re-init thumbnail panel with new model
      this._ctx.ui.pageThumbnailContainer.innerHTML = '';
      this._ctx.reinitThumbnailPanel();

      const src = this._ctx.documentModel.addSourcePdf(doc, bytesToStore, file.name);
      this._ctx.documentModel.addPagesFrom(src.id);
      this._ctx.renderer.pdfDoc = doc;

      (document.getElementById('emptyState') as HTMLElement).style.display = 'none';
      this._ctx.isFitMode = true;
      const fitScale = await this._ctx.renderer.computeFitScale(this._ctx.ui.container.clientWidth);
      const isMobile = window.innerWidth <= 640;
      await this._ctx.applyZoom(isMobile ? Math.max(fitScale, 0.65) : fitScale);
      this._ctx.enableUI();
      this._ctx.enableFileMenuDocItems();
      this._ctx.ui.pageThumbnailContainer.style.display = '';
      await this._ctx.renderThumbnails();
      this._ctx.updatePageInfo();
      this._ctx.rebuildElementLayer();
      this._ctx.autosave();
      loadProg.done();
    } catch (err) {
      loadProg.failed();
      this._ctx.reportError.error('toast.pdfLoadFailed', err);
    } finally {
      this._ctx.setIsLoading(false);
    }
  }
}
