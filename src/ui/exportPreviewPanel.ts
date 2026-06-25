import type { PDFElement } from '../elements/annotationElement';
import type { DocumentModel } from '../core/documentModel';
import type { PDFRenderer } from '../infra/pdfRenderer';
import type { AppDOMRefs } from './uiController';
import { transformPoint } from '../utils/geometry';

export interface IExportPreviewContext {
  readonly documentModel: DocumentModel;
  readonly renderer: PDFRenderer;
  readonly ui: AppDOMRefs;
  readonly elements: PDFElement[];
  readonly zoomScale: number;
  drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  /** Re-render the page so the live watermark overlay is restored when the preview closes. */
  renderCurrentPage(): void | Promise<void>;
}

export class ExportPreviewPanel {
  private _open = false;

  constructor(private readonly _ctx: IExportPreviewContext) {}

  get isOpen(): boolean { return this._open; }

  show(): void {
    const docPage = this._ctx.documentModel.currentPage;
    if (!docPage) return;

    const canvas = this._ctx.renderer.canvas;
    const ghost = this._ctx.ui.exportPreviewGhost;
    ghost.innerHTML = '';
    ghost.style.width  = canvas.width  + 'px';
    ghost.style.height = canvas.height + 'px';
    ghost.style.left   = canvas.offsetLeft + 'px';
    ghost.style.top    = canvas.offsetTop  + 'px';

    if (this._ctx.documentModel.watermark.enabled) {
      const wmCanvas = document.createElement('canvas');
      wmCanvas.width  = canvas.width;
      wmCanvas.height = canvas.height;
      wmCanvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;';
      const ctx = wmCanvas.getContext('2d');
      if (ctx) this._ctx.drawWatermark(ctx, canvas.width, canvas.height);
      ghost.appendChild(wmCanvas);
    }

    const W = canvas.width / this._ctx.zoomScale;
    const H = canvas.height / this._ctx.zoomScale;
    const angle = docPage.rotation ?? 0;

    const pageElements = this._ctx.elements.filter(el => el.pageId === docPage.id);
    for (const el of pageElements) {
      const pdfPt = transformPoint(el.x, el.y, W, H, angle);
      const screenX = pdfPt.x * this._ctx.zoomScale;
      const screenY = (H - pdfPt.y) * this._ctx.zoomScale;
      const div = document.createElement('div');
      div.style.cssText = `position:absolute;left:${screenX}px;top:${screenY}px;width:${el.width * this._ctx.zoomScale}px;height:${el.height * this._ctx.zoomScale}px;border:3px dashed #e63946;background:rgba(230,57,70,0.15);box-sizing:border-box;`;
      ghost.appendChild(div);
    }

    // The ghost (above) now owns the watermark in preview mode — remove the live editor
    // overlay so the two don't stack into a darker double watermark. show() doesn't trigger a
    // re-render, so clear it directly here; hide() re-renders to bring it back.
    this._ctx.ui.container.querySelector('#watermarkOverlay')?.remove();

    this._open = true;
    this._ctx.ui.previewExportBtn.classList.add('active');
    this._ctx.ui.previewExportBtn.setAttribute('aria-pressed', 'true');
    this._ctx.ui.exportPreviewOverlay.style.display = '';
  }

  hide(): void {
    this._open = false;
    this._ctx.ui.previewExportBtn.classList.remove('active');
    this._ctx.ui.previewExportBtn.setAttribute('aria-pressed', 'false');
    this._ctx.ui.exportPreviewOverlay.style.display = 'none';
    this._ctx.ui.exportPreviewGhost.innerHTML = '';
    // Restore the live watermark overlay (suppressed while the preview was open).
    void this._ctx.renderCurrentPage();
  }
}
