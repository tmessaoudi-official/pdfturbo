import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { DocumentModel } from '../core/documentModel';
// ?worker&url tells Vite to bundle this entry (polyfills + pdfjs worker) into a hashed
// worker chunk and return its URL — needed to polyfill Math.sumPrecise in the worker scope.
import pdfjsWorkerShimUrl from '../utils/pdf-worker-shim?worker&url';

// Worker shim polyfills Math.sumPrecise before pdfjs worker code, ensuring correct font
// rendering in browsers without native support (Chrome/Edge <137).
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

export class PDFRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Legacy compat: first loaded PDF doc (used for computeFitScale and initial state) */
  pdfDoc: PDFDocumentProxy | null = null;
  scale = 1.0;
  private isRendering = false;
  private pendingPage: { doc: PDFDocumentProxy; pageNum: number; userRotation: number } | null = null;
  private _pendingResolve: (() => void) | null = null;
  private _model: DocumentModel | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable — browser may be in privacy mode');
    this.ctx = ctx;
  }

  setModel(model: DocumentModel): void {
    this._model = model;
  }

  get currentPage(): number {
    return (this._model?.currentPageIndex ?? 0) + 1;
  }

  get pageCount(): number {
    return this._model?.pageCount ?? (this.pdfDoc ? this.pdfDoc.numPages : 0);
  }

  setScale(scale: number): void {
    this.scale = Math.max(0.25, Math.min(3.0, scale));
  }

  computeFitScale(containerWidth: number): Promise<number> {
    const model = this._model;
    if (model?.currentPage) {
      const docPage = model.currentPage;
      if (docPage.sourcePdfId === 'blank' && docPage.blankWidth) {
        return Promise.resolve(Math.max(0.25, (containerWidth - 40) / docPage.blankWidth));
      }
      const src = model.sourcePdfs.get(docPage.sourcePdfId);
      if (src) {
        return src.doc.getPage(docPage.sourcePageNum).then((page: PDFPageProxy) => {
          const effectiveRotation = (page.rotate + (docPage.rotation ?? 0)) % 360;
          const vp = page.getViewport({ scale: 1, rotation: effectiveRotation });
          return Math.max(0.25, (containerWidth - 40) / vp.width);
        });
      }
    }
    // Legacy fallback
    const doc = this.pdfDoc;
    if (!doc) return Promise.resolve(1.0);
    return doc.getPage(1).then((page: PDFPageProxy) => {
      const vp = page.getViewport({ scale: 1 });
      return Math.max(0.25, (containerWidth - 40) / vp.width);
    });
  }

  async loadPDF(fileData: ArrayBuffer): Promise<PDFDocumentProxy> {
    const typedArray = new Uint8Array(fileData);
    const doc = await pdfjsLib.getDocument({ data: typedArray }).promise;
    this.pdfDoc = doc;
    return doc;
  }

  /** Render the page at documentModel.currentPageIndex */
  async renderCurrentPage(): Promise<void> {
    const model = this._model;
    if (!model || !model.currentPage) return;
    const docPage = model.currentPage;
    if (docPage.sourcePdfId === 'blank') {
      this._renderBlankPage(docPage.blankWidth ?? 595, docPage.blankHeight ?? 842);
      return;
    }
    const src = model.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return;
    await this._renderPdfPage(src.doc, docPage.sourcePageNum, docPage.rotation ?? 0);
  }

  async renderPageAtIndex(index: number): Promise<void> {
    const model = this._model;
    if (!model) {
      // Fallback for legacy call without model
      if (this.pdfDoc) await this._renderPdfPage(this.pdfDoc, index + 1);
      return;
    }
    const docPage = model.pages[index];
    if (!docPage) return;
    if (docPage.sourcePdfId === 'blank') {
      this._renderBlankPage(docPage.blankWidth ?? 595, docPage.blankHeight ?? 842);
      return;
    }
    const src = model.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return;
    await this._renderPdfPage(src.doc, docPage.sourcePageNum, docPage.rotation ?? 0);
  }

  /** Render a specific page from a specific pdf.js document */
  private async _renderPdfPage(doc: PDFDocumentProxy, pageNum: number, userRotation = 0): Promise<void> {
    if (this.isRendering) {
      return new Promise<void>((resolve) => {
        // Resolve any previously queued Promise before overwriting (BUG-08 fix)
        if (this._pendingResolve) this._pendingResolve();
        this.pendingPage = { doc, pageNum, userRotation };
        this._pendingResolve = resolve;
      });
    }
    this.isRendering = true;
    try {
      const page = await doc.getPage(pageNum);
      const effectiveRotation = (page.rotate + userRotation) % 360;
      const viewport = page.getViewport({ scale: this.scale, rotation: effectiveRotation });
      this.canvas.height = viewport.height;
      this.canvas.width = viewport.width;
      await page.render({ canvas: this.canvas, viewport }).promise;
    } finally {
      this.isRendering = false;  // BUG-05 fix: always release lock
    }
    if (this.pendingPage !== null) {
      const { doc: pendingDoc, pageNum: pending, userRotation: pendingRot } = this.pendingPage;
      const pendingResolve = this._pendingResolve;
      this.pendingPage = null;
      this._pendingResolve = null;
      try {
        await this._renderPdfPage(pendingDoc, pending, pendingRot);
      } finally {
        if (pendingResolve) pendingResolve();
      }
    }
  }

  /** Generate a thumbnail data URL for a page at a given document index */
  async generateThumbnail(docIndex: number, thumbScale = 0.15): Promise<string> {
    const model = this._model;
    if (!model) return '';
    const docPage = model.pages[docIndex];
    if (!docPage) return '';

    if (docPage.sourcePdfId === 'blank') {
      const w = Math.round((docPage.blankWidth ?? 595) * thumbScale);
      const h = Math.round((docPage.blankHeight ?? 842) * thumbScale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#e2e8f0';
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      return canvas.toDataURL('image/jpeg', 0.7);
    }

    const src = model.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return '';

    const page = await src.doc.getPage(docPage.sourcePageNum);
    const effectiveRotation = (page.rotate + (docPage.rotation ?? 0)) % 360;
    const vp = page.getViewport({ scale: thumbScale, rotation: effectiveRotation });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    await page.render({ canvas, viewport: vp }).promise;
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  private _renderBlankPage(widthPt: number, heightPt: number): void {
    this.canvas.width  = Math.round(widthPt  * this.scale);
    this.canvas.height = Math.round(heightPt * this.scale);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  getPageInfo(): { current: number; total: number } {
    return {
      current: this.currentPage,
      total: this.pageCount,
    };
  }
}
