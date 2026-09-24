/**
 * The load guard in the SHIPPED module graph. Two things only this environment can show:
 *  - The drop check records pdf-lib's drops by wrapping parser and context methods, which only works if the classes
 *    it patches are the classes `PDFDocument.load` uses. jsdom runs pdf-lib through vitest's `server.deps.inline`, a
 *    different graph from Vite's pre-bundled one — so a split there (two copies of the parser) would leave the jsdom
 *    suite green while every browser load accepted a dropped object.
 *  - The viewer check (WS8) runs the app's own `pdfjs-dist`, with its real worker, on the source and on the
 *    export-shaped copy. Under Node it runs pdf.js without a worker; here it is the path users take.
 */
import { describe, it, expect } from 'vitest';
import { loadPdfDocument, PdfObjectDroppedError, PdfPageMismatchError } from '../../src/utils/pdfLoadGuard';
import {
  appendRevision, buildContentStreamPdf, buildLinearizedPdf, buildObjStmPdf, buildPageOrderPdf, buildPageTreePdf,
  buildViewerNullPdf, buildXrefPointerPdf, buildXrefQueuePdf, buildXrefShapePdf, editPdfText,
} from '../utils/_invalidObjectFixture';
import { buildDupContentPdf } from '../utils/_viewerCheckFixture';

describe('loadPdfDocument in the browser bundle — the drop check', () => {
  it('REFUSES a classic object pdf-lib dropped', async () => {
    const err = await loadPdfDocument(buildContentStreamPdf({ brokenLast: true }), { viewerCheck: 'source' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfObjectDroppedError);
    expect((err as PdfObjectDroppedError).refs).toEqual(['5 0 R']);
  });

  it('REFUSES an object-stream member pdf-lib dropped', async () => {
    const err = await loadPdfDocument(buildObjStmPdf([7, 9, 8]), { viewerCheck: 'source' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfObjectDroppedError);
    expect((err as PdfObjectDroppedError).refs).toEqual(['8 0 R']);
  });

  it('loads the intact document (control)', async () => {
    const doc = await loadPdfDocument(buildContentStreamPdf(), { viewerCheck: 'source' });
    expect(doc.getPageCount()).toBe(1);
  });

  it('loads a drop superseded by the same interned value — assignment order is recorded in this bundle too', async () => {
    const withSix = editPdfText(
      editPdfText(buildContentStreamPdf(), '/Pages 2 0 R', '/Pages 2 0 R /Foo 6 0 R'),
      'xref\n0 ', '6 0 obj\nnull\nendobj\nxref\n0 ',
    );
    const doc = await loadPdfDocument(appendRevision(withSix, '6 0 obj\n<< /Type /Foo }\n6 0 obj\nnull\n'), { viewerCheck: 'source' });
    expect(doc.getPageCount()).toBe(1);
  });
});

describe('loadPdfDocument in the browser bundle — the viewer check (WS8)', () => {
  it.each([
    ['dupFirst', () => buildXrefShapePdf('dupFirst')],
    ['xrefStreamPngDupFirst', () => buildXrefShapePdf('xrefStreamPngDupFirst')],
    ['freeContents', () => buildViewerNullPdf('freeContents')],
    ['rootRecoveredNoXref', () => buildViewerNullPdf('rootRecoveredNoXref')],
    ['prevMid', () => buildXrefPointerPdf('prevMid')],
    ['onlyPageContentMid', () => buildPageTreePdf('onlyPageContentMid')],
    ['staleTableBeforePrev', () => buildXrefQueuePdf('staleTableBeforePrev')],
    ['countHidesFirst', () => buildPageOrderPdf('countHidesFirst')],
    ['linearizedEntryTable', () => buildLinearizedPdf('linearizedEntryTable')],
    ['graphicsOnly', () => buildDupContentPdf('graphicsOnly')],
  ] as const)('REFUSES %s — the page on screen is not the page the export holds', async (_shape, build) => {
    const err = await loadPdfDocument(build(), { viewerCheck: 'source' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfPageMismatchError);
    expect((err as PdfPageMismatchError).refs).toEqual(['page 1']);
  });

  it('loads a byte-identical duplicate content stream (control)', async () => {
    const doc = await loadPdfDocument(buildXrefShapePdf('identicalStreamDupFirst'), { viewerCheck: 'source' });
    expect(doc.getPageCount()).toBe(1);
  });

  it('loads a bad last-page entry pdf.js rebuilds past (control)', async () => {
    const doc = await loadPdfDocument(buildPageTreePdf('lastPageDictMid'), { viewerCheck: 'source' });
    expect(doc.getPageCount()).toBe(3);
  });

  it('does not run the viewer check for bytes the app wrote (viewerCheck: false)', async () => {
    const doc = await loadPdfDocument(buildXrefShapePdf('dupFirst'), { viewerCheck: false });
    expect(doc.getPageCount()).toBe(1);
  });
});
