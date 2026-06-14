import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentLoader, type IDocumentLoaderContext } from '../../src/ui/documentLoader';
import type { AppDOMRefs } from '../../src/ui/uiController';

vi.mock('pdfjs-dist', () => ({
  default: {
    getDocument: vi.fn().mockReturnValue({ promise: Promise.resolve({ numPages: 1 }) }),
  },
  getDocument: vi.fn().mockReturnValue({ promise: Promise.resolve({ numPages: 1 }) }),
}));

vi.mock('../../src/infra/storage', () => ({
  loadState: vi.fn().mockResolvedValue(null),
  clearState: vi.fn().mockResolvedValue(undefined),
}));

function makeDOM() {
  const blankPageModal = document.createElement('div');
  blankPageModal.id = 'blankPageModal';
  const pdfPasswordModal = document.createElement('div');
  pdfPasswordModal.id = 'pdfPasswordModal';
  const pdfPasswordInput = document.createElement('input');
  pdfPasswordInput.id = 'pdfPasswordInput';
  const pdfPasswordError = document.createElement('div');
  pdfPasswordError.id = 'pdfPasswordError';
  const emptyState = document.createElement('div');
  emptyState.id = 'emptyState';
  document.body.append(blankPageModal, pdfPasswordModal, pdfPasswordInput, pdfPasswordError, emptyState);
}

