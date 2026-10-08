// @vitest-environment jsdom
/**
 * QUAL-1 (review 2026-10-07). Closing or replacing a document never released its pdf.js
 * documents: `resetDocumentModel()` dropped the model and left every source's worker transport
 * alive, one per document opened in the session. It now releases them (`loadingTask.destroy()`,
 * pdf.js v6 has no `PDFDocumentProxy.destroy()`).
 *
 * A release cancels whatever is in flight on that document, so the release is only safe if the
 * readers that can still hold it settle quietly: the canvas render and the thumbnail (the
 * renderer) and the text-layer / form / crop reads (the page pipeline). Each one drops an error
 * only when the document is provably no longer current — the renderer's model no longer holds it,
 * or the model the pipeline run read was replaced — and rethrows otherwise. The controls are what keep that
 * from being a swallow: the same error on a document that is still current still escapes.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFRenderer } from '../../src/infra/pdfRenderer';
import { DocumentModel } from '../../src/core/documentModel';
import { PageRenderPipeline, type IPageRenderContext } from '../../src/core/pageRenderPipeline';
import { PDFTurboApp } from '../../src/core/pdfTurboApp';

vi.mock('../../src/utils/viewerVerdict', () => ({ inheritViewerVerdict: vi.fn(), prewarmViewerVerdict: vi.fn() }));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const fakePage = {
  rotate: 0,
  getViewport: () => ({ width: 100, height: 100 }),
  render: () => ({ promise: Promise.resolve() }),
};

/** A document whose getPage waits on the test — the moment a release lands mid-flight. */
function pendingDoc() {
  const d = deferred<typeof fakePage>();
  const doc = { numPages: 1, getPage: vi.fn(() => d.promise) } as unknown as PDFDocumentProxy;
  return { doc, d };
}

const goodDoc = () => ({ numPages: 1, getPage: vi.fn(() => Promise.resolve(fakePage)) }) as unknown as PDFDocumentProxy;

function canvas() {
  const c = document.createElement('canvas');
  c.getContext = vi.fn().mockReturnValue({}) as typeof c.getContext;
  return c;
}

function modelOf(doc: PDFDocumentProxy): DocumentModel {
  const m = new DocumentModel();
  m.addPagesFrom(m.addSourcePdf(doc, new Uint8Array(), 'a.pdf').id);
  return m;
}

// pdf.js's own words for an in-flight render on a released document (measured in Chrome).
const cancelled = () => Object.assign(new Error('Rendering cancelled, page 1'), { name: 'RenderingCancelledException' });

type Renderable = { _renderPdfPage(doc: PDFDocumentProxy, n: number): Promise<void>; isRendering: boolean };

