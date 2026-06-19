/**
 * OCR → editable Word (.docx) end-to-end in a real browser (2026-06-20).
 *
 * Proves the new "Export to Word" OCR output: a rasterized pdf.js page is OCR'd
 * by the REAL tesseract engine, the recognized text is turned into a FlowDoc by
 * `ocrTextToFlowDoc`, and `flowDocToDocxBlob` produces a real .docx whose
 * document.xml carries the recognized words. jsdom covers the pure transform +
 * the export wiring; only a real browser can produce the recognized text that
 * feeds it, so this closes the gap end-to-end.
 *
 * Requires the vendored OCR assets: `npm run ocr:assets` (CI runs it first).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { recognizePage } from '../../src/ocr';
import { ocrAssetPaths } from '../../src/handlers/ocrHandler';
import { ocrTextToFlowDoc } from '../../src/utils/flowDoc';
import { flowDocToDocxBlob } from '../../src/utils/flowDocWriters';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

async function assertAssetsPresent(): Promise<void> {
  const paths = ocrAssetPaths('/');
  const checks = [
    `${paths.workerPath}`,
    `${paths.corePath}/tesseract-core-simd-lstm.wasm.js`,
    `${paths.langPath}/eng.traineddata.gz`,
  ];
  for (const url of checks) {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`OCR asset missing: ${url} (HTTP ${res.status}). Run \`npm run ocr:assets\`.`);
  }
}

describe('OCR → DOCX end-to-end (real engine)', () => {
  beforeAll(async () => { await assertAssetsPresent(); });

  it('recognizes a rendered PDF page and bakes the text into a real .docx', async () => {
    const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 200]);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText('INVOICE TOTAL', { x: 40, y: 110, size: 48, font, color: rgb(0, 0, 0) });
    const bytes = await doc.save();

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pdfPage = await pdf.getPage(1);
    const viewport = pdfPage.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise;

    const paths = ocrAssetPaths('/');
    const result = await recognizePage(canvas, {
      language: 'eng',
      corePath: paths.corePath,
      workerPath: paths.workerPath,
      langPath: paths.langPath,
    });
    expect(result.text.trim().length).toBeGreaterThan(0);

    // The new OCR→Word chain: recognized text → FlowDoc → real .docx.
    const blob = await flowDocToDocxBlob(ocrTextToFlowDoc(result.text));
    const buf = new Uint8Array(await blob.arrayBuffer());
    const files = unzipSync(buf);
    const docXml = files['word/document.xml'];
    if (!docXml) throw new Error('document.xml missing from docx');
    const xml = strFromU8(docXml).toUpperCase();
    expect(xml).toContain('INVOICE');
    expect(xml).toContain('TOTAL');
  }, 120_000);
});
