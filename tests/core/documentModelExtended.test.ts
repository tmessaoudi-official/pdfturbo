/**
 * DocumentModel extended coverage — currentPage, restorePage, GC, watermark,
 * addPagesFrom with specific pageNums, toJSON.
 */

import { describe, it, expect } from 'vitest';
import { DocumentModel, type DocumentPage } from '../../src/core/documentModel';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDoc(numPages: number): any {
  return { numPages, getPage: async () => ({}) };
}

// ── currentPage getter ─────────────────────────────────────────────────────────
describe('currentPage', () => {
  it('returns null when no pages', () => {
    const model = new DocumentModel();
    expect(model.currentPage).toBeNull();
  });

  it('returns page at currentPageIndex', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(3), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    model.currentPageIndex = 1;
    expect(model.currentPage).toBe(model.pages[1]);
  });

  it('returns first page by default', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(2), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    expect(model.currentPage).toBe(model.pages[0]);
  });
});

// ── pageCount ──────────────────────────────────────────────────────────────────
describe('pageCount', () => {
  it('is 0 initially', () => {
    expect(new DocumentModel().pageCount).toBe(0);
  });

  it('tracks added pages', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(5), new Uint8Array(), 'five.pdf');
    model.addPagesFrom(src.id);
    expect(model.pageCount).toBe(5);
  });
});

// ── addPagesFrom with pageNums subset ─────────────────────────────────────────
describe('addPagesFrom with specific pageNums', () => {
  it('adds only specified pages', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(5), new Uint8Array(), 'five.pdf');
    const pages = model.addPagesFrom(src.id, [1, 3, 5]);
    expect(pages).toHaveLength(3);
    expect(pages[0].sourcePageNum).toBe(1);
    expect(pages[1].sourcePageNum).toBe(3);
    expect(pages[2].sourcePageNum).toBe(5);
    expect(model.pageCount).toBe(3);
  });

  it('returns empty array for unknown sourcePdfId', () => {
    const model = new DocumentModel();
    const result = model.addPagesFrom('nonexistent-id');
    expect(result).toEqual([]);
  });

  it('each page gets a unique id', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(3), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    const ids = model.pages.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── restorePage ────────────────────────────────────────────────────────────────
describe('restorePage', () => {
  it('inserts page at specified index', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(2), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    const [p0, p1] = model.pages;
    model.deletePage(p0.id);
    // Restore p0 at index 0
    model.restorePage(p0, 0);
    expect(model.pages[0]).toBe(p0);
    expect(model.pages[1]).toBe(p1);
  });

  it('appends at end when atIndex > length', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(2), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    const removedPage = model.deletePage(model.pages[0].id);
    // restorePage at index 99 — should splice at end
    model.restorePage(removedPage as DocumentPage, 99);
    expect(model.pages[model.pages.length - 1]).toBe(removedPage);
  });
});

// ── Source PDF GC ──────────────────────────────────────────────────────────────
describe('source PDF garbage collection', () => {
  it('removes sourcePdf when all its pages are deleted', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(2), new Uint8Array(), 'gc.pdf');
    model.addPagesFrom(src.id);
    const srcId = src.id;
    model.deletePage(model.pages[0].id);
    expect(model.sourcePdfs.has(srcId)).toBe(true); // still 1 page
    model.deletePage(model.pages[0].id);
    expect(model.sourcePdfs.has(srcId)).toBe(false); // GC'd
  });

  it('keeps sourcePdf when pages from multiple sources exist', () => {
    const model = new DocumentModel();
    const src1 = model.addSourcePdf(makeDoc(1), new Uint8Array(), 'a.pdf');
    const src2 = model.addSourcePdf(makeDoc(2), new Uint8Array(), 'b.pdf');
    model.addPagesFrom(src1.id);
    model.addPagesFrom(src2.id);
    // Delete src1's only page → GC src1, keep src2
    model.deletePage(model.pages[0].id);
    expect(model.sourcePdfs.has(src1.id)).toBe(false);
    expect(model.sourcePdfs.has(src2.id)).toBe(true);
  });
});

