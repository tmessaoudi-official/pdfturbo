/**
 * ISSUE-4 regression — DOCX export must not no-op on a text-less PDF that still
 * contains images. After ISSUE-3, an image-only PDF yields a flow with images
 * but zero paragraphs; the old guard (`paragraphs.length > 0` only) rejected it
 * as "no text" and produced no file. The fix emits a DOCX with the images, and
 * only shows the "no extractable text" toast for a genuinely empty document.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import imageOnlyPdfUrl from '../fixtures/qa-imageonly.pdf?url';
import { ExportService, type IExportContext } from '../../src/export/exportService';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

interface ExportProbe {
  svc: ExportService;
  warned: string[];
  downloaded: { blob: Blob; filename: string }[];
}

function buildProbe(doc: pdfjsLib.PDFDocumentProxy): ExportProbe {
  const warned: string[] = [];
  const downloaded: { blob: Blob; filename: string }[] = [];
  const handle = { done() {}, failed() {}, update() {} };
  const ctx = {
    documentModel: {
      pages: Array.from({ length: doc.numPages }, (_u, i) => ({ sourcePdfId: 's1', sourcePageNum: i + 1 })),
      sourcePdfs: new Map([['s1', { doc, bytes: new Uint8Array() }]]),
    },
    elements: [],
    currentFilename: 'scan.pdf',
    reportError: { info() {}, warn: (k: string) => warned.push(k), error() {} },
    progress: { begin: () => handle },
  } as unknown as IExportContext;
  const svc = new ExportService(ctx);
  // Intercept the actual download so the test can assert a file was produced.
  (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob = (blob, filename) =>
    downloaded.push({ blob, filename });
  return { svc, warned, downloaded };
}

async function loadFromUrl(url: string): Promise<pdfjsLib.PDFDocumentProxy> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  return pdfjsLib.getDocument({ data: bytes }).promise;
}

async function loadBlankPdf(): Promise<pdfjsLib.PDFDocumentProxy> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 300]); // no text, no images
  return pdfjsLib.getDocument({ data: await pdf.save() }).promise;
}

describe('ISSUE-4 — text-less PDF export is never a silent no-op', () => {
  it('exports a DOCX (with the image) for an image-only PDF', async () => {
    const probe = buildProbe(await loadFromUrl(imageOnlyPdfUrl));
    await probe.svc.exportAsDocx();
    expect(probe.downloaded.length).toBe(1);
    expect(probe.downloaded[0].filename).toMatch(/\.docx$/);
    expect(probe.warned).not.toContain('toast.exportNoText');
  });

  it('warns (no file) for a genuinely empty PDF', async () => {
    const probe = buildProbe(await loadBlankPdf());
    await probe.svc.exportAsDocx();
    expect(probe.downloaded.length).toBe(0);
    expect(probe.warned).toContain('toast.exportNoText');
  });
});
