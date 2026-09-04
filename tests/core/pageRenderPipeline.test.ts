// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
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
  const container = document.createElement('div');
  const canvas = Object.assign(document.createElement('canvas'), { width: 200, height: 300 });
  Object.defineProperty(canvas, 'offsetLeft', { value: 10, configurable: true });
  Object.defineProperty(canvas, 'offsetTop', { value: 20, configurable: true });
  const drawWatermark = vi.fn();
  const ctx = {
    documentModel: {
      currentPageIndex: 0,
      currentPage: { sourcePdfId: 'src1', sourcePageNum: 1, rotation: 0 },
      sourcePdfs: new Map([['src1', { doc: { getPage: () => Promise.resolve(fakePage) } }]]),
      watermark: { enabled: false, text: 'DRAFT', color: '#ff0000', fontSize: 60, opacity: 0.3, angle: -45, density: 3 },
    },
    renderer,
    ui: { canvas, container },
    drawWatermark,
    exportPreviewOpen: false,
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
    commitCropRect: vi.fn(),
    bumpGen: () => ++gen,
    ...overrides,
  };
  return { ctx: ctx as unknown as IPageRenderContext, textLayerManager, formFieldOverlay, renderer, drawWatermark, container, canvas, bumpGen: () => ctx.bumpGen() };
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

describe('PageRenderPipeline live watermark overlay', () => {
  it('does NOT create a #watermarkOverlay when the watermark is disabled', async () => {
    const { ctx, container, drawWatermark } = makeCtx();
    await new PageRenderPipeline(ctx).renderCurrentPage();
    expect(container.querySelector('#watermarkOverlay')).toBeNull();
    expect(drawWatermark).not.toHaveBeenCalled();
  });

  it('creates a #watermarkOverlay canvas over the page canvas when enabled', async () => {
    const { ctx, container, drawWatermark, canvas } = makeCtx();
    (ctx.documentModel as unknown as { watermark: { enabled: boolean } }).watermark.enabled = true;
    await new PageRenderPipeline(ctx).renderCurrentPage();
    const overlay = container.querySelector('#watermarkOverlay') as HTMLCanvasElement;
    expect(overlay).not.toBeNull();
    // Sized to the page canvas bitmap and positioned at its offset.
    expect(overlay.width).toBe(canvas.width);
    expect(overlay.height).toBe(canvas.height);
    expect(overlay.style.pointerEvents).toBe('none');
    // drawWatermark is invoked with the overlay's 2D context dims (when a context exists).
    if (drawWatermark.mock.calls.length > 0) {
      expect(drawWatermark).toHaveBeenCalledWith(expect.anything(), canvas.width, canvas.height);
    }
  });

  it('removes a stale #watermarkOverlay when the watermark is turned off', async () => {
    const { ctx, container } = makeCtx();
    const model = ctx.documentModel as unknown as { watermark: { enabled: boolean } };
    model.watermark.enabled = true;
    await new PageRenderPipeline(ctx).renderCurrentPage();
    expect(container.querySelector('#watermarkOverlay')).not.toBeNull();
    model.watermark.enabled = false;
    await new PageRenderPipeline(ctx).renderCurrentPage();
    expect(container.querySelector('#watermarkOverlay')).toBeNull();
  });

  it('does NOT create the live overlay while the export preview is open (ghost owns it)', async () => {
    const { ctx, container } = makeCtx({ exportPreviewOpen: true } as Partial<IPageRenderContext>);
    (ctx.documentModel as unknown as { watermark: { enabled: boolean } }).watermark.enabled = true;
    await new PageRenderPipeline(ctx).renderCurrentPage();
    expect(container.querySelector('#watermarkOverlay')).toBeNull();
  });
});

/**
 * WS7 round 5 — the `crop` kill switch was half-applied.
 *
 * `exportPipeline` gates BOTH its paths on `isEnabled('crop')` (the vector CropBox at :303 and the
 * raster canvas clip at :531), with a comment saying a switch that kills the button rather than the
 * feature is the opposite of what a kill switch is for. `_renderCropFrame` never got that gate. So
 * with `VITE_FEATURE_CROP=false` and a session restored from IndexedDB carrying a stored crop, the
 * editor painted a dimmed frame with LIVE resize grips that still commit `SetPageCropCmd`, while the
 * export ignored the crop entirely — the user drags a handle and the output never changes.
 *
 * `main.ts` already removes the crop button and `#cropControls` when the flag is off, so this is the
 * one surface where the feature outlived its own switch rather than a deliberate asymmetry.
 */
describe('PageRenderPipeline crop frame — the #28 kill switch (WS7)', () => {
  const withCrop = () => makeCtx({
    documentModel: {
      currentPageIndex: 0,
      currentPage: { id: 'p1', sourcePdfId: 'blank', blankWidth: 200, blankHeight: 300, rotation: 0,
        crop: { x: 20, y: 30, width: 100, height: 150 } },
      sourcePdfs: new Map(),
      watermark: { enabled: false, text: '', color: '#000', fontSize: 10, opacity: 1, angle: 0, density: 3 },
    } as unknown as IPageRenderContext['documentModel'],
  });

  afterEach(() => { localStorage.removeItem('pdfturbo.feature.crop'); });

  it('paints the frame when the feature is ON — the non-vacuity control', async () => {
    const { ctx, container } = withCrop();
    await new PageRenderPipeline(ctx).renderCurrentPage();
    expect(container.querySelector('#cropFrameOverlay')).not.toBeNull();
  });

  it('paints NO frame when the crop feature is switched off', async () => {
    localStorage.setItem('pdfturbo.feature.crop', 'off');
    const { ctx, container } = withCrop();
    await new PageRenderPipeline(ctx).renderCurrentPage();
    expect(container.querySelector('#cropFrameOverlay')).toBeNull();
  });

  it('removes a frame already on screen when the switch goes off between renders', async () => {
    // The overlay is removed and rebuilt every render, so a stale frame from a pre-switch render
    // must not survive — otherwise the grips stay live on exactly the path this guard exists for.
    const { ctx, container } = withCrop();
    const pipeline = new PageRenderPipeline(ctx);
    await pipeline.renderCurrentPage();
    expect(container.querySelector('#cropFrameOverlay')).not.toBeNull();
    localStorage.setItem('pdfturbo.feature.crop', 'off');
    await pipeline.renderCurrentPage();
    expect(container.querySelector('#cropFrameOverlay')).toBeNull();
  });
});
