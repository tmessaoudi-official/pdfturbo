/**
 * editText is edit-existing-text ONLY (Sprint 3 reverted the ISSUE-5 blank-drop).
 * In the text-edit tool, clicking on existing PDF text true-edits it (covered by
 * the ISSUE-2 / true-edit tests); clicking an EMPTY area must NOT drop a box —
 * that trapped the user in a non-interactive mode (elements are pointer-events:
 * none outside 'select') and spawned stray boxes. New text is created with the
 * dedicated draw-to-place "Add Text" tool. A blank click re-shows the hint.
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
  const calls = { addTextAt: 0, infoKeys: [] as string[] };
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
    reportError: { info: (k: string) => { calls.infoKeys.push(k); }, warn: () => {}, silent: () => {} },
  } as unknown as IAppContext;
  return { ctx, calls };
}

function clickAt(x: number, y: number): MouseEvent {
  // Detached canvas → getBoundingClientRect is all-zero, so clientX/Y map 1:1.
  return new MouseEvent('click', { clientX: x, clientY: y });
}

describe('editText — edit existing text only (blank click drops NO box)', () => {
  it('does NOT create a text box when the click misses existing text', async () => {
    const handler = new TextEditHandler();
    const { ctx, calls } = buildAppCtx(await makeTextPdfDoc());
    // (100,100): canvas centre → PDF (100,100), far below the "Hi" at y≈180. Blank.
    await handler.handleCanvasClick(clickAt(100, 100), ctx);
    // No blank-drop box; the editText hint is re-shown so the user knows to click a word.
    expect(calls.addTextAt).toBe(0);
    expect(calls.infoKeys).toContain('toast.modeHint.editText');
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
