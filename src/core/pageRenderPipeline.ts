import type { DocumentModel } from './documentModel';
import type { PDFRenderer } from '../infra/pdfRenderer';
import type { AppDOMRefs } from '../ui/uiController';
import type { ToolMode } from '../types/tools';
import type { FormFieldOverlay } from '../utils/formFieldOverlay';
import type { TextLayerManager } from '../utils/textLayer';
import type { IErrorReporter } from '../contracts/errorReporter';

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
    await this._ctx.renderer.renderPageAtIndex(this._ctx.documentModel.currentPageIndex);
    await this._renderFormFields();
    await this._renderTextLayer();
    this._ctx.renderInkLayer();
  }

  private async _renderTextLayer(): Promise<void> {
    const docPage = this._ctx.documentModel.currentPage;
    if (!docPage) { this._ctx.textLayerManager.clear(); return; }
    if (docPage.sourcePdfId === 'blank') { this._ctx.textLayerManager.clear(); return; }
    const src = this._ctx.documentModel.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return;
    const page = await src.doc.getPage(docPage.sourcePageNum);
    const effectiveRotation = ((page.rotate + (docPage.rotation ?? 0)) % 360 + 360) % 360;
    const viewport = page.getViewport({ scale: this._ctx.zoomScale, rotation: effectiveRotation });
    const canvasOffset = { left: this._ctx.ui.canvas.offsetLeft, top: this._ctx.ui.canvas.offsetTop };
    await this._ctx.textLayerManager.render(page, viewport, canvasOffset);
    this._ctx.textLayerManager.setPointerEvents(this._ctx.mode === 'select');
  }

  private async _renderFormFields(): Promise<void> {
    const myGen = this._ctx.advanceFormFieldGen();
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
