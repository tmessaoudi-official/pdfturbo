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
  private _rerunRequested = false;

  constructor(private readonly _ctx: IPageNavigationContext) {}

  async onPageStructureChange(): Promise<void> {
    // Trailing-edge coalesce: a request that arrives while an update is in
    // flight is not dropped (which left thumbnails/page-info stale after the
    // LAST of several rapid structure changes); it schedules exactly one re-run
    // after the current pass. Any number of concurrent requests collapse into
    // that single re-run.
    if (this._pageUpdatePending) { this._rerunRequested = true; return; }
    this._pageUpdatePending = true;
    try {
      do {
        this._rerunRequested = false;
        await this._ctx.renderCurrentPage();
        await this._ctx.renderThumbnails();
        this._ctx.updateActiveThumbnail();
        this._ctx.selectElement(null);
        this._ctx.updatePageInfo();
        this._ctx.rebuildElementLayer();
        this._ctx.autosave();
      } while (this._rerunRequested);
    } finally {
      this._pageUpdatePending = false;
      this._rerunRequested = false;
    }
  }
}
