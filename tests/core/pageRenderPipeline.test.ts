// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PageRenderPipeline, type IPageRenderContext } from '../../src/core/pageRenderPipeline';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function makeCtx(overrides: Partial<IPageRenderContext> = {}) {
  let gen = 0;
  const fakePage = { rotate: 0, getViewport: () => ({ width: 100, height: 100 }) };
  const textLayerManager = { render: vi.fn().mockResolvedValue(undefined), clear: vi.fn(), setPointerEvents: vi.fn() };
  const formFieldOverlay = { render: vi.fn().mockResolvedValue({ unsupportedCount: 0 }), clear: vi.fn(), setPointerEvents: vi.fn() };
  const renderer = { renderPageAtIndex: vi.fn().mockResolvedValue(undefined) };
  const ctx = {
    documentModel: {
      currentPageIndex: 0,
      currentPage: { sourcePdfId: 'src1', sourcePageNum: 1, rotation: 0 },
      sourcePdfs: new Map([['src1', { doc: { getPage: () => Promise.resolve(fakePage) } }]]),
    },
    renderer,
    ui: { canvas: { offsetLeft: 0, offsetTop: 0 } },
    zoomScale: 1,
    mode: 'select',
    formFieldOverlay,
    textLayerManager,
    reportError: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() },
    advanceFormFieldGen: () => ++gen,
    isCurrentFormFieldGen: (g: number) => g === gen,
    getFormValues: () => ({}),
    setFormValue: vi.fn(),
    getWarnedUnsupportedFields: () => false,
    setWarnedUnsupportedFields: vi.fn(),
    autosave: vi.fn(),
    renderInkLayer: vi.fn(),
    bumpGen: () => ++gen,
    ...overrides,
  };
  return { ctx: ctx as unknown as IPageRenderContext, textLayerManager, formFieldOverlay, renderer, bumpGen: () => ctx.bumpGen() };
}

describe('PageRenderPipeline epoch guard (M0 #4)', () => {
  it('renders the text layer and form fields for a normal (un-superseded) run', async () => {
    const { ctx, textLayerManager, formFieldOverlay } = makeCtx();
    await new PageRenderPipeline(ctx).renderCurrentPage();
    expect(textLayerManager.render).toHaveBeenCalledTimes(1);
    expect(formFieldOverlay.render).toHaveBeenCalledTimes(1);
  });

  it('bails out of the text layer when a newer render supersedes mid-flight', async () => {
    const d = deferred<void>();
    const { ctx, textLayerManager, formFieldOverlay, bumpGen } = makeCtx({
      renderer: { renderPageAtIndex: vi.fn().mockReturnValue(d.promise) } as unknown as IPageRenderContext['renderer'],
    });
    const p = new PageRenderPipeline(ctx).renderCurrentPage(); // captures the epoch, awaits the canvas
    bumpGen(); // a newer renderCurrentPage started and advanced the shared epoch
    d.resolve();
    await p;
    // Stale run must not paint the text layer or form fields over the newer page.
    expect(textLayerManager.render).not.toHaveBeenCalled();
    expect(formFieldOverlay.render).not.toHaveBeenCalled();
  });
});
