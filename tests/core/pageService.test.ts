import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PageService, clampPageMm, type IPageContext } from '../../src/core/pageService';
import { DocumentModel } from '../../src/core/documentModel';
import { HistoryManager, DeletePageCmd, ReorderPagesCmd, InsertBlankPageCmd, SetPageCropCmd, MacroCmd } from '../../src/core/historyManager';

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

describe('clampPageMm (#QA-2026-06-23 P3 #4)', () => {
  it('returns the parsed value for valid positive input', () => {
    expect(clampPageMm('210', 210)).toBe(210);
    expect(clampPageMm('150.5', 210)).toBe(150.5);
  });
  it('falls back for empty / non-numeric / non-positive input', () => {
    expect(clampPageMm('', 297)).toBe(297);
    expect(clampPageMm('abc', 297)).toBe(297);
    expect(clampPageMm(undefined, 210)).toBe(210);
    expect(clampPageMm('0', 210)).toBe(210);
    expect(clampPageMm('-5', 210)).toBe(210);
  });
  it('clamps absurd values into the sane page range', () => {
    expect(clampPageMm('999999', 210)).toBeLessThanOrEqual(5080);
    expect(clampPageMm('1', 210)).toBeGreaterThanOrEqual(10);
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

  // #QA-2026-06-23 P3 (#4): custom blank-page dims must never insert a NaN-/zero-sized page.
  it('falls back to A4 dims when custom width/height inputs are empty or non-numeric', () => {
    document.body.innerHTML = `
      <select id="blankPageSize"><option value="custom" selected>Custom</option></select>
      <select id="blankPagePosition"><option value="end" selected>End</option></select>
      <input id="blankPageW" value="">
      <input id="blankPageH" value="abc">
    `;
    const ctx = makeCtx();
    const svc = new PageService(ctx);
    svc.insertBlankPage();
    const page = ctx.documentModel.pages[ctx.documentModel.pageCount - 1];
    expect(Number.isFinite(page.blankWidth)).toBe(true);
    expect(page.blankWidth).toBeGreaterThan(0);
    expect(Number.isFinite(page.blankHeight)).toBe(true);
    expect(page.blankHeight).toBeGreaterThan(0);
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

describe('PageService.cropPageByMargins (#G23 v1b)', () => {
  it('insets the page by the typed margins (595x842 blank)', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 1);
    const svc = new PageService(ctx);
    const id = ctx.documentModel.pages[0].id;
    vi.spyOn(ctx.historyManager, 'execute');
    await svc.cropPageByMargins(id, { top: 10, right: 20, bottom: 30, left: 40 }, false);
    expect(ctx.historyManager.execute).toHaveBeenCalledWith(expect.any(SetPageCropCmd));
    expect(ctx.documentModel.pages[0].crop).toEqual({ x: 40, y: 10, width: 535, height: 802 });
    expect(ctx.onPageStructureChange).toHaveBeenCalled();
  });

  it('is UNDOABLE through the same command as the drag path', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 1);
    const svc = new PageService(ctx);
    const id = ctx.documentModel.pages[0].id;
    await svc.cropPageByMargins(id, { top: 25, right: 25, bottom: 25, left: 25 }, false);
    expect(ctx.documentModel.pages[0].crop).toBeDefined();
    ctx.historyManager.undo();
    expect(ctx.documentModel.pages[0].crop).toBeUndefined();
  });

  it('warns and changes nothing when the margins swallow the page', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 1);
    const svc = new PageService(ctx);
    const id = ctx.documentModel.pages[0].id;
    vi.spyOn(ctx.historyManager, 'execute');
    await svc.cropPageByMargins(id, { top: 500, right: 0, bottom: 500, left: 0 }, false);
    expect(ctx.historyManager.execute).not.toHaveBeenCalled();
    expect(ctx.documentModel.pages[0].crop).toBeUndefined();
    expect(ctx.reportError.warn).toHaveBeenCalledWith('toast.cropMarginsTooLarge');
  });

  it('apply-to-all converts margins PER PAGE — proven with MIXED page sizes', async () => {
    // A same-size fixture cannot prove this: convert-once-and-clamp (the drag path's behaviour, the
    // very thing this improves on) produces identical output. Different sizes are the discriminator.
    const ctx = makeCtx();
    ctx.documentModel.addBlankPage(595, 842);
    ctx.documentModel.addBlankPage(300, 400);
    const svc = new PageService(ctx);
    const id = ctx.documentModel.pages[0].id;
    vi.spyOn(ctx.historyManager, 'execute');
    await svc.cropPageByMargins(id, { top: 10, right: 10, bottom: 10, left: 10 }, true);
    expect(ctx.historyManager.execute).toHaveBeenCalledWith(expect.any(MacroCmd));
    expect(ctx.documentModel.pages[0].crop).toEqual({ x: 10, y: 10, width: 575, height: 822 });
    // Clamping ONE rect would give the small page 280x380 too only by luck of the numbers; the width
    // and height here are derived from ITS OWN box, which a single clamped rect cannot produce.
    expect(ctx.documentModel.pages[1].crop).toEqual({ x: 10, y: 10, width: 280, height: 380 });
    ctx.historyManager.undo();
    for (const p of ctx.documentModel.pages) expect(p.crop).toBeUndefined();
  });

  it('DRAG apply-to-all maps the crop PROPORTIONALLY across mixed page sizes (#G23 v1d)', async () => {
    // The wiring guard. `scaleCropToPageBox` can be perfectly correct and simply not called — the
    // "two guards that could not fail" shape this repo has already had to correct once — so this
    // drives the service and reads the stored crops.
    //
    // Page 1 is 400x400 and gets a 100x100 crop at (100,100). Page 2 is 200x200, so the same
    // proportion is a 50x50 crop at (50,50). The OLD behaviour reused the absolute rect and clamped
    // it, giving page 2 a 100x100 crop at (100,100) — half its page, in the wrong place.
    const ctx = makeCtx();
    ctx.documentModel.addBlankPage(400, 400);
    ctx.documentModel.addBlankPage(200, 200);
    const svc = new PageService(ctx);
    const id = ctx.documentModel.pages[0].id;
    vi.spyOn(ctx.historyManager, 'execute');

    await svc.cropPage(id, { x: 100, y: 100, width: 100, height: 100 }, true);

    expect(ctx.documentModel.pages[0].crop).toEqual({ x: 100, y: 100, width: 100, height: 100 });
    expect(ctx.documentModel.pages[1].crop).toEqual({ x: 50, y: 50, width: 50, height: 50 });
    // One undoable step for the whole document, as before.
    expect(ctx.historyManager.execute).toHaveBeenCalledWith(expect.any(MacroCmd));
    ctx.historyManager.undo();
    for (const p of ctx.documentModel.pages) expect(p.crop).toBeUndefined();
  });

  it('DRAG apply-to-all is unchanged on a UNIFORM document', async () => {
    // The regression control: nearly every document is uniform, and there the new mapping must be
    // the exact identity — not merely close, since a float round-trip drifted the last bits before
    // the equal-box short-circuit was added.
    const ctx = makeCtx();
    ctx.documentModel.addBlankPage(595, 842);
    ctx.documentModel.addBlankPage(595, 842);
    const svc = new PageService(ctx);
    await svc.cropPage(ctx.documentModel.pages[0].id, { x: 50, y: 60, width: 200, height: 300 }, true);
    const expected = { x: 50, y: 60, width: 200, height: 300 };
    expect(ctx.documentModel.pages[0].crop).toEqual(expected);
    expect(ctx.documentModel.pages[1].crop).toEqual(expected);
  });

  it('ROTATION: a typed top margin crops the visual top, matching the drag path', async () => {
    // The bug this pins: the margins path used to ignore srcRot/p.rotation and emit ONE content rect
    // for every rotation, so on a 90-rotated page a typed "top" removed a side strip. A /Rotate 90
    // landscape scan hits this without the user rotating anything.
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 1);
    const svc = new PageService(ctx);
    const page = ctx.documentModel.pages[0];
    page.rotation = 90;
    await svc.cropPageByMargins(page.id, { top: 100, right: 0, bottom: 0, left: 0 }, false);
    const rotated = page.crop;
    // Same margin, no rotation → a different content rect. If rotation were ignored these would match,
    // which is exactly how the defect looked.
    page.rotation = 0;
    page.crop = undefined;
    await svc.cropPageByMargins(page.id, { top: 100, right: 0, bottom: 0, left: 0 }, false);
    expect(rotated).not.toEqual(page.crop);
    // And unrotated is the plain inset: 100pt off the top of a 595x842 box.
    expect(page.crop).toEqual({ x: 0, y: 100, width: 595, height: 742 });
  });

  it('does NOTHING when no margin was typed (all four empty/zero)', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 1);
    const svc = new PageService(ctx);
    vi.spyOn(ctx.historyManager, 'execute');
    await svc.cropPageByMargins(ctx.documentModel.pages[0].id, { top: 0, right: 0, bottom: 0, left: 0 }, false);
    expect(ctx.historyManager.execute).not.toHaveBeenCalled();
    // Must NOT gain a crop: a full-page crop adds a /CropBox to a page that had none, so the exported
    // bytes would stop being byte-identical for a change the user cannot even see.
    expect(ctx.documentModel.pages[0].crop).toBeUndefined();
  });

  it('warns on a PARTIAL skip — some pages cropped, a small one swallowed', async () => {
    const ctx = makeCtx();
    ctx.documentModel.addBlankPage(595, 842);
    ctx.documentModel.addBlankPage(120, 120);          // 100pt margins swallow this one
    const svc = new PageService(ctx);
    await svc.cropPageByMargins(ctx.documentModel.pages[0].id, { top: 100, right: 100, bottom: 100, left: 100 }, true);
    expect(ctx.documentModel.pages[0].crop).toBeDefined();
    expect(ctx.documentModel.pages[1].crop).toBeUndefined();
    expect(ctx.reportError.info).toHaveBeenCalledWith('toast.cropAppliedAll');
    expect(ctx.reportError.warn).toHaveBeenCalledWith('toast.cropMarginsTooLarge');
  });

  it('reports the apply-to-all toast, not the single-page one', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 2);
    const svc = new PageService(ctx);
    await svc.cropPageByMargins(ctx.documentModel.pages[0].id, { top: 5, right: 5, bottom: 5, left: 5 }, true);
    expect(ctx.reportError.info).toHaveBeenCalledWith('toast.cropAppliedAll');
  });
});

