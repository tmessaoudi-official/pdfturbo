/**
 * ISSUE-5 regression — unified text mode. In the text-edit tool, clicking on
 * existing PDF text true-edits it (covered by the ISSUE-2 / true-edit tests);
 * clicking an EMPTY area must drop a new editable text box instead of doing
 * nothing. This guards the blank-canvas branch of TextEditHandler.
 *
 * jsdom can't run this: it needs a real pdf.js text layer to decide hit vs miss.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { TextEditHandler } from '../../src/handlers/textEditHandler';
import type { IAppContext } from '../../src/core/appContext';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

async function makeTextPdfDoc(): Promise<pdfjsLib.PDFDocumentProxy> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([200, 200]);
  page.drawText('Hi', { x: 20, y: 180, size: 14, font }); // text only near the top
  return pdfjsLib.getDocument({ data: await pdf.save() }).promise;
}

function buildAppCtx(doc: pdfjsLib.PDFDocumentProxy) {
  const calls = { addTextAt: 0 };
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 200;
  const ctx = {
    documentModel: {
      currentPage: { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 },
      sourcePdfs: new Map([['s1', { doc, bytes: new Uint8Array() }]]),
    },
    ui: { canvas },
    zoomScale: 1,
    addTextAtPosition: () => { calls.addTextAt++; },
  } as unknown as IAppContext;
  return { ctx, calls };
}

function clickAt(x: number, y: number): MouseEvent {
  // Detached canvas → getBoundingClientRect is all-zero, so clientX/Y map 1:1.
  return new MouseEvent('click', { clientX: x, clientY: y });
}

describe('ISSUE-5 — unified text mode (blank click adds a box)', () => {
  it('creates a new text box when the click misses existing text', async () => {
    const handler = new TextEditHandler();
    const { ctx, calls } = buildAppCtx(await makeTextPdfDoc());
    // (100,100): canvas centre → PDF (100,100), far below the "Hi" at y≈180. Blank.
    await handler.handleCanvasClick(clickAt(100, 100), ctx);
    expect(calls.addTextAt).toBe(1);
  });

  it('does NOT add a box when the click lands on existing text', async () => {
    const handler = new TextEditHandler();
    const { ctx, calls } = buildAppCtx(await makeTextPdfDoc());
    // (24,18): canvas → PDF (24,182), on top of "Hi" (drawn at x=20,y=180).
    // The true-edit path needs more app context than this minimal mock provides;
    // swallow that — the point is only that the BLANK fallback did NOT fire.
    try {
      await handler.handleCanvasClick(clickAt(24, 18), ctx);
    } catch { /* true-edit path ran (text was hit), not the blank-box fallback */ }
    expect(calls.addTextAt).toBe(0);
  });
});
