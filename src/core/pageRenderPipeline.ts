import type { DocumentModel } from './documentModel';
import type { PDFRenderer } from '../infra/pdfRenderer';
import type { AppDOMRefs } from '../ui/uiController';
import type { ToolMode } from '../types/tools';
import type { FormFieldOverlay } from '../utils/formFieldOverlay';
import type { TextLayerManager } from '../utils/textLayer';
import type { IErrorReporter } from '../contracts/errorReporter';
import { contentRectToDisplay } from '../utils/geometry';

export interface IPageRenderContext {
  readonly documentModel: DocumentModel;
  readonly renderer: PDFRenderer;
  readonly ui: AppDOMRefs;
  readonly zoomScale: number;
  readonly mode: ToolMode;
  readonly formFieldOverlay: FormFieldOverlay;
  readonly textLayerManager: TextLayerManager;
  readonly reportError: IErrorReporter;
  // Form field anti-stale pattern
  advanceFormFieldGen(): number;
  isCurrentFormFieldGen(gen: number): boolean;
  // Form values
  getFormValues(sourcePdfId: string): Record<string, string>;
  setFormValue(sourcePdfId: string, fieldName: string, value: string): void;
  // Warn flag
  getWarnedUnsupportedFields(): boolean;
  setWarnedUnsupportedFields(v: boolean): void;
  // Side effects
  autosave(): void;
  renderInkLayer(): void;
}

export class PageRenderPipeline {
  constructor(private readonly _ctx: IPageRenderContext) {}

  async renderCurrentPage(): Promise<void> {
    // M0 #4 — one render epoch wraps the whole run (canvas → form → text → ink).
    // Each await is a yield point where a newer renderCurrentPage (rapid nav/zoom)
    // can start and advance the shared epoch; if that happens this run bails so it
    // never paints a stale text layer / form overlay over the newer page's canvas.
    const myGen = this._ctx.advanceFormFieldGen();
    await this._ctx.renderer.renderPageAtIndex(this._ctx.documentModel.currentPageIndex);
    if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
    await this._renderFormFields(myGen);
    if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
    await this._renderTextLayer(myGen);
    if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
    this._ctx.renderInkLayer();
    await this._renderCropFrame(myGen);
  }

  /**
   * #G23 — draw a persistent dimmed-margin frame over the canvas showing the current
   * page's crop (Design β: the page renders full; the frame communicates what export keeps).
   * Removed when there is no crop. Maps the stored content-space crop → view space via the
   * page's effective rotation. Pure presentation — skipped when the container isn't a real DOM node.
   */
  private async _renderCropFrame(myGen: number): Promise<void> {
    const container = this._ctx.ui.container;
    if (!container || typeof container.querySelector !== 'function') return;
    container.querySelector('#cropFrameOverlay')?.remove();

    const docPage = this._ctx.documentModel.currentPage;
    if (!docPage?.crop) return;

    let W: number, H: number, srcRot = 0;
    if (docPage.sourcePdfId === 'blank') {
      W = docPage.blankWidth ?? 595; H = docPage.blankHeight ?? 842;
    } else {
      const src = this._ctx.documentModel.sourcePdfs.get(docPage.sourcePdfId);
      if (!src) return;
      const page = await src.doc.getPage(docPage.sourcePageNum);
      if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
      const vp0 = page.getViewport({ scale: 1, rotation: 0 });
      W = vp0.width; H = vp0.height; srcRot = (page.rotate as number) ?? 0;
    }

    const totalRot = ((srcRot + (docPage.rotation ?? 0)) % 360 + 360) % 360;
    const disp = contentRectToDisplay(docPage.crop, W, H, totalRot);
    const dW = (totalRot === 90 || totalRot === 270) ? H : W;
    const dH = (totalRot === 90 || totalRot === 270) ? W : H;

    const z = this._ctx.zoomScale;
    const canvas = this._ctx.ui.canvas;
    const ox = canvas.offsetLeft, oy = canvas.offsetTop;
    const vx = disp.x * z + ox, vy = disp.y * z + oy;
    const vw = disp.width * z, vh = disp.height * z;
    const pageW = dW * z, pageH = dH * z;

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.id = 'cropFrameOverlay';
    Object.assign(svg.style, {
      position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
      pointerEvents: 'none', overflow: 'visible', zIndex: '9',
    });
    const dim = (x: number, y: number, w: number, h: number): void => {
      if (w <= 0 || h <= 0) return;
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', String(x)); r.setAttribute('y', String(y));
      r.setAttribute('width', String(w)); r.setAttribute('height', String(h));
      r.setAttribute('fill', 'rgba(0,0,0,0.4)');
      svg.appendChild(r);
    };
    dim(ox, oy, pageW, vy - oy);                       // top margin
    dim(ox, vy + vh, pageW, oy + pageH - (vy + vh));   // bottom margin
    dim(ox, vy, vx - ox, vh);                          // left margin
    dim(vx + vw, vy, ox + pageW - (vx + vw), vh);      // right margin
    const outline = document.createElementNS(ns, 'rect');
    outline.setAttribute('x', String(vx)); outline.setAttribute('y', String(vy));
    outline.setAttribute('width', String(vw)); outline.setAttribute('height', String(vh));
    outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke', '#2563eb');
    outline.setAttribute('stroke-width', '1.5');
    outline.setAttribute('stroke-dasharray', '5,3');
    svg.appendChild(outline);
    container.appendChild(svg);
  }