describe('PageService.cropPage', () => {
  it('stores the drawn rect as the page crop (identity at rotation 0)', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 1);
    const svc = new PageService(ctx);
    const id = ctx.documentModel.pages[0].id;
    vi.spyOn(ctx.historyManager, 'execute');
    await svc.cropPage(id, { x: 50, y: 60, width: 200, height: 300 }, false);
    expect(ctx.historyManager.execute).toHaveBeenCalledWith(expect.any(SetPageCropCmd));
    expect(ctx.documentModel.pages[0].crop).toEqual({ x: 50, y: 60, width: 200, height: 300 });
    expect(ctx.onPageStructureChange).toHaveBeenCalled();
  });

  it('clamps a drag that overflows the 595x842 page box', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 1);
    const svc = new PageService(ctx);
    const id = ctx.documentModel.pages[0].id;
    await svc.cropPage(id, { x: 500, y: 700, width: 300, height: 300 }, false);
    expect(ctx.documentModel.pages[0].crop).toEqual({ x: 500, y: 700, width: 95, height: 142 });
  });

  it('ignores a degenerate (near-zero) drag', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 1);
    const svc = new PageService(ctx);
    const id = ctx.documentModel.pages[0].id;
    vi.spyOn(ctx.historyManager, 'execute');
    await svc.cropPage(id, { x: 10, y: 10, width: 0.4, height: 0.4 }, false);
    expect(ctx.historyManager.execute).not.toHaveBeenCalled();
    expect(ctx.documentModel.pages[0].crop).toBeUndefined();
  });

  it('clears the crop when displayRect is null', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 1);
    const svc = new PageService(ctx);
    const id = ctx.documentModel.pages[0].id;
    await svc.cropPage(id, { x: 10, y: 10, width: 100, height: 100 }, false);
    expect(ctx.documentModel.pages[0].crop).toBeDefined();
    await svc.cropPage(id, null, false);
    expect(ctx.documentModel.pages[0].crop).toBeUndefined();
    expect(ctx.reportError.info).toHaveBeenCalledWith('toast.cropRemoved');
  });

  it('reports the SINGLE-page toast for a single-page crop (not the all-pages one)', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 2);
    const svc = new PageService(ctx);
    await svc.cropPage(ctx.documentModel.pages[0].id, { x: 10, y: 10, width: 100, height: 100 }, false);
    expect(ctx.reportError.info).toHaveBeenCalledWith('toast.cropApplied');
    expect(ctx.reportError.info).not.toHaveBeenCalledWith('toast.cropAppliedAll');
  });

  it('re-renders the canvas ONCE for an apply-to-all, and once more on undo', async () => {
    // _commitCrops claims onPageStructureChange fires only for the CURRENT page's command. Nothing
    // pinned it, so a refactor could fire it per page (3 redundant full re-renders) unnoticed.
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 3);
    const svc = new PageService(ctx);
    await svc.cropPage(ctx.documentModel.pages[0].id, { x: 10, y: 10, width: 100, height: 100 }, true);
    expect(ctx.onPageStructureChange).toHaveBeenCalledTimes(1);
    ctx.historyManager.undo();
    expect(ctx.onPageStructureChange).toHaveBeenCalledTimes(2);
  });

  it('apply-to-all crops every page in one MacroCmd; undo reverts all', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 3);
    const svc = new PageService(ctx);
    const id = ctx.documentModel.pages[0].id;
    vi.spyOn(ctx.historyManager, 'execute');
    await svc.cropPage(id, { x: 20, y: 20, width: 100, height: 120 }, true);
    expect(ctx.historyManager.execute).toHaveBeenCalledWith(expect.any(MacroCmd));
    for (const p of ctx.documentModel.pages) {
      expect(p.crop).toEqual({ x: 20, y: 20, width: 100, height: 120 });
    }
    expect(ctx.reportError.info).toHaveBeenCalledWith('toast.cropAppliedAll');
    ctx.historyManager.undo();
    for (const p of ctx.documentModel.pages) expect(p.crop).toBeUndefined();
  });

  it('is a no-op when the page does not exist', async () => {
    const ctx = makeCtx();
    addBlankPages(ctx.documentModel, 1);
    const svc = new PageService(ctx);
    vi.spyOn(ctx.historyManager, 'execute');
    await svc.cropPage('nope', { x: 0, y: 0, width: 10, height: 10 }, false);
    expect(ctx.historyManager.execute).not.toHaveBeenCalled();
  });
});
