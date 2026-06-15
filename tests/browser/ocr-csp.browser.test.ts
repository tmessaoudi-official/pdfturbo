/**
 * OCR end-to-end in a real browser (Chromium) — the CSP/asset-path regression
 * guard for the P1 found by /qa-sweep 2026-06-15.
 *
 * The bug: tesseract.js loaded its WASM core + traineddata from a CDN, which the
 * app's CSP (`connect-src 'self'`) blocks → OCR was non-functional in
 * production. The fix serves all assets from 'self' (vendored under
 * public/tesseract/ by scripts/prepare-ocr-assets.mjs) and passes
 * corePath/workerPath/langPath built by `ocrAssetPaths`.
 *
 * This test exercises the REAL engine (literal dynamic import of tesseract.js,
 * the actual WASM core, the real eng traineddata) against locally-served assets
 * — the same path the app uses — and asserts it recognizes clean text. jsdom
 * cannot do this (no canvas raster, no WASM worker). Requires the vendored
 * assets: run `npm run ocr:assets` first (CI does this before the suite).
 *
 * Vitest's browser server has base '/', and serves public/ at '/', so
 * ocrAssetPaths('/') resolves to the served /tesseract/* assets.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { recognizePage } from '../../src/ocr';
import { ocrAssetPaths } from '../../src/handlers/ocrHandler';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

// Fail fast with a clear message if the vendored assets are missing, rather
// than letting tesseract surface an opaque fetch error.
async function assertAssetsPresent(): Promise<void> {
  const paths = ocrAssetPaths('/');
  const checks = [
    `${paths.workerPath}`,
    `${paths.corePath}/tesseract-core-simd-lstm.wasm.js`,
    `${paths.langPath}/eng.traineddata.gz`,
  ];
  for (const url of checks) {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      throw new Error(
        `OCR asset missing: ${url} (HTTP ${res.status}). Run \`npm run ocr:assets\` first.`,
      );
    }
  }
}

function drawText(text: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 64px Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 30, canvas.height / 2);
  return canvas;
}

describe('OCR end-to-end from local (CSP-safe) assets', () => {
  beforeAll(async () => {
    await assertAssetsPresent();
  });

  it('loads the engine via local paths and recognizes clean text', async () => {
    const paths = ocrAssetPaths('/');
    // Guard the core fix: never a remote/CDN path.
    expect(`${paths.corePath} ${paths.workerPath} ${paths.langPath}`).not.toMatch(
      /https?:|cdn|jsdelivr|unpkg/i,
    );

    const canvas = drawText('HELLO WORLD');
    const result = await recognizePage(canvas, {
      language: 'eng',
      corePath: paths.corePath,
      workerPath: paths.workerPath,
      langPath: paths.langPath,
    });

    const text = result.text.toUpperCase();
    // Real recognition, not just "the engine loaded": the words must come back.
    expect(text).toContain('HELLO');
    expect(text).toContain('WORLD');
    expect(result.words.length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  // Mirror the REAL handler path: rasterize a pdf.js page (not a hand-drawn
  // canvas) and OCR it. This catches an off-screen-render integration gap that
  // a directly-drawn canvas would miss — the difference between "the engine
  // recognizes a canvas" and "OCR works on an actual PDF page in the app".
  it('recognizes text from a rasterized pdf.js page (handler render path)', async () => {
    const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 200]);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText('INVOICE TOTAL', { x: 40, y: 110, size: 48, font, color: rgb(0, 0, 0) });
    const bytes = await doc.save();

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pdfPage = await pdf.getPage(1);
    const viewport = pdfPage.getViewport({ scale: 2 }); // RENDER_SCALE in the handler
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

    const text = result.text.toUpperCase();
    expect(text).toContain('INVOICE');
    expect(text).toContain('TOTAL');
    expect(result.words.length).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
