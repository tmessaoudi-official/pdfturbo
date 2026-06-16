/**
 * M3 #34 — untrusted-PDF input caps. A malicious or pathological file (claimed
 * page count in the millions, half-gigabyte body) must be refused with a toast
 * before it can exhaust memory, rather than crashing the tab. Caps are generous
 * defence-in-depth bounds — only abusive input hits them.
 *
 * (The finding's `isEvalSupported:false` recommendation is obsolete on pdf.js
 * v6, which removed both the option and the eval-based font/function compiler
 * it gated — see the note in documentLoader.load. So this suite asserts the
 * caps, not an eval flag.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DocumentLoader,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  type IDocumentLoaderContext,
} from '../../src/ui/documentLoader';
import type { AppDOMRefs } from '../../src/ui/uiController';
import * as pdfjsLib from 'pdfjs-dist';

vi.mock('pdfjs-dist', () => {
  const getDocument = vi.fn().mockReturnValue({ promise: Promise.resolve({ numPages: 1 }) });
  return { default: { getDocument }, getDocument };
});

vi.mock('../../src/infra/storage', () => ({
  loadState: vi.fn().mockResolvedValue(null),
  clearState: vi.fn().mockResolvedValue(undefined),
}));

function makeDOM() {
  const emptyState = document.createElement('div');
  emptyState.id = 'emptyState';
  document.body.append(emptyState);
}

function makeUI() {
  const pageThumbnailContainer = Object.assign(document.createElement('div'), { style: { display: '' } });
  const container = document.createElement('div');
  document.body.append(pageThumbnailContainer, container);
  return { pageThumbnailContainer, container } as unknown as AppDOMRefs;
}

function makeCtx(): IDocumentLoaderContext {
  const ui = makeUI();
  const elements: never[] = [];
  const ctx = {
    isLoading: false,
    setIsLoading: vi.fn((v: boolean) => { (ctx as { isLoading: boolean }).isLoading = v; }),
    documentModel: {
      addSourcePdf: vi.fn().mockReturnValue({ id: 'src1', doc: {} }),
      addPagesFrom: vi.fn(),
    } as unknown as IDocumentLoaderContext['documentModel'],
    resetDocumentModel: vi.fn(),
    elements,
    setFormValues: vi.fn(), setWarnedUnsupportedFields: vi.fn(), setSelectedElement: vi.fn(),
    setCurrentFilename: vi.fn(), setClipboard: vi.fn(), isFitMode: false, setPendingPasswordResolve: vi.fn(),
    renderer: { computeFitScale: vi.fn().mockResolvedValue(1), pdfDoc: null } as unknown as IDocumentLoaderContext['renderer'],
    historyManager: { clear: vi.fn() } as unknown as IDocumentLoaderContext['historyManager'],
    formFieldOverlay: { clear: vi.fn() } as unknown as IDocumentLoaderContext['formFieldOverlay'],
    textLayerManager: { clear: vi.fn() } as unknown as IDocumentLoaderContext['textLayerManager'],
    textSearch: { clearCache: vi.fn() } as unknown as IDocumentLoaderContext['textSearch'],
    inkLayer: { clearAll: vi.fn() } as unknown as IDocumentLoaderContext['inkLayer'],
    ui,
    reportError: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() },
    progress: { begin: vi.fn().mockReturnValue({ done: vi.fn(), failed: vi.fn() }) } as unknown as IDocumentLoaderContext['progress'],
    reinitThumbnailPanel: vi.fn(), renderThumbnails: vi.fn().mockResolvedValue(undefined),
    applyZoom: vi.fn().mockResolvedValue(undefined), enableUI: vi.fn(), enableFileMenuDocItems: vi.fn(),
    autosave: vi.fn(), updatePageInfo: vi.fn(), rebuildElementLayer: vi.fn(),
  } as unknown as IDocumentLoaderContext;
  return ctx;
}

/** Build a fake file-input change Event carrying one PDF file. */
function pdfEvent(file: File): Event {
  return { target: { files: [file], value: '' } } as unknown as Event;
}

/** A small valid-typed PDF file with an overridable reported size. */
function pdfFile(name = 'doc.pdf', sizeOverride?: number): File {
  const f = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });
  if (sizeOverride !== undefined) Object.defineProperty(f, 'size', { value: sizeOverride });
  return f;
}

describe('M3 #34 — untrusted-PDF input caps', () => {
  beforeEach(() => { document.body.innerHTML = ''; makeDOM(); vi.clearAllMocks(); });

  it('exposes generous, sane caps', () => {
    expect(MAX_PDF_PAGES).toBeGreaterThanOrEqual(1000);
    expect(MAX_PDF_BYTES).toBeGreaterThanOrEqual(100 * 1024 * 1024);
  });

  it('rejects an over-size file with toast.fileTooLarge and never opens it', async () => {
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    await loader.load(pdfEvent(pdfFile('huge.pdf', MAX_PDF_BYTES + 1)));
    expect(ctx.reportError.error).toHaveBeenCalledWith('toast.fileTooLarge');
    expect(vi.mocked(pdfjsLib.getDocument)).not.toHaveBeenCalled();
    expect(ctx.documentModel.addSourcePdf).not.toHaveBeenCalled();
    expect(ctx.isLoading).toBe(false);
  });

  it('rejects a doc whose page count exceeds the cap with toast.tooManyPages', async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValueOnce(
      { promise: Promise.resolve({ numPages: MAX_PDF_PAGES + 1 }) } as unknown as ReturnType<typeof pdfjsLib.getDocument>,
    );
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    await loader.load(pdfEvent(pdfFile()));
    expect(ctx.reportError.error).toHaveBeenCalledWith('toast.tooManyPages');
    expect(ctx.documentModel.addSourcePdf).not.toHaveBeenCalled();
    expect(ctx.isLoading).toBe(false);
  });

  it('accepts a normal small single-page PDF (caps do not block legitimate input)', async () => {
    const ctx = makeCtx();
    const loader = new DocumentLoader(ctx);
    await loader.load(pdfEvent(pdfFile()));
    expect(ctx.reportError.error).not.toHaveBeenCalled();
    expect(ctx.documentModel.addSourcePdf).toHaveBeenCalled();
  });
});
