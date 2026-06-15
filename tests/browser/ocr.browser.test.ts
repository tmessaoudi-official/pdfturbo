/**
 * OCR handler end-to-end (real Chrome): render a page to canvas, run the OCR
 * pipeline with a MOCKED tesseract loader (so no multi-MB CDN fetch), and assert
 * the recognized words become undoable text elements added as ONE history step.
 *
 * jsdom can't do this (no canvas raster); the pure mapping is covered by
 * tests/handlers/ocrHandler.test.ts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { OcrHandler } from '../../src/handlers/ocrHandler';
import { setTesseractLoader, type TesseractLike } from '../../src/ocr/ocrEngine';
import { HistoryManager } from '../../src/core/historyManager';
import type { PDFElement } from '../../src/elements/annotationElement';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

// Mock the createWorker API the engine now uses. Words live under the v6+
// nested `blocks` structure (the engine requests `blocks: true`); the logger
// fires from createWorker's worker options.
const mockTesseract: TesseractLike = {
  createWorker: (_langs, _oem, options) => {
    options?.logger?.({ status: 'recognizing text', progress: 0.5 });
    options?.logger?.({ status: 'recognizing text', progress: 1 });
    return Promise.resolve({
      recognize: () =>
        Promise.resolve({
          data: {
            text: 'Hello World',
            confidence: 92,
            blocks: [
              {
                paragraphs: [
                  {
                    lines: [
                      {
                        words: [
                          { text: 'Hello', bbox: { x0: 40, y0: 60, x1: 180, y1: 110 }, confidence: 95 },
                          { text: 'World', bbox: { x0: 200, y0: 60, x1: 360, y1: 110 }, confidence: 90 },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      terminate: () => Promise.resolve(undefined),
    });
  },
};

async function makeOnePagePdf(): Promise<pdfjsLib.PDFDocumentProxy> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 200]);
  return pdfjsLib.getDocument({ data: await pdf.save() }).promise;
}

function makeFakeApp(doc: pdfjsLib.PDFDocumentProxy, elements: PDFElement[], history: HistoryManager) {
  return {
    elements,
    historyManager: history,
    documentModel: {
      currentPage: { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1 },
      sourcePdfs: new Map([['s1', { doc, bytes: new Uint8Array() }]]),
    },
    rebuildElementLayer() { /* noop in test */ },
    autosave() { /* noop in test */ },
  };
}

describe('OcrHandler.run (real canvas, mocked tesseract)', () => {
  let restore: () => Promise<TesseractLike>;
  afterEach(() => { if (restore) setTesseractLoader(restore); });

  it('adds one text element per recognized word as a single undo step', async () => {
    restore = setTesseractLoader(() => Promise.resolve(mockTesseract));
    const doc = await makeOnePagePdf();
    const elements: PDFElement[] = [];
    const history = new HistoryManager(50, () => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = new OcrHandler(makeFakeApp(doc, elements, history) as any);

    const progresses: number[] = [];
    const count = await handler.run('eng', ({ progress }) => progresses.push(progress));

    expect(count).toBe(2);
    expect(elements.length).toBe(2);
    expect(elements.map((e) => (e as unknown as { text: string }).text)).toEqual(['Hello', 'World']);
    expect(progresses.length).toBeGreaterThan(0);

    // Whole OCR layer is ONE macro → a single undo clears it.
    history.undo();
    expect(elements.length).toBe(0);
    history.redo();
    expect(elements.length).toBe(2);
  });
});
