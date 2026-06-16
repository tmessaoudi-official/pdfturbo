// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { OcrHandler } from '../../src/handlers/ocrHandler';
import type { PDFTurboApp } from '../../src/core/pdfTurboApp';

vi.mock('../../src/ocr', () => ({
  recognizePage: vi.fn().mockResolvedValue({ words: [] }),
  resolveLanguage: (l: string) => l,
}));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function makeApp(getPage: () => Promise<unknown>): PDFTurboApp {
  const src = { bytes: new Uint8Array([1]), doc: { getPage } };
  return {
    documentModel: {
      currentPage: { sourcePdfId: 's', sourcePageNum: 1, id: 'p1' },
      sourcePdfs: new Map([['s', src]]),
    },
    reportError: { silent: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    elements: [],
    historyManager: { execute: vi.fn() },
    rebuildElementLayer: vi.fn(),
    autosave: vi.fn(),
  } as unknown as PDFTurboApp;
}

// jsdom's canvas.getContext('2d') returns null, so run() bails right after getViewport
// (before recognition) — perfect for exercising the single-flight gate cheaply.
const resolvedPage = { getViewport: () => ({ width: 10, height: 10 }) };

describe('OcrHandler single-flight (M0 #6)', () => {
  it('ignores a concurrent run while one is already in flight', { timeout: 2000 }, async () => {
    const d = deferred<unknown>();
    const getPage = vi.fn().mockReturnValue(d.promise);
    const app = makeApp(getPage);
    const handler = new OcrHandler(app);

    const p1 = handler.run('eng');        // parks at the getPage await; marks running
    const r2 = await handler.run('eng');  // must short-circuit (busy), not start a 2nd recognition

    expect(r2).toBe(0);
    expect(getPage).toHaveBeenCalledTimes(1); // second call bailed before reaching getPage

    d.resolve(resolvedPage);
    await p1;

    // After completion the gate reopens.
    await handler.run('eng');
    expect(getPage).toHaveBeenCalledTimes(2);
  });
});
