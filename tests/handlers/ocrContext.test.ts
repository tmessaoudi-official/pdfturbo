// @vitest-environment jsdom
/**
 * M2 #18 — OcrHandler must depend on a NARROW role-interface (IOcrContext), not
 * the concrete PDFTurboApp god-class. This test builds a fully-typed IOcrContext
 * mock (no `as unknown as PDFTurboApp` cast) and constructs the handler from it;
 * tsc fails until the ctor accepts the narrow interface, so this is the red test.
 */
import { describe, it, expect, vi } from 'vitest';
import { OcrHandler, type IOcrContext } from '../../src/handlers/ocrHandler';
import type { IErrorReporter } from '../../src/contracts/errorReporter';
import type { DocumentModel } from '../../src/core/documentModel';
import type { HistoryManager } from '../../src/core/historyManager';

vi.mock('../../src/ocr', () => ({
  recognizePage: vi.fn().mockResolvedValue({ words: [] }),
  resolveLanguage: (l: string) => l,
}));

const reporter: IErrorReporter = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() };

function makeCtx(currentPage: unknown, sourcePdfs = new Map<string, unknown>()): IOcrContext {
  return {
    reportError: reporter,
    documentModel: { currentPage, sourcePdfs } as unknown as DocumentModel,
    historyManager: { execute: vi.fn() } as unknown as HistoryManager,
    elements: [],
    rebuildElementLayer: vi.fn(),
    autosave: vi.fn(),
    _applySourcePdfEdit: vi.fn<IOcrContext['_applySourcePdfEdit']>().mockResolvedValue(true),
  };
}

describe('OcrHandler depends only on a narrow IOcrContext (M2 #18)', () => {
  it('constructs and runs from IOcrContext — no concrete PDFTurboApp', async () => {
    const ctx = makeCtx(null); // no current page → run() returns 0 early
    const h = new OcrHandler(ctx);
    expect(h).toBeInstanceOf(OcrHandler);
    expect(await h.run('eng')).toBe(0);
  });

  it('returns 0 for a blank page with no source doc', async () => {
    const ctx = makeCtx({ sourcePdfId: 'x', sourcePageNum: 0, id: 'p' });
    const h = new OcrHandler(ctx);
    expect(await h.run('eng')).toBe(0);
  });
});
