/**
 * QUAL-1 in real pdf.js. `resetDocumentModel` now releases a closed document's pdf.js documents
 * (`loadingTask.destroy()`), and a release cancels what is in flight on them: a page render
 * rejects with `RenderingCancelledException`, a `getPage` with a worker error (both measured
 * with a probe first). The jsdom suite (`tests/core/releasedDocument.test.ts`) pins the rule on
 * fakes; this pins it on the real library — the renderer settles quietly for a document its model
 * no longer holds, and the control shows the same release on a held document still rejects.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { PDFRenderer } from '../../src/infra/pdfRenderer';
import { DocumentModel } from '../../src/core/documentModel';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl;

/**
 * A page heavy enough that its render is still running when the release lands: 12000 text ops render in ~1 s at
 * load 30 on the dev box (4000 took ~300 ms, too little margin for a fast CI runner — measured 2026-10-08).
 */
async function heavyPdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  for (let i = 0; i < 12000; i++) page.drawText('release ' + i, { x: (i * 37) % 560, y: (i * 13) % 780, size: 6, font });
  return doc.save();
}

async function open(bytes: Uint8Array): Promise<{ doc: PDFDocumentProxy; model: DocumentModel }> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const model = new DocumentModel();
  model.addPagesFrom(model.addSourcePdf(doc, bytes, 'a.pdf').id);
  return { doc, model };
}

function renderer(): { r: PDFRenderer; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  return { r: new PDFRenderer(canvas), canvas };
}

/** The renderer sizes the canvas on the line before `page.render` — so the render has started. */
async function renderStarted(canvas: HTMLCanvasElement): Promise<void> {
  const t0 = performance.now();
  while (canvas.width !== 600) {
    if (performance.now() - t0 > 20_000) throw new Error('render never started');
    await new Promise(res => { setTimeout(res, 1); });
  }
}

const outcome = (p: Promise<unknown>) => p.then(v => ({ ok: true, v }), (e: unknown) => ({ ok: false, name: (e as Error)?.name }));

describe('a released document settles quietly in the renderer (QUAL-1, real pdf.js)', () => {
  it('a page render in flight when the document is replaced and released resolves', async () => {
    const bytes = await heavyPdf();
    const a = await open(bytes);
    const b = await open(bytes);
    const { r, canvas } = renderer();
    r.setModel(a.model);
    const rendering = outcome(r.renderPageAtIndex(0));
    await renderStarted(canvas);
    r.setModel(b.model);
    await a.doc.loadingTask.destroy();
    expect(await rendering).toEqual({ ok: true, v: undefined });
    await b.doc.loadingTask.destroy();
  }, 60_000);

  it('control: the same release on the document the model still holds rejects', async () => {
    const a = await open(await heavyPdf());
    const { r, canvas } = renderer();
    r.setModel(a.model);
    const rendering = outcome(r.renderPageAtIndex(0));
    await renderStarted(canvas);
    await a.doc.loadingTask.destroy();
    expect(await rendering).toEqual({ ok: false, name: 'RenderingCancelledException' });
  }, 60_000);

  it('a thumbnail in flight when the document is replaced and released returns no image', async () => {
    const bytes = await heavyPdf();
    const a = await open(bytes);
    const b = await open(bytes);
    const { r } = renderer();
    r.setModel(a.model);
    const thumb = outcome(r.generateThumbnail(0));
    r.setModel(b.model);
    await a.doc.loadingTask.destroy();
    expect(await thumb).toEqual({ ok: true, v: '' });
    await b.doc.loadingTask.destroy();
  }, 60_000);

  it('control: a thumbnail on a released document the model still holds rejects', async () => {
    const a = await open(await heavyPdf());
    const { r } = renderer();
    r.setModel(a.model);
    const thumb = outcome(r.generateThumbnail(0));
    await a.doc.loadingTask.destroy();
    expect((await thumb).ok).toBe(false);
  }, 60_000);
});