  private async _renderTextLayer(myGen: number): Promise<void> {
    const docPage = this._ctx.documentModel.currentPage;
    if (!docPage) { this._ctx.textLayerManager.clear(); return; }
    if (docPage.sourcePdfId === 'blank') { this._ctx.textLayerManager.clear(); return; }
    const src = this._ctx.documentModel.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return;
    const page = await src.doc.getPage(docPage.sourcePageNum);
    if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
    const effectiveRotation = ((page.rotate + (docPage.rotation ?? 0)) % 360 + 360) % 360;
    const viewport = page.getViewport({ scale: this._ctx.zoomScale, rotation: effectiveRotation });
    const canvasOffset = { left: this._ctx.ui.canvas.offsetLeft, top: this._ctx.ui.canvas.offsetTop };
    await this._ctx.textLayerManager.render(page, viewport, canvasOffset);
    if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
    this._ctx.textLayerManager.setPointerEvents(this._ctx.mode === 'select');
  }

  private async _renderFormFields(myGen: number): Promise<void> {
    const docPage = this._ctx.documentModel.currentPage;
    if (!docPage) { this._ctx.formFieldOverlay.clear(); return; }
    if (docPage.sourcePdfId === 'blank') { this._ctx.formFieldOverlay.clear(); return; }
    const src = this._ctx.documentModel.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return;
    const page = await src.doc.getPage(docPage.sourcePageNum);
    if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
    const effectiveRotation = ((page.rotate + (docPage.rotation ?? 0)) % 360 + 360) % 360;
    const viewport = page.getViewport({ scale: this._ctx.zoomScale, rotation: effectiveRotation });
    const canvasOffset = { left: this._ctx.ui.canvas.offsetLeft, top: this._ctx.ui.canvas.offsetTop };
    const values = this._ctx.getFormValues(docPage.sourcePdfId);
    const { unsupportedCount } = await this._ctx.formFieldOverlay.render(
      page, viewport, canvasOffset, values,
      (fieldName, value) => {
        this._ctx.setFormValue(docPage.sourcePdfId, fieldName, value);
        this._ctx.autosave();
      }
    );
    if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
    if (unsupportedCount > 0 && !this._ctx.getWarnedUnsupportedFields()) {
      this._ctx.setWarnedUnsupportedFields(true);
      this._ctx.reportError.warn('toast.unsupportedFields', { count: unsupportedCount });
    }
    this._ctx.formFieldOverlay.setPointerEvents(this._ctx.mode === 'select');
  }
}
