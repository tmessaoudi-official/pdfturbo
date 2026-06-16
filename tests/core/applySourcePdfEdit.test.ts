// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFTurboApp } from '../../src/core/pdfTurboApp';
import { HistoryManager } from '../../src/core/historyManager';
import type { SourcePdf } from '../../src/core/documentModel';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
}));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

type FakeApp = {
  documentModel: { sourcePdfs: Map<string, SourcePdf> };
  historyManager: HistoryManager;
  _thumbnailPanel: undefined;
  reportError: { info: Mock; warn: Mock; error: Mock; silent: Mock };
  autosave: Mock;
  _renderCurrentPage: Mock;
  rebuildElementLayer: Mock;
};

function makeApp(): { app: FakeApp; src: SourcePdf } {
  const beforeBytes = new Uint8Array([1, 2, 3]);
  const beforeDoc = { loadingTask: { destroy: vi.fn().mockResolvedValue(undefined) } };
  const src = { id: 's1', name: 'a.pdf', bytes: beforeBytes, doc: beforeDoc } as unknown as SourcePdf;
  const app: FakeApp = {
    documentModel: { sourcePdfs: new Map([['s1', src]]) },
    historyManager: new HistoryManager(50, () => {}),
    _thumbnailPanel: undefined,
    reportError: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() },
    autosave: vi.fn(),
    _renderCurrentPage: vi.fn().mockResolvedValue(undefined),
    rebuildElementLayer: vi.fn(),
  };
  return { app, src };
}

const run = (app: FakeApp, src: SourcePdf, bytes: Uint8Array) =>
  (PDFTurboApp.prototype as unknown as {
    _applySourcePdfEdit: (s: SourcePdf, b: Uint8Array, p: string) => Promise<void>;
  })._applySourcePdfEdit.call(app, src, bytes, 'p1');

describe('_applySourcePdfEdit — TOCTOU / identity guard (M0 #5)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('commits the edit on the happy path', async () => {
    const { app, src } = makeApp();
    const newDoc = { loadingTask: { destroy: vi.fn() } };
    (pdfjsLib.getDocument as unknown as Mock).mockReturnValue({ promise: Promise.resolve(newDoc) });
    const newBytes = new Uint8Array([9, 9]);

    await run(app, src, newBytes);

    expect(src.bytes).toBe(newBytes);
    expect((src as unknown as { doc: unknown }).doc).toBe(newDoc);
    expect(app.historyManager.canUndo()).toBe(true);
    expect(app._renderCurrentPage).toHaveBeenCalled();
  });

  it('discards the edit when the source is removed mid-parse', async () => {
    const { app, src } = makeApp();
    const beforeBytes = src.bytes;
    const newDoc = { loadingTask: { destroy: vi.fn().mockResolvedValue(undefined) } };
    const d = deferred<unknown>();
    (pdfjsLib.getDocument as unknown as Mock).mockReturnValue({ promise: d.promise });

    const p = run(app, src, new Uint8Array([9, 9]));
    app.documentModel.sourcePdfs.delete('s1'); // a newer flow removed the source
    d.resolve(newDoc);
    await p;

    expect(src.bytes).toBe(beforeBytes);              // never mutated
    expect(app.historyManager.canUndo()).toBe(false); // no command committed
    expect(newDoc.loadingTask.destroy).toHaveBeenCalled(); // parsed doc released
    expect(app.reportError.silent).toHaveBeenCalled();
  });

  it('discards the edit when the source bytes change mid-parse', async () => {
    const { app, src } = makeApp();
    const newDoc = { loadingTask: { destroy: vi.fn().mockResolvedValue(undefined) } };
    const d = deferred<unknown>();
    (pdfjsLib.getDocument as unknown as Mock).mockReturnValue({ promise: d.promise });

    const p = run(app, src, new Uint8Array([9, 9]));
    (src as unknown as { bytes: Uint8Array }).bytes = new Uint8Array([7, 7, 7]); // concurrent edit
    d.resolve(newDoc);
    await p;

    expect(app.historyManager.canUndo()).toBe(false);
    expect(newDoc.loadingTask.destroy).toHaveBeenCalled();
  });

  it('auto-undoes and toasts when the post-commit render throws', async () => {
    const { app, src } = makeApp();
    const beforeBytes = src.bytes;
    const newDoc = { loadingTask: { destroy: vi.fn() } };
    (pdfjsLib.getDocument as unknown as Mock).mockReturnValue({ promise: Promise.resolve(newDoc) });
    app._renderCurrentPage.mockRejectedValue(new Error('render boom'));

    await run(app, src, new Uint8Array([9, 9]));

    expect(src.bytes).toBe(beforeBytes);              // reverted by auto-undo
    expect(app.historyManager.canUndo()).toBe(false); // command undone off the stack
    expect(app.reportError.error).toHaveBeenCalled();
  });
});
