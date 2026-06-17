import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PageService, type IPageContext } from '../../src/core/pageService';
import { DocumentModel } from '../../src/core/documentModel';
import { HistoryManager, DeletePageCmd, ReorderPagesCmd, InsertBlankPageCmd } from '../../src/core/historyManager';

vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));

function makeRenderer() {
  return {
    computeFitScale: vi.fn().mockResolvedValue(1.0),
    setScale: vi.fn(),
  };
}

function makeCtx(overrides: Partial<IPageContext> = {}): IPageContext {
  const documentModel = new DocumentModel();
  const historyManager = new HistoryManager(50, vi.fn());
  const renderer = makeRenderer();
  const reportError = {
    info:   vi.fn(),
    warn:   vi.fn(),
    error:  vi.fn(),
    silent: vi.fn(),
  };
  const progress = {
    begin: vi.fn().mockReturnValue({ done: vi.fn(), failed: vi.fn() }),
  };
  const inkLayer = { getStrokes: vi.fn().mockReturnValue([]) } as unknown as IPageContext['inkLayer'];

  return {
    documentModel,
    elements: [],
    historyManager,
    inkLayer,
    reportError,
    progress,
    renderer: renderer as unknown as IPageContext['renderer'],
    zoomScale: 1.0,
    isFitMode: false,
    pendingModeAfterBlankPage: null,
    containerWidth: 800,
    onPageStructureChange: vi.fn().mockResolvedValue(undefined),
    renderCurrentPage:     vi.fn().mockResolvedValue(undefined),
    rebuildElementLayer:   vi.fn(),
    renderInkLayer:        vi.fn(),
    updatePageInfo:        vi.fn(),
    selectElement:         vi.fn(),
    autosave:              vi.fn(),
    enableUI:              vi.fn(),
    enableFileMenuDocItems: vi.fn(),
    setMode:               vi.fn(),
    hideEmptyState:        vi.fn(),
    clearSearchMatches:    vi.fn(),
    clearSearchManagerState: vi.fn(),
    hasFindBarOpen:        vi.fn().mockReturnValue(false),
    hasFindInput:          vi.fn().mockReturnValue(false),
    clearFindCount:        vi.fn(),
    searchIfActive:        vi.fn(),
    setZoomDisplay:        vi.fn(),
    refreshExportPreviewIfOpen: vi.fn(),
    invalidateThumbnail:   vi.fn(),
    invalidateAllThumbnails: vi.fn(),
    updateActiveThumbnail: vi.fn(),
    renderThumbnails:      vi.fn().mockResolvedValue(undefined),
    ensureThumbnailPanel:  vi.fn(),
    showThumbnailContainer: vi.fn(),
    clearTextSearchCache:  vi.fn(),
    imagesToPdf:           vi.fn(),
    ...overrides,
  };
}

function addBlankPages(doc: DocumentModel, count: number) {
  for (let i = 0; i < count; i++) doc.addBlankPage(595, 842);
}

describe('PageService.deletePage', () => {
  it('warns and does nothing when deleting the only page', () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 1);
    const svc = new PageService(ctx);
    svc.deletePage(ctx.documentModel.pages[0].id);
    expect(ctx.reportError.warn).toHaveBeenCalledWith('toast.cannotDeleteOnlyPage');
    expect(ctx.documentModel.pageCount).toBe(1);
  });

  it('removes a page via historyManager when multiple pages exist', () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 2);
    const svc = new PageService(ctx);
    const idToDelete = ctx.documentModel.pages[0].id;
    vi.spyOn(ctx.historyManager, 'execute');
    svc.deletePage(idToDelete);
    expect(ctx.historyManager.execute).toHaveBeenCalledWith(expect.any(DeletePageCmd));
    expect(ctx.reportError.warn).not.toHaveBeenCalled();
  });

  it('calls onPageStructureChange after delete executes', () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 2);
    const svc = new PageService(ctx);
    svc.deletePage(ctx.documentModel.pages[0].id);
    expect(ctx.onPageStructureChange).toHaveBeenCalled();
  });
});

