/**
 * Ruled-table → CSV end-to-end (real Chrome): a real pdf-lib page with drawn
 * grid lines + cell text → pdf.js getOperatorList/getTextContent → walkPageOps
 * (captures the VERTICAL rules added in #56) → buildTableGrid → CSV download.
 * tableExtract.test.ts unit-tests the clustering/CSV on synthetic input; this
 * proves the whole pipeline — including vertical-rule capture from a real op
 * list — produces the right CSV.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { ExportService, type IExportContext } from '../../src/export/exportService';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

/** A 2×2 lattice table: 3 horizontal + 3 vertical lines, one letter per cell. */
async function ruledTablePdf(): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const black = rgb(0, 0, 0);
  for (const y of [150, 200, 250]) page.drawLine({ start: { x: 50, y }, end: { x: 250, y }, thickness: 1, color: black });
  for (const x of [50, 150, 250]) page.drawLine({ start: { x, y: 150 }, end: { x, y: 250 }, thickness: 1, color: black });
  page.drawText('A', { x: 70, y: 215, size: 12 });
  page.drawText('B', { x: 170, y: 215, size: 12 });
  page.drawText('C', { x: 70, y: 165, size: 12 });
  page.drawText('D', { x: 170, y: 165, size: 12 });
  return doc.save({ useObjectStreams: false });
}

describe('exportTableCsv (real Chrome)', () => {
  it('extracts a ruled 2×2 table to CSV in reading order', async () => {
    const bytes = await ruledTablePdf();
    const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;

    const handle = { done() {}, failed() {}, update() {}, setFraction() {} };
    const downloads: { blob: Blob; filename: string }[] = [];
    const warns: string[] = [];
    const ctx = {
      documentModel: {
        currentPageIndex: 0,
        pageCount: 1,
        pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 }],
        sourcePdfs: new Map([['s1', { doc: pdfDoc, bytes }]]),
      },
      reportError: { info: () => {}, warn: (k: string) => warns.push(k), error: () => {} },
      progress: { begin: () => handle },
      currentFilename: 'doc.pdf',
    } as unknown as IExportContext;
    const svc = new ExportService(ctx);
    (svc as unknown as { _downloadBlob: (b: Blob, f: string) => void })._downloadBlob = (blob, filename) =>
      downloads.push({ blob, filename });

    await svc.exportTableCsv(0);

    expect(warns).toEqual([]);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].filename).toBe('doc-table.csv');
    const csv = await downloads[0].blob.text();
    expect(csv).toBe('A,B\nC,D');
  });
});