describe('the renderer drops a failure on a document its model no longer holds (QUAL-1)', () => {
  it('a canvas render in flight when the document is replaced and released settles quietly', async () => {
    const r = new PDFRenderer(canvas());
    const { doc, d } = pendingDoc();
    r.setModel(modelOf(doc));
    const rendering = r.renderPageAtIndex(0);
    r.setModel(modelOf(goodDoc()));
    d.reject(cancelled());
    await expect(rendering).resolves.toBeUndefined();
    expect((r as unknown as Renderable).isRendering).toBe(false);
  });

  it('control: the same failure on the document the model still holds escapes', async () => {
    const r = new PDFRenderer(canvas());
    const { doc, d } = pendingDoc();
    r.setModel(modelOf(doc));
    const rendering = r.renderPageAtIndex(0);
    d.reject(cancelled());
    await expect(rendering).rejects.toThrow('Rendering cancelled');
  });

  it('a render queued behind the dropped one still runs and settles', async () => {
    const r = new PDFRenderer(canvas());
    const { doc, d } = pendingDoc();
    r.setModel(modelOf(doc));
    const first = r.renderPageAtIndex(0);
    const next = goodDoc();
    r.setModel(modelOf(next));
    const queued = r.renderPageAtIndex(0); // queued: the first still holds the render lock
    d.reject(cancelled());
    await expect(first).resolves.toBeUndefined();
    await expect(queued).resolves.toBeUndefined();
    expect(next.getPage).toHaveBeenCalledTimes(1);
  });

  // Panel round 1: a rethrown failure skipped the queued-page block, so the queued render never ran and its promise
  // never settled (pre-existing; the escaping rejection was the only sign of it).
  it('a render queued behind a failed one still runs and settles, and the failure still escapes', async () => {
    const r = new PDFRenderer(canvas());
    const { doc, d } = pendingDoc();
    const next = goodDoc();
    const m = modelOf(doc);
    m.addPagesFrom(m.addSourcePdf(next, new Uint8Array(), 'b.pdf').id);
    r.setModel(m);
    const first = r.renderPageAtIndex(0);
    const queued = r.renderPageAtIndex(1);
    d.reject(cancelled());
    await expect(first).rejects.toThrow('Rendering cancelled');
    await expect(queued).resolves.toBeUndefined();
    expect(next.getPage).toHaveBeenCalledTimes(1);
  });

  // Panel round 2 (P1): the queue kept only a resolve callback, so a queued render's failure was thrown out of the
  // EARLIER caller's frame while the queued caller was told it succeeded — and the pipeline, seeing its own model
  // replaced, dropped it: a page painted over a canvas that never rendered, with no error anywhere.
  it("a queued render's own failure rejects its own caller, not the earlier one", async () => {
    const r = new PDFRenderer(canvas());
    const a = pendingDoc();
    const b = pendingDoc();
    const m = modelOf(a.doc);
    m.addPagesFrom(m.addSourcePdf(b.doc, new Uint8Array(), 'b.pdf').id);
    r.setModel(m);
    const first = r.renderPageAtIndex(0);
    const queued = r.renderPageAtIndex(1);
    a.d.resolve(fakePage);
    await vi.waitFor(() => expect(b.doc.getPage).toHaveBeenCalled());
    b.d.reject(new Error('page B corrupt'));
    await expect(first).resolves.toBeUndefined();
    await expect(queued).rejects.toThrow('page B corrupt');
  });

  it('when both fail, each caller gets its own failure', async () => {
    const r = new PDFRenderer(canvas());
    const a = pendingDoc();
    const b = pendingDoc();
    const m = modelOf(a.doc);
    m.addPagesFrom(m.addSourcePdf(b.doc, new Uint8Array(), 'b.pdf').id);
    r.setModel(m);
    const first = r.renderPageAtIndex(0);
    const queued = r.renderPageAtIndex(1);
    a.d.reject(new Error('page A corrupt'));
    await vi.waitFor(() => expect(b.doc.getPage).toHaveBeenCalled());
    b.d.reject(new Error('page B corrupt'));
    await expect(first).rejects.toThrow('page A corrupt');
    await expect(queued).rejects.toThrow('page B corrupt');
    expect((r as unknown as Renderable).isRendering).toBe(false);
  });

  it('a thumbnail in flight when the document is replaced and released returns no image', async () => {
    const r = new PDFRenderer(canvas());
    const { doc, d } = pendingDoc();
    r.setModel(modelOf(doc));
    const thumb = r.generateThumbnail(0);
    r.setModel(modelOf(goodDoc()));
    d.reject(cancelled());
    await expect(thumb).resolves.toBe('');
  });

  it('control: a thumbnail failure on a document the model still holds escapes', async () => {
    const r = new PDFRenderer(canvas());
    const { doc, d } = pendingDoc();
    r.setModel(modelOf(doc));
    const thumb = r.generateThumbnail(0);
    d.reject(cancelled());
    await expect(thumb).rejects.toThrow('Rendering cancelled');
  });

  it('control: with no model at all (the legacy path) a failure escapes', async () => {
    const r = new PDFRenderer(canvas());
    const { doc, d } = pendingDoc();
    const rendering = (r as unknown as Renderable)._renderPdfPage(doc, 1);
    d.reject(cancelled());
    await expect(rendering).rejects.toThrow('Rendering cancelled');
  });
});

