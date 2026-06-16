import type { PDFElement } from '../elements/annotationElement';

export interface IPageNavigationContext {
  renderCurrentPage(): Promise<void>;
  renderThumbnails(): Promise<void>;
  updateActiveThumbnail(): void;
  selectElement(el: PDFElement | null): void;
  updatePageInfo(): void;
  rebuildElementLayer(): void;
  autosave(): void;
}

export class PageNavigationController {
  private _pageUpdatePending = false;

  constructor(private readonly _ctx: IPageNavigationContext) {}

  async onPageStructureChange(): Promise<void> {
    if (this._pageUpdatePending) return;
    this._pageUpdatePending = true;
    try {
      await this._ctx.renderCurrentPage();
      await this._ctx.renderThumbnails();
      this._ctx.updateActiveThumbnail();
      this._ctx.selectElement(null);
      this._ctx.updatePageInfo();
      this._ctx.rebuildElementLayer();
      this._ctx.autosave();
    } finally {
      this._pageUpdatePending = false;
    }
  }
}
