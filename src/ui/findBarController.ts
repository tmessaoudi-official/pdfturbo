import type { AppDOMRefs } from './uiController';
import type { PDFElement } from '../elements/annotationElement';
import type { DocumentModel } from '../core/documentModel';
import type { SearchManager } from '../core/searchManager';
import type { TextSearchHandler } from '../handlers/textSearchHandler';
import type { IErrorReporter } from '../core/errorReporter';

export interface IFindBarContext {
  readonly ui: AppDOMRefs;
  readonly elements: PDFElement[];
  readonly documentModel: DocumentModel;
  readonly zoomScale: number;
  readonly searchManager: SearchManager;
  readonly textSearch: TextSearchHandler;
  addHighlightForMatch(match: { x: number; y: number; width: number; height: number }, pageId: string): void;
  autosave(): void;
  rebuildElementLayer(): void;
  readonly reportError: IErrorReporter;
}

export class FindBarController {
  constructor(private readonly _ctx: IFindBarContext) {}

  open(): void {
    const ui = this._ctx.ui;
    ui.findBar.style.display = '';
    ui.findInput.focus();
    ui.findInput.select();
    if (ui.findInput.value) void this.search();
  }

  close(): void {
    this._ctx.ui.findBar.style.display = 'none';
    this.clearMatches();
    this._ctx.searchManager.clear();
    this._ctx.ui.findCount.textContent = '';
  }

  async search(): Promise<void> {
    this.clearMatches();
    this._ctx.searchManager.clear();
    const query = this._ctx.ui.findInput.value;
    const settled = await this._ctx.searchManager.run(query, {
      documentModel: this._ctx.documentModel,
      elements: this._ctx.elements,
      textSearchHandler: this._ctx.textSearch,
      zoomScale: this._ctx.zoomScale,
    });
    if (!settled) return;
    if (this._ctx.searchManager.count > 0) this._showMatches();
    this._updateCount();
  }

  nextMatch(): void {
    if (!this._ctx.searchManager.count) return;
    this._ctx.searchManager.next();
    this._showMatches();
    this._updateCount();
  }

  prevMatch(): void {
    if (!this._ctx.searchManager.count) return;
    this._ctx.searchManager.prev();
    this._showMatches();
    this._updateCount();
  }

  highlightCurrentMatch(): void {
    const match = this._ctx.searchManager.currentMatch;
    const pageId = this._ctx.documentModel.currentPage?.id;
    if (!match || !pageId) return;
    this._ctx.addHighlightForMatch(match, pageId);
    this._ctx.autosave();
    this._ctx.rebuildElementLayer();
    this._showMatches();
    this._ctx.reportError.info('toast.highlightAdded');
  }

  clearMatches(): void {
    this._ctx.ui.container.querySelectorAll('.search-match').forEach(el => el.remove());
  }

  private _showMatches(): void {
    this.clearMatches();
    const ui = this._ctx.ui;
    const offset = { left: ui.canvas.offsetLeft, top: ui.canvas.offsetTop };
    let activeDiv: Element | null = null;
    this._ctx.searchManager.matches.forEach((match, i) => {
      const isActive = i === this._ctx.searchManager.currentIndex;
      const div = document.createElement('div');
      div.className = 'search-match' + (isActive ? ' search-match-active' : '');
      Object.assign(div.style, {
        position: 'absolute',
        left: `${offset.left + match.x * this._ctx.zoomScale}px`,
        top: `${offset.top + match.y * this._ctx.zoomScale}px`,
        width: `${match.width * this._ctx.zoomScale}px`,
        height: `${match.height * this._ctx.zoomScale}px`,
        pointerEvents: 'none',
        zIndex: '25',
      });
      ui.container.appendChild(div);
      if (isActive) activeDiv = div;
    });
    if (activeDiv) (activeDiv as Element).scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  private _updateCount(): void {
    const sm = this._ctx.searchManager;
    const ui = this._ctx.ui;
    if (!sm.count) {
      ui.findCount.textContent = ui.findInput.value ? '0 / 0' : '';
    } else {
      ui.findCount.textContent = `${sm.currentIndex + 1} / ${sm.count}`;
    }
  }
}
