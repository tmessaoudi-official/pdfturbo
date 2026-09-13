/**
 * The load guard in the SHIPPED module graph. `src/utils/pdfLoadGuard.ts` records pdf-lib's drops by
 * wrapping two parser methods, which only works if the class it patches is the class `PDFDocument.load`
 * uses. jsdom runs pdf-lib through vitest's `server.deps.inline`, a different graph from Vite's
 * pre-bundled one — so a split there (two copies of the parser) would leave the jsdom suite green while
 * every browser load accepted a dropped object. These cases go red on exactly that split.
 */
import { describe, it, expect } from 'vitest';
import { loadPdfDocument, PdfObjectDroppedError } from '../../src/utils/pdfLoadGuard';
import { buildContentStreamPdf, buildObjStmPdf } from '../utils/_invalidObjectFixture';

describe('loadPdfDocument in the browser bundle (WS7 round 12)', () => {
  it('REFUSES a classic object pdf-lib dropped', async () => {
    const err = await loadPdfDocument(buildContentStreamPdf({ brokenLast: true })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfObjectDroppedError);
    expect((err as PdfObjectDroppedError).refs).toEqual(['5 0 R']);
  });

  it('REFUSES an object-stream member pdf-lib dropped', async () => {
    const err = await loadPdfDocument(buildObjStmPdf([7, 9, 8])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfObjectDroppedError);
    expect((err as PdfObjectDroppedError).refs).toEqual(['8 0 R']);
  });

  it('loads the intact document (control)', async () => {
    const doc = await loadPdfDocument(buildContentStreamPdf());
    expect(doc.getPageCount()).toBe(1);
  });
});
