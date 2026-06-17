import { describe, it, expect, vi } from 'vitest';
import { SearchManager, type SearchContext } from '../../src/core/searchManager';
import type { MatchResult } from '../../src/handlers/textSearchHandler';
import type { TextElement } from '../../src/elements/textElement';
import type { PDFElement } from '../../src/elements/annotationElement';

// Minimal pdf.js page stub: getViewport returns an object with the transform/width/height
// fields searchManager threads into textSearchHandler.search (which is mocked here).
function makePage(rotate = 0) {
  return {
    rotate,
    getViewport: ({ scale, rotation }: { scale: number; rotation: number }) => ({
      scale, rotation, width: 600, height: 800, transform: [scale, 0, 0, -scale, 0, 800 * scale],
    }),
  };
}

// A documentModel test double with N source pages (+ optional blank pages).
function makeDocumentModel(opts: {
  pageIds: string[];
  blankIds?: string[];
} = { pageIds: ['p1', 'p2'] }) {
  const blank = new Set(opts.blankIds ?? []);
  const pages = opts.pageIds.map((id, i) => ({
    id,
    sourcePdfId: blank.has(id) ? 'blank' : 'src1',
    sourcePageNum: blank.has(id) ? 0 : i + 1,
    rotation: 0,
  }));
  const doc = { getPage: vi.fn().mockImplementation((n: number) => Promise.resolve(makePage()).then(p => ({ ...p, _n: n }))) };
  const sourcePdfs = new Map<string, { doc: typeof doc }>();
  sourcePdfs.set('src1', { doc });
  const model = {
    pages,
    currentPageIndex: 0,
    get currentPage(): unknown { return model.pages[model.currentPageIndex] ?? null; },
    sourcePdfs,
  };
  return model as unknown as SearchContext['documentModel'];
}

// textSearchHandler double: search() returns exactly one match per pageId it is called with.
function makeTextSearch() {
  const buildIndex = vi.fn().mockResolvedValue(undefined);
  const search = vi.fn().mockImplementation((_q: string, pageId: string): MatchResult[] => [
    { pageId, x: 10, y: 20, width: 30, height: 12 },
  ]);
  return { buildIndex, search } as unknown as SearchContext['textSearchHandler'];
}

function makeCtx(over: Partial<SearchContext> = {}): SearchContext {
  return {
    documentModel: makeDocumentModel(),
    elements: [],
    textSearchHandler: makeTextSearch(),
    zoomScale: 1.0,
    ...over,
  };
}

describe('SearchManager.run — whole-document search (G13)', () => {
  it('collects matches from EVERY source page, each tagged with its own pageId', async () => {
    const sm = new SearchManager();
    const ctx = makeCtx();
    const settled = await sm.run('hello', ctx);
    expect(settled).toBe(true);
    // One match per page → both pages represented.
    const ids = sm.matches.map(m => m.pageId);
    expect(ids).toContain('p1');
    expect(ids).toContain('p2');
    expect(sm.count).toBe(2);
  });

  it('searches pages in document order and buildIndex is called once per source page', async () => {
    const sm = new SearchManager();
    const ts = makeTextSearch();
    const ctx = makeCtx({ textSearchHandler: ts });
    await sm.run('hello', ctx);
    // page order preserved
    expect(sm.matches[0].pageId).toBe('p1');
    expect(sm.matches[1].pageId).toBe('p2');
    expect((ts.buildIndex as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it('next() cycles across pages (p1 → p2 → wrap to p1)', async () => {
    const sm = new SearchManager();
    await sm.run('hello', makeCtx());
    expect(sm.currentMatch?.pageId).toBe('p1');
    sm.next();
    expect(sm.currentMatch?.pageId).toBe('p2');
    sm.next();
    expect(sm.currentMatch?.pageId).toBe('p1'); // wrap
  });

  it('finds overlay TextElement matches on a NON-current page (incl. blank pages)', async () => {
    const sm = new SearchManager();
    // p1 = source, p2 = blank; the overlay text element lives on the blank, non-current page.
    const documentModel = makeDocumentModel({ pageIds: ['p1', 'p2'], blankIds: ['p2'] });
    const overlay = {
      type: 'text', pageId: 'p2', text: 'needle in a blank page',
      x: 5, y: 6, width: 100, height: 18,
    } as unknown as TextElement;
    // textSearchHandler returns NO pdf.js matches here, so the only hit must come from the overlay.
    const ts = makeTextSearch();
    (ts.search as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const ctx = makeCtx({ documentModel, elements: [overlay as unknown as PDFElement], textSearchHandler: ts });

    await sm.run('needle', ctx);
    const ids = sm.matches.map(m => m.pageId);
    expect(ids).toContain('p2');
    expect(sm.count).toBe(1);
  });

  it('preserves single-page behavior: one source page yields only that page\'s matches', async () => {
    const sm = new SearchManager();
    const documentModel = makeDocumentModel({ pageIds: ['only'] });
    await sm.run('hello', makeCtx({ documentModel }));
    expect(sm.matches.every(m => m.pageId === 'only')).toBe(true);
    expect(sm.count).toBe(1);
  });

  it('empty query clears matches and returns true', async () => {
    const sm = new SearchManager();
    const settled = await sm.run('   ', makeCtx());
    expect(settled).toBe(true);
    expect(sm.count).toBe(0);
  });
});
