import { describe, it, expect, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFRenderer } from '../../src/infra/pdfRenderer';
import { DocumentModel } from '../../src/core/documentModel';

type RendererTestable = {
  _renderPdfPage(doc: PDFDocumentProxy, pageNum: number): Promise<void>;
  _renderBlankPage(widthPt: number, heightPt: number): void;
  isRendering: boolean;
};

function makeCanvas() {
  const canvas = document.createElement('canvas');
  // jsdom returns null for getContext('2d'); stub it so the null guard doesn't throw
  canvas.getContext = vi.fn().mockReturnValue({}) as typeof canvas.getContext;
  return canvas;
}

function makeDoc(failOnPage?: number) {
  return {
    // oxlint-disable-next-line eslint/require-await -- async keeps reject semantics: a thrown error becomes a rejected Promise the renderer awaits
    getPage: vi.fn(async (n: number) => {
      if (failOnPage !== undefined && n === failOnPage) throw new Error(`page ${n} corrupt`);
      return {
        rotate: 0,
        getViewport: () => ({ width: 100, height: 100 }),
        render: () => ({ promise: Promise.resolve() }),
      };
    }),
  } as unknown as PDFDocumentProxy;
}

describe('PDFRenderer deadlock fix (BUG-05)', () => {
  it('isRendering resets to false after a getPage() exception', async () => {
    const renderer = new PDFRenderer(makeCanvas());
    const doc = makeDoc(1); // page 1 throws

    await expect((renderer as unknown as RendererTestable)._renderPdfPage(doc, 1)).rejects.toThrow('page 1 corrupt');

    expect((renderer as unknown as RendererTestable).isRendering).toBe(false);
  });

  it('can render again after an error (no deadlock)', async () => {
    const renderer = new PDFRenderer(makeCanvas());
    const doc = makeDoc(1);

    await expect((renderer as unknown as RendererTestable)._renderPdfPage(doc, 1)).rejects.toThrow();
    // Second render should succeed (not deadlocked)
    const goodDoc = makeDoc();
    await expect((renderer as unknown as RendererTestable)._renderPdfPage(goodDoc, 1)).resolves.toBeUndefined();
  });
});

describe('PDFRenderer pending queue fix (BUG-08)', () => {
  it('resolves previously queued Promise when a new render overwrites it', async () => {
    const renderer = new PDFRenderer(makeCanvas());
    const doc = makeDoc();

    const resolved: number[] = [];

    // Start first render (sets isRendering=true)
    const first = (renderer as unknown as RendererTestable)._renderPdfPage(doc, 1).then(() => resolved.push(1));

    // Queue second render while first is in progress
    const second = (renderer as unknown as RendererTestable)._renderPdfPage(doc, 2).then(() => resolved.push(2));

    // Queue third render — should resolve the second (overwrite with resolution)
    const third = (renderer as unknown as RendererTestable)._renderPdfPage(doc, 3).then(() => resolved.push(3));

    await Promise.all([first, second, third]);

    // All three must resolve (no orphaned Promises)
    expect(resolved).toContain(1);
    expect(resolved).toContain(2);
    expect(resolved).toContain(3);
  });

  it('resolves queued Promise even when queued page throws', async () => {
    const renderer = new PDFRenderer(makeCanvas());
    const goodDoc = makeDoc();         // first render succeeds
    const badDoc = makeDoc(1);         // queued page 1 throws

    // Start first render
    const first = (renderer as unknown as RendererTestable)._renderPdfPage(goodDoc, 1);

    // Queue a bad page while first is in progress
    let queuedResolved = false;
    const queued = (renderer as unknown as RendererTestable)._renderPdfPage(badDoc, 1).then(
      () => { queuedResolved = true; },
      () => { queuedResolved = true; } // also resolved on rejection — we just want it to settle
    );

    // first may throw because the queued page error propagates through the recursive call
    await first.catch(() => {});
    await queued;
    expect(queuedResolved).toBe(true);
  });
});

describe('PDFRenderer setScale and getPageInfo', () => {
  it('setScale clamps to minimum 0.25', () => {
    const renderer = new PDFRenderer(makeCanvas());
    renderer.setScale(0.1);
    expect(renderer.scale).toBe(0.25);
  });

  it('setScale clamps to maximum 3.0', () => {
    const renderer = new PDFRenderer(makeCanvas());
    renderer.setScale(10);
    expect(renderer.scale).toBe(3.0);
  });

  it('setScale accepts a value in the valid range', () => {
    const renderer = new PDFRenderer(makeCanvas());
    renderer.setScale(1.5);
    expect(renderer.scale).toBe(1.5);
  });

  it('getPageInfo returns current=1 and total=0 when no model or doc set', () => {
    const renderer = new PDFRenderer(makeCanvas());
    const info = renderer.getPageInfo();
    expect(info.current).toBe(1);  // (0+1)
    expect(info.total).toBe(0);
  });

  it('getPageInfo reflects model page count', () => {
    const canvas = makeCanvas();
    const renderer = new PDFRenderer(canvas);
    const model = new DocumentModel();
    model.addBlankPage(595, 842);
    model.addBlankPage(595, 842);
    renderer.setModel(model);
    const info = renderer.getPageInfo();
    expect(info.total).toBe(2);
    expect(info.current).toBe(1);
  });
});

