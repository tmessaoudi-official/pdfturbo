import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FindBarController, type IFindBarContext } from '../../src/ui/findBarController';
import type { AppDOMRefs } from '../../src/ui/uiController';

Element.prototype.scrollIntoView = vi.fn();

function makeUI() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return {
    container,
    findBar: Object.assign(document.createElement('div'), { style: { display: 'none' } }),
    findInput: document.createElement('input'),
    replaceInput: document.createElement('input'),
    findCount: document.createElement('span'),
    canvas: document.createElement('canvas'),
  } as unknown as Pick<AppDOMRefs, 'container' | 'findBar' | 'findInput' | 'replaceInput' | 'findCount' | 'canvas'>;
}

function makeSearchManager(matches: Array<{ x: number; y: number; width: number; height: number; elementId?: number }> = [], currentIndex = 0) {
  return {
    matches,
    count: matches.length,
    currentIndex,
    currentMatch: matches[currentIndex] ?? null,
    caseSensitive: false,
    regex: false,
    clear: vi.fn(),
    run: vi.fn().mockResolvedValue(true),
    next: vi.fn(),
    prev: vi.fn(),
  };
}

function makeCtx(overrides: Partial<IFindBarContext> = {}): IFindBarContext {
  const sm = makeSearchManager();
  return {
    ui: makeUI() as unknown as AppDOMRefs,
    elements: [],
    documentModel: { currentPage: { id: 'p1' } } as unknown as IFindBarContext['documentModel'],
    zoomScale: 1.0,
    searchManager: sm as unknown as IFindBarContext['searchManager'],
    textSearch: {} as unknown as IFindBarContext['textSearch'],
    addHighlightForMatch: vi.fn(),
    autosave: vi.fn(),
    rebuildElementLayer: vi.fn(),
    navigateToMatchPage: vi.fn().mockResolvedValue(undefined),
    reportError: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() },
    replaceOverlayText: vi.fn().mockReturnValue(1),
    ...overrides,
  };
}

describe('FindBarController.open', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('sets findBar display to empty string', () => {
    const ctx = makeCtx();
    const ctrl = new FindBarController(ctx);
    ctrl.open();
    expect(ctx.ui.findBar.style.display).toBe('');
  });

  it('does not call search when findInput is empty', () => {
    const ctx = makeCtx();
    const ctrl = new FindBarController(ctx);
    ctrl.open();
    expect(ctx.searchManager.run).not.toHaveBeenCalled();
  });
});

describe('FindBarController.close', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('hides findBar', () => {
    const ctx = makeCtx();
    const ctrl = new FindBarController(ctx);
    ctrl.open();
    ctrl.close();
    expect(ctx.ui.findBar.style.display).toBe('none');
  });

  it('clears searchManager state', () => {
    const ctx = makeCtx();
    const ctrl = new FindBarController(ctx);
    ctrl.close();
    expect(ctx.searchManager.clear).toHaveBeenCalled();
  });

  it('clears findCount text', () => {
    const ctx = makeCtx();
    const ctrl = new FindBarController(ctx);
    ctx.ui.findCount.textContent = '1 / 3';
    ctrl.close();
    expect(ctx.ui.findCount.textContent).toBe('');
  });
});

describe('FindBarController.search', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('calls searchManager.run with correct params', async () => {
    const ctx = makeCtx();
    ctx.ui.findInput.value = 'hello';
    const ctrl = new FindBarController(ctx);
    await ctrl.search();
    expect(ctx.searchManager.run).toHaveBeenCalledWith('hello', expect.objectContaining({
      documentModel: ctx.documentModel,
      elements: ctx.elements,
      zoomScale: ctx.zoomScale,
    }));
  });

  it('does not show matches when settled is false', async () => {
    const sm = makeSearchManager([{ x: 0, y: 0, width: 10, height: 10 }]);
    sm.run = vi.fn().mockResolvedValue(false);
    const ctx = makeCtx({ searchManager: sm as unknown as IFindBarContext['searchManager'] });
    const ctrl = new FindBarController(ctx);
    await ctrl.search();
    expect(ctx.ui.container.querySelectorAll('.search-match').length).toBe(0);
  });
});

describe('FindBarController.nextMatch / prevMatch', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('nextMatch calls searchManager.next when count > 0', () => {
    const sm = makeSearchManager([{ x: 0, y: 0, width: 10, height: 10 }]);
    sm.count = 1;
    const ctx = makeCtx({ searchManager: sm as unknown as IFindBarContext['searchManager'] });
    const ctrl = new FindBarController(ctx);
    ctrl.nextMatch();
    expect(sm.next).toHaveBeenCalled();
  });

  it('prevMatch does nothing when count is 0', () => {
    const ctx = makeCtx();
    const ctrl = new FindBarController(ctx);
    void ctrl.prevMatch();
    expect(ctx.searchManager.prev).not.toHaveBeenCalled();
  });

  it('nextMatch navigates to the match page when it differs from the displayed page (G13)', async () => {
    const match = { pageId: 'p2', x: 0, y: 0, width: 10, height: 10 };
    const sm = makeSearchManager([match]);
    sm.count = 1;
    sm.currentMatch = match;
    // displayed page is p1, match lives on p2
    const ctx = makeCtx({
      searchManager: sm as unknown as IFindBarContext['searchManager'],
      documentModel: { currentPage: { id: 'p1' } } as unknown as IFindBarContext['documentModel'],
    });
    const ctrl = new FindBarController(ctx);
    await ctrl.nextMatch();
    expect(sm.next).toHaveBeenCalled();
    expect(ctx.navigateToMatchPage).toHaveBeenCalledWith('p2');
  });

  it('nextMatch does NOT navigate when the match is on the displayed page (single-page unchanged)', async () => {
    const match = { pageId: 'p1', x: 0, y: 0, width: 10, height: 10 };
    const sm = makeSearchManager([match]);
    sm.count = 1;
    sm.currentMatch = match;
    const ctx = makeCtx({
      searchManager: sm as unknown as IFindBarContext['searchManager'],
      documentModel: { currentPage: { id: 'p1' } } as unknown as IFindBarContext['documentModel'],
    });
    const ctrl = new FindBarController(ctx);
    await ctrl.nextMatch();
    expect(ctx.navigateToMatchPage).not.toHaveBeenCalled();
  });
});