function pipelineCtx(doc: PDFDocumentProxy) {
  let gen = 0;
  const ctx = {
    documentModel: {
      currentPageIndex: 0,
      currentPage: { sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 },
      sourcePdfs: new Map([['s1', { doc }]]),
      watermark: { enabled: false },
    },
    renderer: { renderPageAtIndex: vi.fn().mockResolvedValue(undefined) },
    ui: { canvas: document.createElement('canvas'), container: document.createElement('div') },
    drawWatermark: vi.fn(),
    exportPreviewOpen: false,
    zoomScale: 1,
    mode: 'select',
    formFieldOverlay: { render: vi.fn().mockResolvedValue({ unsupportedCount: 0 }), clear: vi.fn(), setPointerEvents: vi.fn() },
    textLayerManager: { render: vi.fn().mockResolvedValue(undefined), clear: vi.fn(), setPointerEvents: vi.fn() },
    reportError: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() },
    advanceFormFieldGen: () => ++gen,
    isCurrentFormFieldGen: (g: number) => g === gen,
    getFormValues: () => ({}),
    getWarnedUnsupportedFields: () => false,
    setWarnedUnsupportedFields: vi.fn(),
    renderInkLayer: vi.fn(),
  };
  return { ctx: ctx as unknown as IPageRenderContext, supersede: () => ++gen };
}

describe('the page pipeline drops a failure only when the model it read was replaced (QUAL-1)', () => {
  it('a page read in flight when the document is closed (the model replaced) settles quietly', async () => {
    const { doc, d } = pendingDoc();
    const { ctx, supersede } = pipelineCtx(doc);
    const run = new PageRenderPipeline(ctx).renderCurrentPage();
    await vi.waitFor(() => expect(doc.getPage).toHaveBeenCalled());
    supersede(); // resetDocumentModel advances the render epoch…
    (ctx as { documentModel: unknown }).documentModel = { currentPageIndex: 0, currentPage: undefined, sourcePdfs: new Map(), watermark: { enabled: false } }; // …and replaces the model
    d.reject(cancelled());
    await expect(run).resolves.toBeUndefined();
  });

  // Panel round 1 (P1): every page flip and zoom advances the same epoch, so "superseded" alone is not "gone".
  it('control: a failure in a run superseded by navigation, the document still open, escapes', async () => {
    const { doc, d } = pendingDoc();
    const { ctx, supersede } = pipelineCtx(doc);
    const run = new PageRenderPipeline(ctx).renderCurrentPage();
    await vi.waitFor(() => expect(doc.getPage).toHaveBeenCalled());
    supersede(); // a newer renderCurrentPage — page flip or zoom
    d.reject(cancelled());
    await expect(run).rejects.toThrow('Rendering cancelled');
  });

  it('control: the same failure in the current run escapes', async () => {
    const { doc, d } = pendingDoc();
    const { ctx } = pipelineCtx(doc);
    const run = new PageRenderPipeline(ctx).renderCurrentPage();
    await vi.waitFor(() => expect(doc.getPage).toHaveBeenCalled());
    d.reject(cancelled());
    await expect(run).rejects.toThrow('Rendering cancelled');
  });
});

