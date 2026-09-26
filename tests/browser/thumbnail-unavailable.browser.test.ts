/**
 * A6 (real Chrome) — the "preview unavailable" tile is actually VISIBLE, and nothing of the page is.
 *
 * jsdom proves the wiring (tests/ui/pageThumbnailPanel.test.ts) but has no layout: a placeholder that
 * rendered 0×0, or an image left visible underneath it, would pass there. This mounts the real panel
 * with the real stylesheet and measures both. The BEFORE state is the pre-A6 behaviour — the compositor
 * gives up and the panel shows the plain source raster, which here carries the word SECRET the
 * redaction was hiding — captured for the visual record alongside the AFTER state.
 */
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { page } from 'vitest/browser';
import '../../src/styles/pdf-layers.css';
import { PageThumbnailPanel } from '../../src/ui/pageThumbnailPanel';
import { DocumentModel } from '../../src/core/documentModel';
import type { PDFRenderer } from '../../src/infra/pdfRenderer';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import { TextElement } from '../../src/elements/textElement';
import { RedactionElement } from '../../src/elements/redactionElement';
import type { PDFElement } from '../../src/elements/annotationElement';
import { initI18n, changeLanguage, t } from '../../src/utils/i18n';

/** A stand-in for the plain source raster: the unredacted page, with SECRET on it. */
function sourceRaster(): string {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 80;
  const cx = c.getContext('2d') as CanvasRenderingContext2D;
  cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, 64, 80);
  cx.fillStyle = '#c00000'; cx.font = 'bold 13px sans-serif'; cx.fillText('SECRET', 4, 40);
  return c.toDataURL('image/png');
}

function mount(compositor: (i: number) => Promise<string | null>, renderer: PDFRenderer): HTMLElement {
  const host = document.createElement('div');
  host.style.cssText = 'display:inline-block;padding:8px;background:#f8fafc';
  document.body.appendChild(host);
  const model = new DocumentModel();
  model.pages.push({ id: 'p1', sourcePdfId: 'src', sourcePageNum: 1, rotation: 0, blankWidth: undefined, blankHeight: undefined });
  const panel = new PageThumbnailPanel({
    container: host, renderer, model,
    onNavigate: vi.fn(), onDelete: vi.fn(), onReorder: vi.fn(), onRotate: vi.fn(),
    onAddPdf: vi.fn(), onDownload: vi.fn(), onDownloadImage: vi.fn(),
  });
  panel.setOverlayCompositor(compositor);
  void panel.render();
  return host;
}

const settle = () => new Promise(r => { setTimeout(r, 300); });

beforeAll(async () => { await initI18n(); await changeLanguage('en'); });
afterEach(() => { document.body.innerHTML = ''; });

describe('A6 — a failed redacted thumbnail is a visible placeholder', () => {
  it('BEFORE (the old fallback, for the record): the plain source raster is what the tile shows', async () => {
    const renderer = { generateThumbnail: vi.fn().mockResolvedValue(sourceRaster()) } as unknown as PDFRenderer;
    const host = mount(() => Promise.resolve(null), renderer);
    await settle();
    const img = host.querySelector('img.thumb-img') as HTMLImageElement;
    expect(img.src.startsWith('data:image/png')).toBe(true);
    await page.screenshot({ path: '../../var/claude/qa-shots/a6/before-plain-source.png', element: host });
  });

  it('AFTER: the placeholder fills the tile, its text is readable, and no page image is shown', async () => {
    const renderer = { generateThumbnail: vi.fn().mockResolvedValue(sourceRaster()) } as unknown as PDFRenderer;
    const host = mount(() => Promise.reject(new Error('redacted render failed')), renderer);
    await settle();
    expect(renderer.generateThumbnail).not.toHaveBeenCalled();
    const note = host.querySelector('.thumb-unavailable') as HTMLElement;
    const tile = host.querySelector('.thumb-item') as HTMLElement;
    const img = host.querySelector('img.thumb-img') as HTMLImageElement;
    expect(note).not.toBeNull();
    const n = note.getBoundingClientRect(), box = tile.getBoundingClientRect();
    expect(n.width).toBeGreaterThan(box.width * 0.8);
    expect(n.height).toBeGreaterThan(box.height * 0.8);
    expect(getComputedStyle(img).display).toBe('none');
    expect(img.src.startsWith('data:image/png')).toBe(false);
    // The text wraps inside the tile rather than overflowing it.
    expect(note.scrollWidth).toBeLessThanOrEqual(note.clientWidth + 1);
    expect(getComputedStyle(note).color).toBe('rgb(55, 65, 81)');
    expect(note.textContent).toBe('Preview unavailable');
    await page.screenshot({ path: '../../var/claude/qa-shots/a6/after-unavailable.png', element: host });
  });

  it('the placeholder text fits the 64px tile in all three languages', async () => {
    for (const lang of ['en', 'fr', 'ar']) {
      await changeLanguage(lang);
      const renderer = { generateThumbnail: vi.fn().mockResolvedValue(null) } as unknown as PDFRenderer;
      const host = mount(() => Promise.reject(new Error('x')), renderer);
      await settle();
      const note = host.querySelector('.thumb-unavailable') as HTMLElement;
      expect(note.textContent, lang).toBe(t('thumbnail.previewUnavailable'));
      expect(note.textContent, lang).not.toBe('thumbnail.previewUnavailable');
      expect(note.scrollWidth, lang).toBeLessThanOrEqual(note.clientWidth + 1);
      expect(note.scrollHeight, lang).toBeLessThanOrEqual(note.clientHeight + 1);
      await page.screenshot({ path: `../../var/claude/qa-shots/a6/after-${lang}.png`, element: host });
      document.body.innerHTML = '';
    }
    await changeLanguage('en');
  });
});

