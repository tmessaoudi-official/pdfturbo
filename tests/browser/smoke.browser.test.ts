import { describe, it, expect, beforeAll } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
// Mirror the app's worker wiring (src/infra/pdfRenderer.ts).
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
// Vite serves the fixture as a real URL we can fetch in the browser.
import imageTextPdfUrl from '../fixtures/qa-imagetext.pdf?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

async function loadPdf(url: string) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  return pdfjsLib.getDocument({ data: bytes }).promise;
}

describe('Stage 0 — browser harness smoke', () => {
  beforeAll(() => {
    // Proves we are in a real browser, not jsdom.
    const probeCtx = document.createElement('canvas').getContext('2d');
    expect(typeof probeCtx?.drawImage).toBe('function');
  });

  it('loads a real PDF and rasterizes a page to a non-blank canvas', async () => {
    const doc = await loadPdf(imageTextPdfUrl);
    expect(doc.numPages).toBeGreaterThan(0);

    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    // Assert the page actually painted something (not an all-white canvas).
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let nonWhite = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) nonWhite++;
    }
    expect(nonWhite).toBeGreaterThan(0);
  });
});
