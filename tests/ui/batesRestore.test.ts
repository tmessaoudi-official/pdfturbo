/**
 * Limits row 28 (D22) — the Bates settings survive a REAL save → reload: the real `saveState` writes an
 * IndexedDB record (fake-indexeddb), the real `loadState` reads it, and `DocumentLoader.restoreSession` puts it
 * back on the model. A malformed or legacy blob is normalised on the way in, never trusted.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveState, clearState, type SavedState } from '../../src/infra/storage';
import { DocumentLoader, type IDocumentLoaderContext } from '../../src/ui/documentLoader';
import { DocumentModel } from '../../src/core/documentModel';
import { BATES_MAX_START, type BatesSettings } from '../../src/export/batesStamp';

vi.mock('pdfjs-dist', () => ({
  default: { getDocument: vi.fn() },
  getDocument: vi.fn(),
}));

const PAGE = { id: 'p1', sourcePdfId: 'blank', sourcePageNum: 1, rotation: 0, width: 612, height: 792 };

function makeCtx(model: DocumentModel) {
  const restoreYesBtn = document.createElement('button');
  const restoreNoBtn = document.createElement('button');
  const restoreDialog = document.createElement('div');
  restoreDialog.append(restoreYesBtn, restoreNoBtn);
  document.body.append(restoreDialog);
  const emptyState = document.createElement('div');
  emptyState.id = 'emptyState';
  document.body.append(emptyState);
  const reportError = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() };
  const ctx = {
    isLoading: false,
    setIsLoading: vi.fn(),
    documentModel: model,
    resetDocumentModel: vi.fn(),
    elements: [],
    setFormValues: vi.fn(), setCurrentFilename: vi.fn(),
    isFitMode: false,
    renderer: { computeFitScale: vi.fn().mockResolvedValue(1), setScale: vi.fn(), pdfDoc: null },
    inkLayer: { fromJSON: vi.fn() },
    ui: { restoreDialog, restoreYesBtn, restoreNoBtn, container: document.createElement('div'), pageThumbnailContainer: document.createElement('div') },
    reportError,
    progress: { begin: vi.fn().mockReturnValue({ done: vi.fn(), failed: vi.fn() }) },
    clearThumbnailPanel: vi.fn(), renderThumbnails: vi.fn().mockResolvedValue(undefined),
    setZoom: vi.fn(), renderCurrentPage: vi.fn().mockResolvedValue(undefined),
    syncWatermarkBtn: vi.fn(), syncBatesBtn: vi.fn(),
    enableUI: vi.fn(), enableFileMenuDocItems: vi.fn(),
    updatePageInfo: vi.fn(), rebuildElementLayer: vi.fn(),
  } as unknown as IDocumentLoaderContext;
  return { ctx, restoreYesBtn, reportError };
}

async function reload(stored: Partial<SavedState>): Promise<{ model: DocumentModel; reportError: { error: ReturnType<typeof vi.fn> } }> {
  await saveState({ pages: [PAGE], sourcePdfs: [], elements: [], currentPageIndex: 0, ...stored } as unknown as SavedState);
  const model = new DocumentModel();
  const { ctx, restoreYesBtn, reportError } = makeCtx(model);
  const done = new DocumentLoader(ctx).restoreSession();
  await vi.waitFor(() => { if (document.activeElement !== restoreYesBtn) throw new Error('dialog not shown'); });
  restoreYesBtn.click();
  await done;
  return { model, reportError };
}

describe('Bates settings through a real save → reload (row 28)', () => {
  beforeEach(async () => { document.body.innerHTML = ''; await clearState(); });

  it('restores the saved settings exactly', async () => {
    const bates: BatesSettings = {
      enabled: true, mode: 'bates', prefix: 'ACME-', startNumber: 0, digits: 8, position: 'tc', fontSize: 14, color: '#123456',
    };
    const { model, reportError } = await reload({ bates });
    expect(reportError.error).not.toHaveBeenCalled();
    expect(model.bates).toEqual(bates);
  });

  it('keeps the defaults for a legacy blob with no Bates settings', async () => {
    const { model } = await reload({});
    expect(model.bates).toEqual(new DocumentModel().bates);
  });

  it('normalises a malformed blob instead of trusting it', async () => {
    const { model, reportError } = await reload({
      bates: { enabled: true, mode: 'bates', prefix: 7, startNumber: 1e20, digits: 'six', position: 'nowhere', fontSize: -3, color: 'javascript:' } as unknown as BatesSettings,
    });
    expect(reportError.error).not.toHaveBeenCalled();
    const def = new DocumentModel().bates;
    expect(model.bates).toEqual({ ...def, enabled: true, mode: 'bates', startNumber: BATES_MAX_START, fontSize: 6 });
  });
});