describe('PDFRenderer computeFitScale — legacy fallback (no model, no pdfDoc)', () => {
  it('returns 1.0 when no pdfDoc and no model are set', async () => {
    const renderer = new PDFRenderer(makeCanvas());
    const scale = await renderer.computeFitScale(800);
    expect(scale).toBe(1.0);
  });
});

describe('PDFRenderer renderPageAtIndex', () => {
  it('dispatches to _renderBlankPage for a blank page at given index', async () => {
    const canvas = makeCanvas();
    const { ctx } = (() => {
      const fills: unknown[] = [];
      return { ctx: { fillStyle: '' as string, fillRect: vi.fn(() => fills.push(1)) } };
    })();
    canvas.getContext = vi.fn().mockReturnValue(ctx) as typeof canvas.getContext;
    const renderer = new PDFRenderer(canvas);
    const model = new DocumentModel();
    model.addBlankPage(595, 842);
    model.addBlankPage(612, 792);
    renderer.setModel(model);

    const blankSpy = vi.spyOn(renderer as unknown as RendererTestable, '_renderBlankPage');
    await renderer.renderPageAtIndex(1); // index 1 = Letter
    expect(blankSpy).toHaveBeenCalledWith(612, 792);
  });

  it('is a no-op (no throw) when no model is set and no pdfDoc', async () => {
    const renderer = new PDFRenderer(makeCanvas());
    await expect(renderer.renderPageAtIndex(0)).resolves.toBeUndefined();
  });
});

describe('PDFRenderer blank page support', () => {
  function makeCtx() {
    const fills: { x: number; y: number; w: number; h: number; style: string }[] = [];
    return {
      ctx: {
        fillStyle: '' as string,
        fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
          fills.push({ x, y, w, h, style: '' });
        }),
      },
      fills,
    };
  }

  it('_renderBlankPage sets canvas dimensions scaled by renderer scale', () => {
    const canvas = makeCanvas();
    const { ctx } = makeCtx();
    canvas.getContext = vi.fn().mockReturnValue(ctx) as typeof canvas.getContext;
    const renderer = new PDFRenderer(canvas);
    renderer.setScale(1.5);

    (renderer as unknown as RendererTestable)._renderBlankPage(400, 600);

    expect(canvas.width).toBe(600);  // 400 * 1.5
    expect(canvas.height).toBe(900); // 600 * 1.5
  });

  it('_renderBlankPage fills with white', () => {
    const canvas = makeCanvas();
    const { ctx } = makeCtx();
    canvas.getContext = vi.fn().mockReturnValue(ctx) as typeof canvas.getContext;
    const renderer = new PDFRenderer(canvas);

    (renderer as unknown as RendererTestable)._renderBlankPage(100, 200);

    expect(ctx.fillStyle).toBe('#ffffff');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 200);
  });

  it('renderCurrentPage dispatches to blank path for blank pages', async () => {
    const canvas = makeCanvas();
    const { ctx } = makeCtx();
    canvas.getContext = vi.fn().mockReturnValue(ctx) as typeof canvas.getContext;
    const renderer = new PDFRenderer(canvas);

    const model = new DocumentModel();
    model.addBlankPage(595, 842);
    renderer.setModel(model);

    const blankSpy = vi.spyOn(renderer as unknown as RendererTestable, '_renderBlankPage');
    await renderer.renderCurrentPage();

    expect(blankSpy).toHaveBeenCalledWith(595, 842);
  });

  it('computeFitScale uses blankWidth for blank pages', async () => {
    const canvas = makeCanvas();
    const renderer = new PDFRenderer(canvas);
    const model = new DocumentModel();
    model.addBlankPage(500, 700); // 500pt wide
    renderer.setModel(model);

    const scale = await renderer.computeFitScale(540); // container 540px → (540-40)/500 = 1.0
    expect(scale).toBeCloseTo(1.0, 5);
  });

  it('generateThumbnail returns a data URL for blank pages', async () => {
    const canvas = makeCanvas();
    const { ctx } = makeCtx();
    canvas.getContext = vi.fn().mockReturnValue(ctx) as typeof canvas.getContext;
    // createElement('canvas') inside generateThumbnail also needs stubbing
    const thumbCtx = {
      fillStyle: '' as string,
      strokeStyle: '' as string,
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
    };
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        const c = origCreate('canvas') as HTMLCanvasElement;
        c.getContext = vi.fn().mockReturnValue(thumbCtx) as typeof c.getContext;
        c.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,abc') as typeof c.toDataURL;
        return c;
      }
      return origCreate(tag);
    });

    const renderer = new PDFRenderer(canvas);
    const model = new DocumentModel();
    model.addBlankPage(595, 842);
    renderer.setModel(model);

    const result = await renderer.generateThumbnail(0, 0.15);
    expect(result).toBe('data:image/jpeg;base64,abc');

    vi.restoreAllMocks();
  });
});
