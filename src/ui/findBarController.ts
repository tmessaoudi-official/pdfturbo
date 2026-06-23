import type { AppDOMRefs } from './uiController';
import type { PDFElement } from '../elements/annotationElement';
import type { DocumentModel } from '../core/documentModel';
import type { SearchManager } from '../core/searchManager';
import type { TextSearchHandler } from '../handlers/textSearchHandler';
import type { IErrorReporter } from '../core/errorReporter';
import { applyReplacement } from '../core/overlayReplace';

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
  /**
   * Switch the displayed document page to `pageId` and re-render it WITHOUT
   * clearing the active search results/index (G13 cross-page navigation).
   * No-op when `pageId` is already the current page.
   */
  navigateToMatchPage(pageId: string): Promise<void>;
  readonly reportError: IErrorReporter;
  /** Apply find&replace edits to overlay text/comment elements (undoable). Returns the count changed. */
  replaceOverlayText(edits: { elementId: number; newText: string }[]): number;
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

  async nextMatch(): Promise<void> {
    if (!this._ctx.searchManager.count) return;
    this._ctx.searchManager.next();
    await this._goToCurrentMatchPage();
    this._showMatches();
    this._updateCount();
  }

  async prevMatch(): Promise<void> {
    if (!this._ctx.searchManager.count) return;
    this._ctx.searchManager.prev();
    await this._goToCurrentMatchPage();
    this._showMatches();
    this._updateCount();
  }

  /** Read the current text of an overlay element by id (text/comment carry `.text`). */
  private _overlayText(elementId: number): string | null {
    const el = this._ctx.elements.find(e => e.id === elementId);
    const raw = (el as { text?: unknown } | undefined)?.text;
    return typeof raw === 'string' ? raw : null;
  }

  /**
   * Replace within the CURRENT match's overlay element (all occurrences of the query in that
   * element's text), then re-run the search. Source-PDF-text matches are not editable here — the
   * Edit-text tool handles those — so they no-op with a hint.
   */
  replaceCurrent(): void {
    const sm = this._ctx.searchManager;
    const match = sm.currentMatch;
    if (!match) return;
    if (match.elementId === undefined) { this._ctx.reportError.info('toast.replaceSourceSkipped'); return; }
    const text = this._overlayText(match.elementId);
    if (text === null) return;
    const newText = applyReplacement(text, this._ctx.ui.findInput.value, this._ctx.ui.replaceInput.value,
      { caseSensitive: sm.caseSensitive, regex: sm.regex });
    const n = this._ctx.replaceOverlayText([{ elementId: match.elementId, newText }]);
    if (n > 0) this._ctx.reportError.info('toast.replaceDone');
    void this.search();
  }

  /** Replace across ALL matched overlay elements in one undoable step, then re-run the search. */
  replaceAll(): void {
    const sm = this._ctx.searchManager;
    const query = this._ctx.ui.findInput.value;
    const replacement = this._ctx.ui.replaceInput.value;
    const seen = new Set<number>();
    const edits: { elementId: number; newText: string }[] = [];
    for (const m of sm.matches) {
      if (m.elementId === undefined || seen.has(m.elementId)) continue;
      seen.add(m.elementId);
      const text = this._overlayText(m.elementId);
      if (text === null) continue;
      edits.push({ elementId: m.elementId, newText: applyReplacement(text, query, replacement, { caseSensitive: sm.caseSensitive, regex: sm.regex }) });
    }
    if (edits.length === 0) { this._ctx.reportError.info('toast.replaceNoOverlay'); return; }
    const n = this._ctx.replaceOverlayText(edits);
    if (n > 0) this._ctx.reportError.info('toast.replaceAllDone', { count: n });
    void this.search();
  }

  highlightCurrentMatch(): void {
    const match = this._ctx.searchManager.currentMatch;
    if (!match) return;
    // Highlight on the match's OWN page (G13) — not the displayed page, which may
    // differ momentarily; cross-page nav already switched to it in next/prevMatch.
    this._ctx.addHighlightForMatch(match, match.pageId);
    this._ctx.autosave();
    this._ctx.rebuildElementLayer();
    this._showMatches();
    this._ctx.reportError.info('toast.highlightAdded');
  }

  /** G13: if the current match lives on a page other than the displayed one,
   *  navigate there (preserving search state) before highlighting/scrolling. */
  private async _goToCurrentMatchPage(): Promise<void> {
    const match = this._ctx.searchManager.currentMatch;
    if (!match) return;
    if (match.pageId === this._ctx.documentModel.currentPage?.id) return;
    await this._ctx.navigateToMatchPage(match.pageId);
  }

  clearMatches(): void {
    this._ctx.ui.container.querySelectorAll('.search-match').forEach(el => el.remove());
  }

  private _showMatches(): void {
    this.clearMatches();
    const ui = this._ctx.ui;
    const offset = { left: ui.canvas.offsetLeft, top: ui.canvas.offsetTop };
    // Match coords are in the page's own canvas space; only the currently-displayed
    // page is rendered, so render only its matches (G13). The active match's page is
    // already current here (cross-page nav ran first), so it always shows.
    const currentPageId = this._ctx.documentModel.currentPage?.id;
    let activeDiv: Element | null = null;
    this._ctx.searchManager.matches.forEach((match, i) => {
      if (match.pageId !== currentPageId) return;
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