describe('PageService.reorderPages', () => {
  it('pushes ReorderPagesCmd with reversed order', () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 3);
    const svc = new PageService(ctx);
    const ids = ctx.documentModel.pages.map(p => p.id);
    const reversed = [...ids].reverse();
    vi.spyOn(ctx.historyManager, 'execute');
    svc.reorderPages(reversed);
    expect(ctx.historyManager.execute).toHaveBeenCalledWith(expect.any(ReorderPagesCmd));
  });

  it('calls onPageStructureChange after reorder', () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 2);
    const svc = new PageService(ctx);
    const ids = ctx.documentModel.pages.map(p => p.id);
    svc.reorderPages([ids[1], ids[0]]);
    expect(ctx.onPageStructureChange).toHaveBeenCalled();
  });
});

describe('PageService.goToPageIndex', () => {
  it('does nothing when index is out of range', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 2);
    const svc = new PageService(ctx);
    await svc.goToPageIndex(5);
    expect(ctx.renderCurrentPage).not.toHaveBeenCalled();
  });

  it('does nothing when navigating to the current page', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 3);
    ctx.documentModel.currentPageIndex = 1;
    const svc = new PageService(ctx);
    await svc.goToPageIndex(1);
    expect(ctx.renderCurrentPage).not.toHaveBeenCalled();
  });

  it('updates currentPageIndex and calls renderCurrentPage', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 3);
    const svc = new PageService(ctx);
    await svc.goToPageIndex(2);
    expect(ctx.documentModel.currentPageIndex).toBe(2);
    expect(ctx.renderCurrentPage).toHaveBeenCalled();
  });

  it('calls selectElement(null) to deselect on navigation', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 2);
    const svc = new PageService(ctx);
    await svc.goToPageIndex(1);
    expect(ctx.selectElement).toHaveBeenCalledWith(null);
  });

  it('recomputes zoom scale when isFitMode is true', async () => {
    const ctx = makeCtx({ isFitMode: true });
    addBlankPages(ctx.documentModel, 2);
    const svc = new PageService(ctx);
    await svc.goToPageIndex(1);
    expect(ctx.renderer.computeFitScale).toHaveBeenCalled();
    expect((ctx.renderer as unknown as ReturnType<typeof makeRenderer>).setScale).toHaveBeenCalled();
  });
});

describe('PageService.applyZoom', () => {
  it('ignores invalid scale values', async () => {
    const ctx = makeCtx();
    const svc = new PageService(ctx);
    await svc.applyZoom(0);
    await svc.applyZoom(-1);
    await svc.applyZoom(NaN);
    await svc.applyZoom(Infinity);
    expect(ctx.renderCurrentPage).not.toHaveBeenCalled();
  });

  it('clamps scale to [0.25, 3.0]', async () => {
    const ctx = makeCtx();
    const svc = new PageService(ctx);
    await svc.applyZoom(10);
    expect(ctx.zoomScale).toBe(3.0);
    await svc.applyZoom(0.01);
    expect(ctx.zoomScale).toBe(0.25);
  });

  it('sets renderer scale and calls renderCurrentPage', async () => {
    const ctx = makeCtx();
    const svc = new PageService(ctx);
    await svc.applyZoom(1.5);
    expect((ctx.renderer as unknown as ReturnType<typeof makeRenderer>).setScale).toHaveBeenCalledWith(1.5);
    expect(ctx.renderCurrentPage).toHaveBeenCalled();
  });

  it('updates zoom display text', async () => {
    const ctx = makeCtx();
    const svc = new PageService(ctx);
    await svc.applyZoom(1.5);
    expect(ctx.setZoomDisplay).toHaveBeenCalledWith('150%');
  });

  it('invalidates all thumbnails and rebuilds element layer', async () => {
    const ctx = makeCtx();
    const svc = new PageService(ctx);
    await svc.applyZoom(1.0);
    expect(ctx.invalidateAllThumbnails).toHaveBeenCalled();
    expect(ctx.rebuildElementLayer).toHaveBeenCalled();
  });
});