// ── deletePage edge cases ──────────────────────────────────────────────────────
describe('deletePage', () => {
  it('returns null for nonexistent page', () => {
    const model = new DocumentModel();
    expect(model.deletePage('nonexistent')).toBeNull();
  });

  it('returns the deleted page', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(1), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    const pageId = model.pages[0].id;
    const removed = model.deletePage(pageId);
    expect((removed as DocumentPage).id).toBe(pageId);
  });

  it('clamps currentPageIndex when deleting last page', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(3), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    model.currentPageIndex = 2;
    model.deletePage(model.pages[2].id);
    expect(model.currentPageIndex).toBe(1);
  });

  it('currentPageIndex stays at 0 when there are no pages', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(1), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    model.deletePage(model.pages[0].id);
    expect(model.currentPageIndex).toBe(0);
  });
});

// ── watermark defaults ─────────────────────────────────────────────────────────
describe('watermark defaults', () => {
  it('is disabled by default', () => {
    const model = new DocumentModel();
    expect(model.watermark.enabled).toBe(false);
  });

  it('has a default text', () => {
    const model = new DocumentModel();
    expect(model.watermark.text).toBeTruthy();
  });

  it('has positive fontSize', () => {
    const model = new DocumentModel();
    expect(model.watermark.fontSize).toBeGreaterThan(0);
  });

  it('watermark can be mutated', () => {
    const model = new DocumentModel();
    model.watermark.enabled = true;
    model.watermark.text = 'CONFIDENTIAL';
    expect(model.watermark.enabled).toBe(true);
    expect(model.watermark.text).toBe('CONFIDENTIAL');
  });
});

// ── toJSON ─────────────────────────────────────────────────────────────────────
describe('toJSON', () => {
  it('serialises pages, watermark, and currentPageIndex', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(2), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    model.currentPageIndex = 1;
    model.watermark.enabled = true;
    model.watermark.text = 'DRAFT';

    const json = model.toJSON() as Record<string, unknown>;
    expect(json['currentPageIndex']).toBe(1);
    const wm = json['watermark'] as Record<string, unknown>;
    expect(wm['enabled']).toBe(true);
    expect(wm['text']).toBe('DRAFT');
    const pages = json['pages'] as unknown[];
    expect(pages).toHaveLength(2);
  });
});

// ── reorderPages with strict guard ────────────────────────────────────────────
describe('reorderPages strict guard', () => {
  it('does not reorder when new order length differs from pages length', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(3), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    const originalOrder = model.pages.map(p => p.id);
    // Pass only 2 of 3 IDs → missing one → guard triggers
    model.reorderPages([originalOrder[2], originalOrder[0]]);
    expect(model.pages.map(p => p.id)).toEqual(originalOrder);
  });

  it('does not reorder when a page id is absent from current pages', () => {
    const model = new DocumentModel();
    const src = model.addSourcePdf(makeDoc(2), new Uint8Array(), 'test.pdf');
    model.addPagesFrom(src.id);
    const [p0, p1] = model.pages.map(p => p.id);
    const originalOrder = [p0, p1];
    // Pass a nonexistent id
    model.reorderPages([p1, 'bogus-id']);
    expect(model.pages.map(p => p.id)).toEqual(originalOrder);
  });
});

// ── addSourcePdf stores bytes and name ────────────────────────────────────────
describe('addSourcePdf', () => {
  it('stores bytes and name on the SourcePdf object', () => {
    const model = new DocumentModel();
    const bytes = new Uint8Array([1, 2, 3]);
    const src = model.addSourcePdf(makeDoc(2), bytes, 'my-file.pdf');
    expect(src.name).toBe('my-file.pdf');
    expect(src.bytes).toBe(bytes);
    expect(src.pageCount).toBe(2);
  });

  it('assigns a unique id each time', () => {
    const model = new DocumentModel();
    const src1 = model.addSourcePdf(makeDoc(1), new Uint8Array(), 'a.pdf');
    const src2 = model.addSourcePdf(makeDoc(1), new Uint8Array(), 'b.pdf');
    expect(src1.id).not.toBe(src2.id);
  });
});