describe('resetDocumentModel releases the documents it drops (QUAL-1)', () => {
  function fakeApp() {
    const log: string[] = [];
    const docs = ['a', 'b'].map(n => ({ numPages: 1, loadingTask: { destroy: vi.fn(() => { log.push(`destroy ${n}`); return Promise.resolve(); }) } }) as unknown as PDFDocumentProxy);
    const old = new DocumentModel();
    for (const doc of docs) old.addPagesFrom(old.addSourcePdf(doc, new Uint8Array(), 'x.pdf').id);
    // On the real prototype, so the real epoch methods run; only the collaborators are fakes.
    const app = Object.assign(Object.create(PDFTurboApp.prototype) as object, {
      documentModel: old,
      renderer: { setModel: vi.fn((m: DocumentModel) => { log.push(m === old ? 'setModel old' : 'setModel new'); }) },
      _formattingService: { cancelPainter: vi.fn() },
      uiController: { refs: { formatPainterBtn: document.createElement('button') } },
      _formFieldGen: 0,
    });
    return { app, docs, old, log };
  }
  const reset = (app: object) => (PDFTurboApp.prototype as unknown as { resetDocumentModel(): void }).resetDocumentModel.call(app);
  const destroyOf = (doc: PDFDocumentProxy) => (doc as unknown as { loadingTask: { destroy: ReturnType<typeof vi.fn> } }).loadingTask.destroy;

  it('every source of the dropped model is released, after the renderer has moved to the new one', () => {
    const { app, docs, old, log } = fakeApp();
    reset(app);
    expect(app.documentModel).not.toBe(old);
    for (const doc of docs) expect(destroyOf(doc)).toHaveBeenCalledTimes(1);
    expect(log).toEqual(['setModel new', 'destroy a', 'destroy b']);
  });

  // Panel round 1 (P2): deleting a source's last page garbage-collects it from `sourcePdfs`, so a reset that walked
  // only the live sources never released it — not even at close (DeletePageCmd holds it for undo and has no dispose).
  it('a source whose last page was deleted is released at the reset too', () => {
    const { app, old, log } = fakeApp();
    const gone = { numPages: 1, loadingTask: { destroy: vi.fn(() => { log.push('destroy gone'); return Promise.resolve(); }) } } as unknown as PDFDocumentProxy;
    const [page] = old.addPagesFrom(old.addSourcePdf(gone, new Uint8Array(), 'gone.pdf').id);
    old.deletePage(page.id);
    expect([...old.sourcePdfs.values()].some(s => s.doc === gone)).toBe(false); // garbage-collected
    reset(app);
    expect(destroyOf(gone)).toHaveBeenCalledTimes(1);
  });

  it('a source restored by undo after its garbage collection is released once, not twice', () => {
    const { app, old } = fakeApp();
    const back = { numPages: 1, loadingTask: { destroy: vi.fn(() => Promise.resolve()) } } as unknown as PDFDocumentProxy;
    const src = old.addSourcePdf(back, new Uint8Array(), 'back.pdf');
    const [page] = old.addPagesFrom(src.id);
    const removed = old.deletePage(page.id);
    old.sourcePdfs.set(src.id, src); // DeletePageCmd.undo puts the snapshot back…
    if (removed) old.restorePage(removed, 0); // …and the page
    reset(app);
    expect(destroyOf(back)).toHaveBeenCalledTimes(1);
  });

  it('fit-to-width after a close does not reach the released document (the legacy pdfDoc)', async () => {
    const { app, docs } = fakeApp();
    // Both open paths point the renderer's legacy `pdfDoc` at the live document, and the fit button stays enabled
    // after a close; with an empty model `computeFitScale` falls back to that `pdfDoc`.
    const released = Object.assign(docs[0], { getPage: () => { throw new TypeError("Cannot read properties of null (reading 'sendWithPromise')"); } });
    const real = new PDFRenderer(canvas());
    real.pdfDoc = released;
    real.setModel(app.documentModel);
    (app as { renderer: unknown }).renderer = real;
    reset(app);
    await expect(real.computeFitScale(840)).resolves.toBe(1);
  });

  it('the render epoch advances, so a pipeline run that started before the reset is superseded', () => {
    const { app } = fakeApp();
    const before = (PDFTurboApp.prototype as unknown as { advanceFormFieldGen(): number }).advanceFormFieldGen.call(app);
    reset(app);
    expect((PDFTurboApp.prototype as unknown as { isCurrentFormFieldGen(g: number): boolean }).isCurrentFormFieldGen.call(app, before)).toBe(false);
  });
});