describe('FindBarController.highlightCurrentMatch', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('calls addHighlightForMatch with current match and the MATCH\'s own pageId (G13)', () => {
    // G13: highlight on the match's own page, not the displayed page — they may
    // differ momentarily during cross-page navigation.
    const match = { pageId: 'p2', x: 10, y: 20, width: 50, height: 15 };
    const sm = makeSearchManager([match]);
    sm.count = 1;
    sm.currentMatch = match;
    const ctx = makeCtx({ searchManager: sm as unknown as IFindBarContext['searchManager'] });
    const ctrl = new FindBarController(ctx);
    ctrl.highlightCurrentMatch();
    expect(ctx.addHighlightForMatch).toHaveBeenCalledWith(match, 'p2');
  });

  it('does nothing when there is no current match', () => {
    const ctx = makeCtx();
    const ctrl = new FindBarController(ctx);
    ctrl.highlightCurrentMatch();
    expect(ctx.addHighlightForMatch).not.toHaveBeenCalled();
  });
});

describe('FindBarController.clearMatches', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('removes all .search-match elements from container', () => {
    const ctx = makeCtx();
    const div = document.createElement('div');
    div.className = 'search-match';
    ctx.ui.container.appendChild(div);
    const ctrl = new FindBarController(ctx);
    ctrl.clearMatches();
    expect(ctx.ui.container.querySelectorAll('.search-match').length).toBe(0);
  });
});

describe('FindBarController find & replace (Option 3 #1)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('replaceCurrent replaces in the current overlay element and re-runs the search', () => {
    const sm = makeSearchManager([{ x: 0, y: 0, width: 10, height: 10, elementId: 7 }], 0);
    const replaceOverlayText = vi.fn().mockReturnValue(1);
    const ctx = makeCtx({
      searchManager: sm as unknown as IFindBarContext['searchManager'],
      elements: [{ id: 7, text: 'foo foo' } as unknown as IFindBarContext['elements'][number]],
      replaceOverlayText,
    });
    ctx.ui.findInput.value = 'foo';
    ctx.ui.replaceInput.value = 'bar';
    new FindBarController(ctx).replaceCurrent();
    expect(replaceOverlayText).toHaveBeenCalledWith([{ elementId: 7, newText: 'bar bar' }]);
    expect(sm.run).toHaveBeenCalled(); // re-ran search
  });

  it('replaceCurrent on a SOURCE-text match (no elementId) is a no-op with a hint', () => {
    const sm = makeSearchManager([{ x: 0, y: 0, width: 10, height: 10 }], 0); // no elementId
    const replaceOverlayText = vi.fn();
    const ctx = makeCtx({ searchManager: sm as unknown as IFindBarContext['searchManager'], replaceOverlayText });
    ctx.ui.findInput.value = 'x'; ctx.ui.replaceInput.value = 'y';
    new FindBarController(ctx).replaceCurrent();
    expect(replaceOverlayText).not.toHaveBeenCalled();
    expect(ctx.reportError.info).toHaveBeenCalledWith('toast.replaceSourceSkipped');
  });

  it('replaceAll edits every distinct overlay element once, skipping source matches', () => {
    const sm = makeSearchManager([
      { x: 0, y: 0, width: 10, height: 10, elementId: 1 },
      { x: 0, y: 0, width: 10, height: 10 },          // source match — skipped
      { x: 0, y: 0, width: 10, height: 10, elementId: 2 },
    ], 0);
    const replaceOverlayText = vi.fn().mockReturnValue(2);
    const ctx = makeCtx({
      searchManager: sm as unknown as IFindBarContext['searchManager'],
      elements: [
        { id: 1, text: 'a A' } as unknown as IFindBarContext['elements'][number],
        { id: 2, text: 'AA' } as unknown as IFindBarContext['elements'][number],
      ],
      replaceOverlayText,
    });
    ctx.ui.findInput.value = 'a'; ctx.ui.replaceInput.value = 'z';
    new FindBarController(ctx).replaceAll();
    expect(replaceOverlayText).toHaveBeenCalledWith([
      { elementId: 1, newText: 'z z' },
      { elementId: 2, newText: 'zz' },
    ]);
  });

  it('replaceAll with no overlay matches warns and does not edit', () => {
    const sm = makeSearchManager([{ x: 0, y: 0, width: 10, height: 10 }], 0); // source only
    const replaceOverlayText = vi.fn();
    const ctx = makeCtx({ searchManager: sm as unknown as IFindBarContext['searchManager'], replaceOverlayText });
    ctx.ui.findInput.value = 'x'; ctx.ui.replaceInput.value = 'y';
    new FindBarController(ctx).replaceAll();
    expect(replaceOverlayText).not.toHaveBeenCalled();
    expect(ctx.reportError.info).toHaveBeenCalledWith('toast.replaceNoOverlay');
  });
});