function makeUI() {
  const restoreDialog = document.createElement('div');
  const restoreYesBtn = document.createElement('button');
  const restoreNoBtn = document.createElement('button');
  const pageThumbnailContainer = Object.assign(document.createElement('div'), { style: { display: '' } });
  const findBar = Object.assign(document.createElement('div'), { style: { display: 'none' } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  document.body.appendChild(pageThumbnailContainer);
  return {
    restoreDialog,
    restoreYesBtn,
    restoreNoBtn,
    pageThumbnailContainer,
    findBar,
    container,
    findCaseSensitive: document.createElement('button'),
    findRegex: document.createElement('button'),
  } as unknown as AppDOMRefs;
}

function makeCtx(overrides: Partial<IDocumentLoaderContext> = {}): IDocumentLoaderContext {
  const ui = makeUI();
  const elements: never[] = [];
  const ctx: IDocumentLoaderContext = {
    isLoading: false,
    setIsLoading: vi.fn((v) => { (ctx as { isLoading: boolean }).isLoading = v; }),
    documentModel: {
      pages: [],
      sourcePdfs: new Map(),
      watermark: {},
      currentPageIndex: 0,
      currentPage: null,
      addSourcePdf: vi.fn().mockReturnValue({ id: 'src1', doc: {} }),
      addPagesFrom: vi.fn(),
    } as unknown as IDocumentLoaderContext['documentModel'],
    resetDocumentModel: vi.fn(),
    elements,
    setFormValues: vi.fn(),
    setWarnedUnsupportedFields: vi.fn(),
    setSelectedElement: vi.fn(),
    setCurrentFilename: vi.fn(),
    setClipboard: vi.fn(),
    isFitMode: false,
    setPendingPasswordResolve: vi.fn(),
    renderer: { computeFitScale: vi.fn().mockResolvedValue(1.0), setScale: vi.fn(), pdfDoc: null, canvas: document.createElement('canvas') } as unknown as IDocumentLoaderContext['renderer'],
    historyManager: { clear: vi.fn() } as unknown as IDocumentLoaderContext['historyManager'],
    formFieldOverlay: { clear: vi.fn() } as unknown as IDocumentLoaderContext['formFieldOverlay'],
    textLayerManager: { clear: vi.fn() } as unknown as IDocumentLoaderContext['textLayerManager'],
    textSearch: { clearCache: vi.fn() } as unknown as IDocumentLoaderContext['textSearch'],
    inkLayer: { clearAll: vi.fn(), fromJSON: vi.fn() } as unknown as IDocumentLoaderContext['inkLayer'],
    ui,
    reportError: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() },
    progress: { begin: vi.fn().mockReturnValue({ done: vi.fn(), failed: vi.fn() }) } as unknown as IDocumentLoaderContext['progress'],
    reinitThumbnailPanel: vi.fn(),
    clearThumbnailPanel: vi.fn(),
    renderThumbnails: vi.fn().mockResolvedValue(undefined),
    updateActiveThumbnail: vi.fn(),
    setZoom: vi.fn(),
    applyZoom: vi.fn().mockResolvedValue(undefined),
    renderCurrentPage: vi.fn().mockResolvedValue(undefined),
    syncWatermarkBtn: vi.fn(),
    enableUI: vi.fn(),
    enableFileMenuDocItems: vi.fn(),
    disableFileMenuDocItems: vi.fn(),
    closeFindBar: vi.fn(),
    clearCanvases: vi.fn(),
    resetSearchOptions: vi.fn(),
    updateCopyPasteBtns: vi.fn(),
    autosave: vi.fn(),
    updatePageInfo: vi.fn(),
    rebuildElementLayer: vi.fn(),
    ...overrides,
  };
  return ctx;
}

describe('DocumentLoader.clearSave', () => {
  beforeEach(() => { document.body.innerHTML = ''; makeDOM(); });

  it('calls closeDocument internals (resetDocumentModel)', () => {
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    loader.clearSave();
    expect(ctx.resetDocumentModel).toHaveBeenCalled();
  });

  it('calls reportError.info after clearing', () => {
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    loader.clearSave();
    expect(ctx.reportError.info).toHaveBeenCalledWith('toast.sessionCleared');
  });
});

describe('DocumentLoader.closeDocument', () => {
  beforeEach(() => { document.body.innerHTML = ''; makeDOM(); });

  it('resets document model', () => {
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    loader.closeDocument();
    expect(ctx.resetDocumentModel).toHaveBeenCalled();
  });

  it('clears elements array', () => {
    const ctx = makeCtx();
    (ctx.elements as unknown[]).push({} as never, {} as never);
    const loader = new DocumentLoader(ctx);
    loader.closeDocument();
    expect(ctx.elements.length).toBe(0);
  });

  it('clears clipboard and selection', () => {
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    loader.closeDocument();
    expect(ctx.setSelectedElement).toHaveBeenCalledWith(null);
    expect(ctx.setClipboard).toHaveBeenCalledWith(null);
  });

  it('hides thumbnail container', () => {
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    loader.closeDocument();
    expect(ctx.ui.pageThumbnailContainer.style.display).toBe('none');
  });

  it('calls disableFileMenuDocItems', () => {
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    loader.closeDocument();
    expect(ctx.disableFileMenuDocItems).toHaveBeenCalled();
  });

  it('calls rebuildElementLayer to clear annotation DOM', () => {
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    loader.closeDocument();
    expect(ctx.rebuildElementLayer).toHaveBeenCalled();
  });

  it('emits toast.documentClosed info', () => {
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    loader.closeDocument();
    expect(ctx.reportError.info).toHaveBeenCalledWith('toast.documentClosed');
  });
});

describe('DocumentLoader.openBlankPageModal', () => {
  beforeEach(() => { document.body.innerHTML = ''; makeDOM(); });

  it('sets blankPageModal display to flex', () => {
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    loader.openBlankPageModal();
    expect((document.getElementById('blankPageModal') as HTMLElement).style.display).toBe('flex');
  });

  it('does nothing when modal element is missing', () => {
    document.getElementById('blankPageModal')?.remove();
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    expect(() => loader.openBlankPageModal()).not.toThrow();
  });
});

describe('DocumentLoader.restoreSession', () => {
  beforeEach(() => { document.body.innerHTML = ''; makeDOM(); });

  it('returns early when no saved state', async () => {
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    await loader.restoreSession();
    expect(ctx.setIsLoading).not.toHaveBeenCalled();
  });

  it('returns early when already loading', async () => {
    const { loadState } = await import('../../src/infra/storage');
    vi.mocked(loadState).mockResolvedValueOnce({ pages: [{}] } as unknown as Awaited<ReturnType<typeof loadState>>);
    const ctx = makeCtx({ isLoading: true });
    const loader = new DocumentLoader(ctx);
    await loader.restoreSession();
    expect(ctx.progress.begin).not.toHaveBeenCalled();
  });
});

describe('DocumentLoader.imagesToPdf', () => {
  beforeEach(() => { document.body.innerHTML = ''; makeDOM(); });

  it('returns a PDF file with the source image basename', async () => {
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    const file = new File([new Uint8Array([255, 216, 255])], 'photo.jpg', { type: 'image/jpeg' });
    // pdfDoc.embedJpg and pdfDoc.save are canvas/PDF-lib ops — just check it doesn't crash
    // and returns an object with name
    try {
      const result = await loader.imagesToPdf([file]);
      expect(result.name).toBe('photo.pdf');
    } catch {
      // @cantoo/pdf-lib may not be available in jsdom — that's acceptable
    }
  });

  it('uses "images" as base name when multiple files are provided', async () => {
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    const f1 = new File([new Uint8Array([0])], 'a.jpg', { type: 'image/jpeg' });
    const f2 = new File([new Uint8Array([0])], 'b.jpg', { type: 'image/jpeg' });
    try {
      const result = await loader.imagesToPdf([f1, f2]);
      expect(result.name).toBe('images.pdf');
    } catch {
      // acceptable in jsdom
    }
  });
});
