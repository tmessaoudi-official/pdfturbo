import { describe, it, expect } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { DocumentModel, PAGE_SIZES } from '../../src/core/documentModel';

function makeDoc(numPages: number) {
  return { numPages, getPage: () => Promise.resolve({}) } as unknown as PDFDocumentProxy;
}

describe('DocumentModel', () => {
  it('addSourcePdf and addPagesFrom create correct page count', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(3), new Uint8Array(), 'test.pdf');
    const pages = model.addPagesFrom(src.id);
    expect(pages).toHaveLength(3);
    expect(model.pageCount).toBe(3);
  });

  it('deletePage clamps currentPageIndex', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(2), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    model.currentPageIndex = 1;
    model.deletePage(model.pages[1].id);
    expect(model.currentPageIndex).toBe(0);
  });

  it('reorderPages updates currentPageIndex to track the same page', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(3), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    model.currentPageIndex = 0;
    const [a, , c] = model.pages.map(p => p.id);
    model.reorderPages([c, model.pages[1].id, a]);
    expect(model.currentPageIndex).toBe(2);
  });

  it('reorderPages filters stale (deleted) IDs and still reorders remaining', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(3), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    const [a, b, c] = model.pages.map(p => p.id);

    // Delete page B
    model.deletePage(b);
    expect(model.pageCount).toBe(2); // [a, c]

    // Reorder with stale ID b — should filter b out and reorder [a,c] as [c,a]
    model.reorderPages([c, b, a]);
    // After filtering: [c, a] — both current pages present, applied
    expect(model.pages.map(p => p.id)).toEqual([c, a]);
  });

  it('reorderPages works normally without stale IDs', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(3), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    const [a, b, c] = model.pages.map(p => p.id);
    model.reorderPages([c, b, a]);
    expect(model.pages.map(p => p.id)).toEqual([c, b, a]);
  });

  describe('addBlankPage', () => {
    it('appends a blank page at end by default', () => {
      const model = new DocumentModel();
      const page = model.addBlankPage(595, 842);
      expect(model.pageCount).toBe(1);
      expect(page.sourcePdfId).toBe('blank');
      expect(page.sourcePageNum).toBe(0);
      expect(page.blankWidth).toBe(595);
      expect(page.blankHeight).toBe(842);
    });

    it('inserts a blank page at a specific index', () => {
      const model = new DocumentModel();
      const src = model.addSourcePdf(makeDoc(2), new Uint8Array(), 'test.pdf');
      model.addPagesFrom(src.id);
      const blank = model.addBlankPage(612, 792, 1);
      expect(model.pageCount).toBe(3);
      expect(model.pages[1]).toBe(blank);
      expect(model.pages[1].sourcePdfId).toBe('blank');
    });

    it('inserts at beginning when atIndex=0', () => {
      const model = new DocumentModel();
      const src = model.addSourcePdf(makeDoc(2), new Uint8Array(), 'test.pdf');
      model.addPagesFrom(src.id);
      const blank = model.addBlankPage(420, 595, 0);
      expect(model.pages[0]).toBe(blank);
    });

    it('appends at end when atIndex equals pageCount', () => {
      const model = new DocumentModel();
      const src = model.addSourcePdf(makeDoc(2), new Uint8Array(), 'test.pdf');
      model.addPagesFrom(src.id);
      const blank = model.addBlankPage(595, 842, 2);
      expect(model.pages[2]).toBe(blank);
    });

    it('generates unique IDs for consecutive blank pages', () => {
      const model = new DocumentModel();
      const p1 = model.addBlankPage(595, 842);
      const p2 = model.addBlankPage(595, 842);
      expect(p1.id).not.toBe(p2.id);
      expect(p1.id).toMatch(/^p_blank_/);
    });

    it('blank page does not count against GC for source PDFs', () => {
      const model = new DocumentModel();
      const src = model.addSourcePdf(makeDoc(1), new Uint8Array(), 'test.pdf');
      model.addPagesFrom(src.id);
      model.addBlankPage(595, 842);
      // Delete the PDF page — source should be GC'd, blank page remains
      model.deletePage(model.pages[0].id);
      expect(model.pageCount).toBe(1);
      expect(model.pages[0].sourcePdfId).toBe('blank');
      expect(model.sourcePdfs.size).toBe(0); // GC'd
    });
  });

  describe('PAGE_SIZES constants', () => {
    it('has correct dimensions for standard sizes', () => {
      expect(PAGE_SIZES.a4).toEqual({ width: 595, height: 842, label: 'A4' });
      expect(PAGE_SIZES.letter).toEqual({ width: 612, height: 792, label: 'Letter' });
      expect(PAGE_SIZES.a3).toEqual({ width: 842, height: 1191, label: 'A3' });
      expect(PAGE_SIZES.a5).toEqual({ width: 420, height: 595, label: 'A5' });
    });
  });
});