describe('PageService.insertBlankPage', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="blankPageSize"><option value="a4" selected>A4</option></select>
      <select id="blankPagePosition"><option value="end" selected>End</option></select>
    `;
  });

  it('adds a blank page to an empty document and calls hideEmptyState', async () => {
    const ctx = makeCtx();
    const svc = new PageService(ctx);
    svc.insertBlankPage();
    expect(ctx.documentModel.pageCount).toBe(1);
    await vi.waitFor(() => expect(ctx.hideEmptyState).toHaveBeenCalled());
  });

  it('adds a blank page at the end when document already has pages', () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 2);
    ctx.documentModel.currentPageIndex = 1;
    const svc = new PageService(ctx);
    svc.insertBlankPage();
    expect(ctx.documentModel.pageCount).toBe(3);
    expect(ctx.autosave).toHaveBeenCalled();
  });

  it('inserts at beginning when position=beginning', () => {
    document.body.innerHTML = `
      <select id="blankPageSize"><option value="a4" selected>A4</option></select>
      <select id="blankPagePosition"><option value="beginning" selected>Beginning</option></select>
    `;
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 1);
    const originalId = ctx.documentModel.pages[0].id;
    const svc = new PageService(ctx);
    svc.insertBlankPage();
    expect(ctx.documentModel.pages[1].id).toBe(originalId);
  });

  // M0 #9 — a failed render must surface a toast, not an unhandled rejection.
  it('routes a render failure to a toast instead of leaving it unhandled', async () => {
    const ctx = makeCtx({ renderCurrentPage: vi.fn().mockRejectedValue(new Error('render boom')) });
    addBlankPages(ctx.documentModel, 1);
    const svc = new PageService(ctx);
    svc.insertBlankPage();
    await vi.waitFor(() => expect(ctx.reportError.error).toHaveBeenCalledWith('toast.renderFailed', expect.anything()));
  });
});

// G3 — blank-page insert must go through a history command so it can be undone.
describe('PageService.insertBlankPage — undoability (G3)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="blankPageSize"><option value="a4" selected>A4</option></select>
      <select id="blankPagePosition"><option value="end" selected>End</option></select>
    `;
  });

  it('pushes an InsertBlankPageCmd onto the undo stack', () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 2);
    const svc = new PageService(ctx);
    vi.spyOn(ctx.historyManager, 'execute');
    svc.insertBlankPage();
    expect(ctx.historyManager.execute).toHaveBeenCalledWith(expect.any(InsertBlankPageCmd));
    expect(ctx.historyManager.canUndo()).toBe(true);
  });

  it('undo restores pageCount and currentPageIndex (non-empty doc)', () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 3);
    ctx.documentModel.currentPageIndex = 1;
    const svc = new PageService(ctx);

    svc.insertBlankPage();
    expect(ctx.documentModel.pageCount).toBe(4);
    // appended at end → it becomes the current page
    expect(ctx.documentModel.currentPageIndex).toBe(3);

    expect(ctx.historyManager.undo()).toBe(true);
    expect(ctx.documentModel.pageCount).toBe(3);
    expect(ctx.documentModel.currentPageIndex).toBe(1);
  });

  it('redo re-inserts the page after an undo', () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 2);
    const svc = new PageService(ctx);
    svc.insertBlankPage();
    expect(ctx.documentModel.pageCount).toBe(3);
    ctx.historyManager.undo();
    expect(ctx.documentModel.pageCount).toBe(2);
    expect(ctx.historyManager.redo()).toBe(true);
    expect(ctx.documentModel.pageCount).toBe(3);
  });

  // Edge case: undoing the FIRST-ever blank page returns the doc to empty without crashing.
  it('undo to empty document does not crash and leaves no current page', async () => {
    const ctx = makeCtx();
    const svc = new PageService(ctx);
    svc.insertBlankPage();
    expect(ctx.documentModel.pageCount).toBe(1);
    // let the wasEmpty async bootstrap settle
    await vi.waitFor(() => expect(ctx.hideEmptyState).toHaveBeenCalled());

    expect(() => ctx.historyManager.undo()).not.toThrow();
    expect(ctx.documentModel.pageCount).toBe(0);
    expect(ctx.documentModel.currentPage).toBeNull();
  });
});
