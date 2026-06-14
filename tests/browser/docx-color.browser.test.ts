/**
 * Batch-3 (a) — DOCX export color fidelity (real pdf.js getOperatorList).
 *
 * pdf.js v6 delivers `setFillRGBColor` with a single "#rrggbb" STRING arg (it
 * pre-resolves RGB/Gray/CMYK/Separation/spot via getRgbHex). The old op-walk
 * destructured `[fillR,fillG,fillB] = args`, so colored text collapsed to
 * garbage/black. jsdom can't run the worker, so this proves the fix end-to-end
 * in real Chrome: red-drawn text must reconstruct to a red-ish FlowRun.color.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import type { FlowDoc } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

type FlowDocExtractor = { _extractFlowDoc(): Promise<FlowDoc> };

function makeExtractor(doc: pdfjsLib.PDFDocumentProxy): FlowDocExtractor {
  const pages = Array.from({ length: doc.numPages }, (_u, i) => ({
    sourcePdfId: 's1',
    sourcePageNum: i + 1,
  }));
  const ctx = {
    documentModel: { pages, sourcePdfs: new Map([['s1', { doc, bytes: new Uint8Array() }]]) },
    elements: [],
  } as unknown as IExportContext;
  return new ExportService(ctx) as unknown as FlowDocExtractor;
}

async function loadColoredTextPdf(): Promise<pdfjsLib.PDFDocumentProxy> {
  const { PDFDocument, rgb, StandardFonts } = await import('@cantoo/pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([400, 200]);
  page.drawText('RED HEADING', { x: 40, y: 150, size: 28, font, color: rgb(0.85, 0.1, 0.12) });
  page.drawText('black body text', { x: 40, y: 100, size: 14, font, color: rgb(0, 0, 0) });
  return pdfjsLib.getDocument({ data: await pdf.save() }).promise;
}

function isReddish(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return r > 150 && g < 100 && b < 100;
}

describe('DOCX export — colored text survives (v6 hex-string color arg)', () => {
  it('reconstructs red text as a red-ish FlowRun.color (not black/garbage)', async () => {
    const svc = makeExtractor(await loadColoredTextPdf());
    const flow = await svc._extractFlowDoc();
    const colors = flow.pages
      .flatMap((p) => p.paragraphs)
      .flatMap((para) => para.runs)
      .map((r) => r.color)
      .filter((c): c is string => typeof c === 'string');
    // At least one run carries a valid 6-hex color and it is red-ish.
    expect(colors.every((c) => /^[0-9A-F]{6}$/.test(c))).toBe(true);
    expect(colors.some(isReddish)).toBe(true);
  });
});
