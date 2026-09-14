/**
 * The load guard in the SHIPPED module graph. `src/utils/pdfLoadGuard.ts` records pdf-lib's drops, its
 * assignment order and its cross-reference sections by wrapping parser and context methods, which only
 * works if the classes it patches are the classes `PDFDocument.load` uses. jsdom runs pdf-lib through vitest's `server.deps.inline`, a different graph from Vite's
 * pre-bundled one — so a split there (two copies of the parser) would leave the jsdom suite green while
 * every browser load accepted a dropped object. These cases go red on exactly that split.
 */
import { describe, it, expect } from 'vitest';
import { loadPdfDocument, PdfObjectDroppedError, PdfXrefMismatchError } from '../../src/utils/pdfLoadGuard';
import {
  appendRevision, buildContentStreamPdf, buildObjStmPdf, buildPageTreePdf, buildViewerNullPdf, buildXrefPointerPdf,
  buildXrefShapePdf, editPdfText,
} from '../utils/_invalidObjectFixture';

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

describe('loadPdfDocument in the browser bundle (WS7 round 13)', () => {
  it.each(['dupFirst', 'xrefStreamDupFirst'] as const)(
    'REFUSES %s — the cross-reference table names a copy pdf-lib did not keep', async shape => {
      const err = await loadPdfDocument(buildXrefShapePdf(shape)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PdfXrefMismatchError);
      expect((err as PdfXrefMismatchError).refs).toEqual(['5 0 R']);
    },
  );

  it('loads a drop superseded by the same interned value — assignment order is recorded in this bundle too', async () => {
    const withSix = editPdfText(
      editPdfText(buildContentStreamPdf(), '/Pages 2 0 R', '/Pages 2 0 R /Foo 6 0 R'),
      'xref\n0 ', '6 0 obj\nnull\nendobj\nxref\n0 ',
    );
    const doc = await loadPdfDocument(appendRevision(withSix, '6 0 obj\n<< /Type /Foo }\n6 0 obj\nnull\n'));
    expect(doc.getPageCount()).toBe(1);
  });
});

describe('loadPdfDocument in the browser bundle (WS7 round 14)', () => {
  it('REFUSES page content the cross-reference table marks free — pdf.js finds nothing, pdf-lib holds it', async () => {
    const err = await loadPdfDocument(buildViewerNullPdf('freeContents')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfXrefMismatchError);
    expect((err as PdfXrefMismatchError).refs).toEqual(['5 0 R']);
  });

  it('REFUSES a document root pdf-lib replaced — the root-recovery wrapper patches this bundle\'s parser', async () => {
    const err = await loadPdfDocument(buildViewerNullPdf('rootRecoveredNoXref')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfXrefMismatchError);
    expect((err as PdfXrefMismatchError).refs).toEqual(['11 0 R']);
  });

  it.each(['xrefStreamPngDupFirst', 'xrefStreamTiffDupFirst'] as const)(
    'REFUSES %s — the cross-reference stream is decoded with its predictor in this bundle too', async shape => {
      const err = await loadPdfDocument(buildXrefShapePdf(shape)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PdfXrefMismatchError);
      expect((err as PdfXrefMismatchError).refs).toEqual(['5 0 R']);
    },
  );

  it('loads a byte-identical duplicate content stream — copies are compared by value in this bundle too', async () => {
    const doc = await loadPdfDocument(buildXrefShapePdf('identicalStreamDupFirst'));
    expect(doc.getPageCount()).toBe(1);
  });
});

describe('loadPdfDocument in the browser bundle (WS7 round 16)', () => {
  it('REFUSES a table naming an earlier copy behind a /Prev pdf.js cannot read — the chain skips that section in this bundle too', async () => {
    const err = await loadPdfDocument(buildXrefPointerPdf('prevMid')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfXrefMismatchError);
    expect((err as PdfXrefMismatchError).refs).toEqual(['5 0 R']);
  });

  it('REFUSES page content whose entry lands on other bytes — pdf.js cannot read it and nothing rebuilds its table', async () => {
    const err = await loadPdfDocument(buildPageTreePdf('onlyPageContentMid')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfXrefMismatchError);
    expect((err as PdfXrefMismatchError).refs).toEqual(['10 0 R']);
  });

  it('loads a bad last-page entry pdf.js meets while opening and rebuilds — the opening walks are mirrored in this bundle too', async () => {
    const doc = await loadPdfDocument(buildPageTreePdf('lastPageDictMid'));
    expect(doc.getPageCount()).toBe(3);
  });
});
