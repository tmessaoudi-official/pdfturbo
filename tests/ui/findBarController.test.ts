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
    findCount: document.createElement('span'),
    canvas: document.createElement('canvas'),
  } as unknown as Pick<AppDOMRefs, 'container' | 'findBar' | 'findInput' | 'findCount' | 'canvas'>;
}

function makeSearchManager(matches: Array<{ x: number; y: number; width: number; height: number }> = [], currentIndex = 0) {
  return {
    matches,
    count: matches.length,
    currentIndex,
    currentMatch: matches[currentIndex] ?? null,
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
    documentModel: { currentPage: { id: 'p1' } } as any,
    zoomScale: 1.0,
    searchManager: sm as any,
    textSearch: {} as any,
    addHighlightForMatch: vi.fn(),
    autosave: vi.fn(),
    rebuildElementLayer: vi.fn(),
    reportError: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() },
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
    const ctx = makeCtx({ searchManager: sm as any });
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
    const ctx = makeCtx({ searchManager: sm as any });
    const ctrl = new FindBarController(ctx);
    ctrl.nextMatch();
    expect(sm.next).toHaveBeenCalled();
  });

  it('prevMatch does nothing when count is 0', () => {
    const ctx = makeCtx();
    const ctrl = new FindBarController(ctx);
    ctrl.prevMatch();
    expect(ctx.searchManager.prev).not.toHaveBeenCalled();
  });
});

describe('FindBarController.highlightCurrentMatch', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('calls addHighlightForMatch with current match and pageId', () => {
    const match = { x: 10, y: 20, width: 50, height: 15 };
    const sm = makeSearchManager([match]);
    sm.count = 1;
    sm.currentMatch = match;
    const ctx = makeCtx({ searchManager: sm as any });
    const ctrl = new FindBarController(ctx);
    ctrl.highlightCurrentMatch();
    expect(ctx.addHighlightForMatch).toHaveBeenCalledWith(match, 'p1');
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
