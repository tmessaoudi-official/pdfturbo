import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PageThumbnailPanel } from '../../src/ui/pageThumbnailPanel';
import { DocumentModel } from '../../src/core/documentModel';
import type { PDFRenderer } from '../../src/infra/pdfRenderer';

vi.mock('../../src/utils/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) =>
    params?.page !== undefined ? `${key} ${params.page}` : key,
}));

function makeRenderer(): PDFRenderer {
  return {
    generateThumbnail: vi.fn().mockResolvedValue(null),
  } as unknown as PDFRenderer;
}

function makeModel(pageCount: number, currentIndex = 0): DocumentModel {
  const model = new DocumentModel();
  for (let i = 0; i < pageCount; i++) {
    model.pages.push({
      id: `page-${i}`,
      sourcePdfId: 'src',
      sourcePageNum: i + 1,
      rotation: 0,
      blankWidth: undefined,
      blankHeight: undefined,
    });
  }
  model.currentPageIndex = currentIndex;
  return model;
}

function makePanel(container: HTMLElement, model: DocumentModel): {
  panel: PageThumbnailPanel;
  onNavigate: ReturnType<typeof vi.fn>;
} {
  const onNavigate = vi.fn();
  const panel = new PageThumbnailPanel({
    container,
    renderer: makeRenderer(),
    model,
    onNavigate,
    onDelete: vi.fn(),
    onReorder: vi.fn(),
    onRotate: vi.fn(),
    onAddPdf: vi.fn(),
    onDownload: vi.fn(),
    onDownloadImage: vi.fn(),
  });
  return { panel, onNavigate };
}

describe('PageThumbnailPanel', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders N thumbnails for N pages', async () => {
    const model = makeModel(3);
    const { panel } = makePanel(container, model);
    await panel.render();
    expect(container.querySelectorAll('.thumb-item')).toHaveLength(3);
  });

  it('marks the active page with thumb-active class', async () => {
    const model = makeModel(3, 1);
    const { panel } = makePanel(container, model);
    await panel.render();
    const items = container.querySelectorAll('.thumb-item');
    expect(items[0].classList.contains('thumb-active')).toBe(false);
    expect(items[1].classList.contains('thumb-active')).toBe(true);
    expect(items[2].classList.contains('thumb-active')).toBe(false);
  });

  it('click on thumbnail triggers onNavigate with correct index', async () => {
    const model = makeModel(3);
    const { panel, onNavigate } = makePanel(container, model);
    await panel.render();
    const second = container.querySelectorAll('.thumb-item')[1] as HTMLElement;
    second.click();
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  // M0 #8 — keyboard accessibility of the navigation thumbnails.
  it('each thumbnail is keyboard-focusable with a button role and aria-label', async () => {
    const model = makeModel(2);
    const { panel } = makePanel(container, model);
    await panel.render();
    const items = container.querySelectorAll<HTMLElement>('.thumb-item');
    items.forEach((item, i) => {
      expect(item.getAttribute('role')).toBe('button');
      expect(item.getAttribute('tabindex')).toBe('0');
      const label = item.getAttribute('aria-label') ?? '';
      expect(label.length).toBeGreaterThan(0);
      // aria-label carries the 1-based page number.
      expect(label).toContain(String(i + 1));
    });
  });

  it('Enter and Space on a thumbnail trigger onNavigate', async () => {
    const model = makeModel(3);
    const { panel, onNavigate } = makePanel(container, model);
    await panel.render();
    const third = container.querySelectorAll<HTMLElement>('.thumb-item')[2];

    third.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onNavigate).toHaveBeenLastCalledWith(2);

    third.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(onNavigate).toHaveBeenLastCalledWith(2);
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it('Space keydown is prevented from scrolling the page', async () => {
    const model = makeModel(1);
    const { panel } = makePanel(container, model);
    await panel.render();
    const item = container.querySelectorAll<HTMLElement>('.thumb-item')[0];
    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    item.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

// #46 — lazy thumbnail rasterization via IntersectionObserver (jsdom has none,
// so we install a controllable fake). The expensive part is generateThumbnail.
describe('PageThumbnailPanel — lazy rasterization (#46)', () => {
  let container: HTMLElement;
  let ioInstances: FakeIO[];

  class FakeIO {
    cb: IntersectionObserverCallback;
    observed: Element[] = [];
    constructor(cb: IntersectionObserverCallback) { this.cb = cb; ioInstances.push(this); }
    observe(el: Element) { this.observed.push(el); }
    unobserve(el: Element) { this.observed = this.observed.filter(e => e !== el); }
    disconnect() { this.observed = []; }
    /** test helper: fire an intersection for one observed element */
    fire(el: Element) { this.cb([{ target: el, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
  }

  function panelWith(renderer: PDFRenderer, model: DocumentModel): PageThumbnailPanel {
    return new PageThumbnailPanel({
      container, renderer, model,
      onNavigate: vi.fn(), onDelete: vi.fn(), onReorder: vi.fn(), onRotate: vi.fn(),
      onAddPdf: vi.fn(), onDownload: vi.fn(), onDownloadImage: vi.fn(),
    });
  }

  beforeEach(() => {
    ioInstances = [];
    (globalThis as unknown as { IntersectionObserver: typeof FakeIO }).IntersectionObserver = FakeIO;
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  it('does not rasterize any thumbnail on render — only observes them', async () => {
    const renderer = { generateThumbnail: vi.fn().mockResolvedValue('data:image/png;base64,AAAA') } as unknown as PDFRenderer;
    const panel = panelWith(renderer, makeModel(50));
    await panel.render();
    expect(renderer.generateThumbnail).not.toHaveBeenCalled();
    expect(ioInstances).toHaveLength(1);
    expect(ioInstances[0].observed).toHaveLength(50);
  });

  it('rasterizes a thumbnail only when its item intersects, then unobserves it', async () => {
    const renderer = { generateThumbnail: vi.fn().mockResolvedValue('data:image/png;base64,AAAA') } as unknown as PDFRenderer;
    const panel = panelWith(renderer, makeModel(20));
    await panel.render();
    const item = container.querySelectorAll('.thumb-item')[7];
    ioInstances[0].fire(item);
    expect(renderer.generateThumbnail).toHaveBeenCalledTimes(1);
    expect(renderer.generateThumbnail).toHaveBeenCalledWith(7);
    expect(ioInstances[0].observed).not.toContain(item);
  });

  it('serves a cached thumbnail immediately and does not observe it', async () => {
    const renderer = { generateThumbnail: vi.fn().mockResolvedValue('data:image/png;base64,AAAA') } as unknown as PDFRenderer;
    const panel = panelWith(renderer, makeModel(10));
    await panel.render();
    ioInstances[0].fire(container.querySelectorAll('.thumb-item')[0]); // load page-0
    await new Promise(r => { setTimeout(r, 0); }); // let _loadThumb populate the cache
    await panel.render(); // re-render: page-0 is now cached
    // One observer is reused across renders (disconnect + re-observe); page-0 is
    // served from cache so only the other 9 are observed.
    expect(ioInstances).toHaveLength(1);
    expect(ioInstances[0].observed).toHaveLength(9);
    const img0 = container.querySelectorAll('.thumb-item')[0].querySelector('img');
    expect(img0?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });
});
