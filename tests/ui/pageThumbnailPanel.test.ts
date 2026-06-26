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

  // #QA-2026-06-23 P3 (#1): activating delete (e.g. via keyboard on the × button) re-renders
  // the strip (innerHTML=''), which would drop focus to <body>. After the re-render, focus must
  // land on the thumbnail now occupying the deleted slot (clamped to the last when deleting the end).
  it('moves focus to the adjacent thumbnail after a delete-triggered re-render', async () => {
    const model = makeModel(3, 1);
    const { panel } = makePanel(container, model);
    await panel.render();
    // Simulate the real delete flow: the × button click records the slot + calls onDelete...
    const del = container.querySelectorAll<HTMLElement>('.thumb-item')[1].querySelector('.thumb-delete') as HTMLElement;
    del.click();
    // ...the app removes the page and re-renders the (now 2-page) strip.
    model.pages.splice(1, 1);
    await panel.render();
    const items = container.querySelectorAll<HTMLElement>('.thumb-item');
    expect(items).toHaveLength(2);
    expect(document.activeElement).toBe(items[1]); // slot 1 still exists → focus it
  });

  it('clamps post-delete focus to the last thumbnail when the end page was removed', async () => {
    const model = makeModel(3);
    const { panel } = makePanel(container, model);
    await panel.render();
    const del = container.querySelectorAll<HTMLElement>('.thumb-item')[2].querySelector('.thumb-delete') as HTMLElement;
    del.click();
    model.pages.splice(2, 1);
    await panel.render();
    const items = container.querySelectorAll<HTMLElement>('.thumb-item');
    expect(items).toHaveLength(2);
    expect(document.activeElement).toBe(items[1]); // clamped from 2 → 1
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

// G17 — when an overlay compositor is set, the thumbnail prefers it (so the thumb
// shows the user's annotations/ink); when the compositor returns null (page has no
// overlays), it falls back to the plain source raster (identical-to-today thumb).
describe('PageThumbnailPanel — overlay compositor (G17)', () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('uses the compositor result when it returns a data URL (skips generateThumbnail)', async () => {
    const renderer = { generateThumbnail: vi.fn().mockResolvedValue('data:image/jpeg;base64,SOURCE') } as unknown as PDFRenderer;
    const model = makeModel(1);
    const panel = new PageThumbnailPanel({
      container, renderer, model,
      onNavigate: vi.fn(), onDelete: vi.fn(), onReorder: vi.fn(), onRotate: vi.fn(),
      onAddPdf: vi.fn(), onDownload: vi.fn(), onDownloadImage: vi.fn(),
    });
    const compositor = vi.fn().mockResolvedValue('data:image/jpeg;base64,OVERLAY');
    panel.setOverlayCompositor(compositor);
    await panel.render();
    await new Promise(r => { setTimeout(r, 0); });
    expect(compositor).toHaveBeenCalledWith(0);
    expect(renderer.generateThumbnail).not.toHaveBeenCalled();
    const img = container.querySelector('img.thumb-img');
    expect(img?.getAttribute('src')).toBe('data:image/jpeg;base64,OVERLAY');
  });

  it('falls back to generateThumbnail when the compositor returns null', async () => {
    const renderer = { generateThumbnail: vi.fn().mockResolvedValue('data:image/jpeg;base64,SOURCE') } as unknown as PDFRenderer;
    const model = makeModel(1);
    const panel = new PageThumbnailPanel({
      container, renderer, model,
      onNavigate: vi.fn(), onDelete: vi.fn(), onReorder: vi.fn(), onRotate: vi.fn(),
      onAddPdf: vi.fn(), onDownload: vi.fn(), onDownloadImage: vi.fn(),
    });
    const compositor = vi.fn().mockResolvedValue(null);
    panel.setOverlayCompositor(compositor);
    await panel.render();
    await new Promise(r => { setTimeout(r, 0); });
    expect(compositor).toHaveBeenCalledWith(0);
    expect(renderer.generateThumbnail).toHaveBeenCalledWith(0);
    const img = container.querySelector('img.thumb-img');
    expect(img?.getAttribute('src')).toBe('data:image/jpeg;base64,SOURCE');
  });
});

// F2b — on mobile the five overlaid hover controls are hidden (CSS); a single ⋮
// button opens a full-size action menu (≥44px rows). These jsdom tests guard the
// DOM + wiring; the mobile-CSS / 44px-row checks live in the real-Chrome evidence.
describe('PageThumbnailPanel — mobile ⋮ action menu (F2b)', () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.querySelectorAll('.thumb-action-menu, .thumb-img-menu').forEach(el => el.remove());
  });

  function makePanelFull(model: DocumentModel) {
    const cbs = {
      onNavigate: vi.fn(), onDelete: vi.fn(), onReorder: vi.fn(), onRotate: vi.fn(),
      onAddPdf: vi.fn(), onDownload: vi.fn(), onDownloadImage: vi.fn(),
    };
    const panel = new PageThumbnailPanel({ container, renderer: makeRenderer(), model, ...cbs });
    return { panel, ...cbs };
  }
  const flush = (): Promise<void> => new Promise(r => { setTimeout(r, 0); });

  it('renders a .thumb-more button per thumbnail', async () => {
    const { panel } = makePanelFull(makeModel(3));
    await panel.render();
    const more = container.querySelectorAll('.thumb-more');
    expect(more).toHaveLength(3);
    expect((more[0] as HTMLElement).title).toBe('thumbnail.moreActions');
  });

  it('clicking ⋮ opens an action menu with 5 rows', async () => {
    const { panel } = makePanelFull(makeModel(2));
    await panel.render();
    (container.querySelector('.thumb-more') as HTMLElement).click();
    const menu = document.body.querySelector('.thumb-action-menu');
    expect(menu).not.toBeNull();
    expect(menu?.querySelectorAll('.thumb-action-menu-item')).toHaveLength(5);
  });

  it('rows invoke the correct callbacks (rotate L/R, export PDF, delete)', async () => {
    const { panel, onRotate, onDownload, onDelete } = makePanelFull(makeModel(3));
    await panel.render();
    (container.querySelectorAll('.thumb-more')[1] as HTMLElement).click(); // page-1
    document.body.querySelectorAll<HTMLElement>('.thumb-action-menu-item')[0].click();
    expect(onRotate).toHaveBeenCalledWith('page-1', 90);
    (container.querySelectorAll('.thumb-more')[1] as HTMLElement).click();
    document.body.querySelectorAll<HTMLElement>('.thumb-action-menu-item')[1].click();
    expect(onRotate).toHaveBeenLastCalledWith('page-1', -90);
    (container.querySelectorAll('.thumb-more')[1] as HTMLElement).click();
    document.body.querySelectorAll<HTMLElement>('.thumb-action-menu-item')[2].click();
    expect(onDownload).toHaveBeenCalledWith(1);
    (container.querySelectorAll('.thumb-more')[1] as HTMLElement).click();
    document.body.querySelectorAll<HTMLElement>('.thumb-action-menu-item')[4].click();
    expect(onDelete).toHaveBeenCalledWith('page-1');
  });

  it('the "export image" row closes the action menu and opens the format menu', async () => {
    const { panel } = makePanelFull(makeModel(2));
    await panel.render();
    (container.querySelector('.thumb-more') as HTMLElement).click();
    document.body.querySelectorAll<HTMLElement>('.thumb-action-menu-item')[3].click();
    expect(document.body.querySelector('.thumb-action-menu')).toBeNull();
    expect(document.body.querySelector('.thumb-img-menu')).not.toBeNull();
  });

  it('Escape closes the open menu', async () => {
    const { panel } = makePanelFull(makeModel(1));
    await panel.render();
    (container.querySelector('.thumb-more') as HTMLElement).click();
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.body.querySelector('.thumb-action-menu')).toBeNull();
  });

  it('a second ⋮ click toggles the menu closed', async () => {
    const { panel } = makePanelFull(makeModel(1));
    await panel.render();
    const more = container.querySelector('.thumb-more') as HTMLElement;
    more.click();
    expect(document.body.querySelector('.thumb-action-menu')).not.toBeNull();
    more.click();
    expect(document.body.querySelector('.thumb-action-menu')).toBeNull();
  });
});