/**
 * A REAL failure, not a mocked compositor: the Arabic font is fetched lazily on first use, so a user
 * who is offline at that moment makes the bake of a page with Arabic text throw. The real
 * ExportService is wired as the panel's compositor exactly as pdfTurboApp does. The redaction sits
 * well clear of the text (so the drop keeps the text and the bake genuinely runs into the font).
 */
describe('A6 — a real render failure (Arabic font unreachable) on the live service', () => {
  function liveMount(withRedaction: boolean, renderer: PDFRenderer): HTMLElement {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const model = new DocumentModel();
    model.pages.push({ id: 'p1', sourcePdfId: 'blank', sourcePageNum: 0, rotation: 0, blankWidth: 400, blankHeight: 400 });
    const ar = Object.assign(new TextElement(40, 250, 'p1', { width: 200, height: 30, fontSize: 14 }), { text: 'نص سري' });
    const elements: PDFElement[] = [ar as unknown as PDFElement];
    if (withRedaction) elements.push(new RedactionElement(40, 20, 100, 20, 'p1', '#000000') as unknown as PDFElement);
    const svc = new ExportService({
      documentModel: Object.assign(model, { sourcePdfs: new Map(), watermark: { enabled: false }, bates: { enabled: false } }),
      elements, formValues: {}, currentFilename: 'x.pdf', exportPassword: null,
      inkLayer: { getStrokes: () => [] },
      reportError: { info() {}, warn() {}, error() {}, silent() {} },
      progress: { begin: () => ({ done() {}, failed() {}, update() {}, setFraction() {} }) },
      cleanEmptyTextElements() {}, renderCurrentPage: () => Promise.resolve(), rebuildElementLayer() {},
    } as unknown as IExportContext);
    const panel = new PageThumbnailPanel({
      container: host, renderer, model,
      onNavigate: vi.fn(), onDelete: vi.fn(), onReorder: vi.fn(), onRotate: vi.fn(),
      onAddPdf: vi.fn(), onDownload: vi.fn(), onDownloadImage: vi.fn(),
    });
    panel.setOverlayCompositor(i => svc.renderThumbnailWithOverlays(i));
    void panel.render();
    return host;
  }

  const realFetch = window.fetch;
  let fontRequests = 0;
  beforeAll(() => {
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input instanceof Request ? input.url : input).includes('NotoNaskh')) {
        fontRequests++;
        return Promise.reject(new TypeError('Failed to fetch (offline)'));
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });
  afterAll(() => { window.fetch = realFetch; });

  const waitFor = async (cond: () => boolean) => {
    for (let i = 0; i < 100 && !cond(); i++) await new Promise(r => { setTimeout(r, 100); });
  };

  it('redacted page: the strip shows "Preview unavailable", and the plain page is never asked for', async () => {
    const renderer = { generateThumbnail: vi.fn().mockResolvedValue(sourceRaster()) } as unknown as PDFRenderer;
    const host = liveMount(true, renderer);
    await waitFor(() => host.querySelector('.thumb-unavailable') !== null);
    expect(fontRequests, 'the bake must actually have reached the font fetch').toBeGreaterThan(0);
    expect(host.querySelector('.thumb-unavailable')?.textContent).toBe('Preview unavailable');
    expect(renderer.generateThumbnail).not.toHaveBeenCalled();
    await page.screenshot({ path: '../../var/claude/qa-shots/a6/live-font-offline.png', element: host });
  }, 60_000);

  it('CONTROL: the same failure on an unredacted page falls back to the plain raster, as before', async () => {
    const renderer = { generateThumbnail: vi.fn().mockResolvedValue(sourceRaster()) } as unknown as PDFRenderer;
    const before = fontRequests;
    const host = liveMount(false, renderer);
    await waitFor(() => (renderer.generateThumbnail as ReturnType<typeof vi.fn>).mock.calls.length > 0);
    expect(fontRequests).toBeGreaterThan(before);
    expect(renderer.generateThumbnail).toHaveBeenCalledWith(0);
    expect(host.querySelector('.thumb-unavailable')).toBeNull();
  }, 60_000);
});

