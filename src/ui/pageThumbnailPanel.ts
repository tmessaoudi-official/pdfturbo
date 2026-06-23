import type { PDFRenderer } from '../infra/pdfRenderer';
import type { DocumentModel } from '../core/documentModel';
import type { ImageExportOptions } from '../export/exportService';
import { t } from '../utils/i18n';

/**
 * Image-export presets offered by the per-thumbnail 🖼 menu (G20). Each maps to
 * the `downloadPageAsImage` options: the default PNG (scale 2 — byte-identical to
 * the historic one-click export), a JPEG, and a high-resolution 300-DPI PNG
 * (scale ≈ 4.17 → clamped under the engine's [1,6] ceiling). `labelKey` is an
 * i18n key under `thumbnail.*`.
 */
const IMAGE_EXPORT_PRESETS: { labelKey: string; opts?: ImageExportOptions }[] = [
  { labelKey: 'thumbnail.imgPng' },
  { labelKey: 'thumbnail.imgJpeg', opts: { format: 'jpeg', quality: 0.92 } },
  { labelKey: 'thumbnail.imgPngHi', opts: { format: 'png', scale: 300 / 72 } },
];

export class PageThumbnailPanel {
  private container: HTMLElement;
  private strip: HTMLElement;
  private renderer: PDFRenderer;
  private model: DocumentModel;
  private onNavigate: (index: number) => void;
  private onDelete: (pageId: string) => void;
  private onReorder: (newOrder: string[]) => void;
  private onRotate: (pageId: string, delta: number) => void;
  private onAddPdf: () => void;
  private onDownload: (index: number) => void;
  private onDownloadImage: (index: number, opts?: ImageExportOptions) => void;
  private _dragSrcIndex: number | null = null;
  // #QA-2026-06-23 P3 #1 — after a delete-triggered re-render (which wipes the strip via
  // innerHTML=''), restore keyboard focus to the thumbnail now occupying the deleted slot
  // instead of dropping it to <body>. Set by the × button, consumed at the end of render().
  private _focusSlotAfterRender: number | null = null;
  // G20 — the open image-export preset menu (one at a time), so a second open or
  // an outside click can dismiss it.
  private _imgMenu: HTMLElement | null = null;
  private _thumbCache: Map<string, string> = new Map(); // pageId → dataURL
  // #46 — lazy rasterization: only generate a thumbnail when its item nears the
  // viewport. One shared observer; recreated/disconnected per render.
  private _io: IntersectionObserver | null = null;
  // G17 — optional compositor that rasterizes the page WITH its overlay
  // annotations + ink (a thumbnail-scale analog of the PNG export). Injected by
  // the app (delegating to ExportService.renderThumbnailWithOverlays). When it
  // returns null (page has no overlays/ink) we fall back to the plain source
  // raster so an unedited thumbnail stays identical to the source-only path.
  private _overlayCompositor: ((index: number) => Promise<string | null>) | null = null;

  constructor(opts: {
    container: HTMLElement;
    renderer: PDFRenderer;
    model: DocumentModel;
    onNavigate: (index: number) => void;
    onDelete: (pageId: string) => void;
    onReorder: (newOrder: string[]) => void;
    onRotate: (pageId: string, delta: number) => void;
    onAddPdf: () => void;
    onDownload: (index: number) => void;
    onDownloadImage: (index: number, opts?: ImageExportOptions) => void;
  }) {
    this.container = opts.container;
    this.renderer = opts.renderer;
    this.model = opts.model;
    this.onNavigate = opts.onNavigate;
    this.onDelete = opts.onDelete;
    this.onReorder = opts.onReorder;
    this.onRotate = opts.onRotate;
    this.onAddPdf = opts.onAddPdf;
    this.onDownload = opts.onDownload;
    this.onDownloadImage = opts.onDownloadImage;

    this.strip = document.createElement('div');
    this.strip.className = 'page-thumb-strip';
    this.container.appendChild(this.strip);
  }

  /**
   * Lazily create the shared IntersectionObserver that rasterizes a thumbnail
   * the first time its item nears the viewport. Returns null when the API is
   * unavailable (e.g. jsdom) — callers then fall back to eager generation.
   */
  private _ensureObserver(): IntersectionObserver | null {
    if (this._io) return this._io;
    if (typeof IntersectionObserver === 'undefined') return null;
    this._io = new IntersectionObserver((entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const item = entry.target as HTMLElement;
        obs.unobserve(item);
        const img = item.querySelector('img.thumb-img') as HTMLImageElement | null;
        if (img) void this._loadThumb(Number(item.dataset.index), item.dataset.pageId ?? '', img);
      }
    }, { root: this.container, rootMargin: '300px' });
    return this._io;
  }

  /**
   * G17 — supply a compositor that renders a page WITH its overlay annotations +
   * ink. Called by the app once after construction; absent (default) reproduces
   * the source-only thumbnail behaviour exactly.
   */
  setOverlayCompositor(fn: (index: number) => Promise<string | null>): void {
    this._overlayCompositor = fn;
  }

  /**
   * G20 — open the per-page image-export preset menu next to its 🖼 button. A
   * lightweight inline popup (no modal): one button per IMAGE_EXPORT_PRESET, each
   * invoking onDownloadImage with the preset's options. Reopening it on the same
   * (or another) button first closes the previous instance; an outside click or
   * Escape dismisses it. The menu lives on `document.body` and is positioned at
   * the button so the narrow thumbnail strip never clips it.
   */
  private _openImageMenu(anchor: HTMLElement, index: number): void {
    // Toggle: a second click on the same trigger closes the open menu.
    if (this._imgMenu) { this._closeImageMenu(); return; }
    const menu = document.createElement('div');
    menu.className = 'thumb-img-menu';
    menu.setAttribute('role', 'menu');
    for (const preset of IMAGE_EXPORT_PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.className = 'thumb-img-menu-item';
      btn.textContent = t(preset.labelKey);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeImageMenu();
        this.onDownloadImage(index, preset.opts);
      });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    // Inline-styled (no CSS-file dependency): a compact light popup at the button.
    Object.assign(menu.style, {
      position: 'fixed',
      top: `${rect.bottom + 2}px`,
      left: `${rect.left}px`,
      zIndex: '1000',
      display: 'flex',
      flexDirection: 'column',
      background: '#fff',
      border: '1px solid #cbd5e1',
      borderRadius: '6px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      padding: '4px',
      gap: '2px',
    } as Partial<CSSStyleDeclaration>);
    this._imgMenu = menu;
    // Dismiss on outside click / Escape. Registered next tick so the click that
    // opened the menu doesn't immediately close it.
    setTimeout(() => {
      document.addEventListener('click', this._onImgMenuOutside, { once: true });
      document.addEventListener('keydown', this._onImgMenuKey);
    }, 0);
  }

  private _closeImageMenu(): void {
    if (!this._imgMenu) return;
    this._imgMenu.remove();
    this._imgMenu = null;
    document.removeEventListener('click', this._onImgMenuOutside);
    document.removeEventListener('keydown', this._onImgMenuKey);
  }

  // Arrow-bound so they keep `this` and can be removed by reference.
  private _onImgMenuOutside = (): void => { this._closeImageMenu(); };
  private _onImgMenuKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this._closeImageMenu();
  };

  /** Rasterize (or reuse the cached) thumbnail for one page into `img`. */
  private async _loadThumb(index: number, pageId: string, img: HTMLImageElement): Promise<void> {
    const cached = this._thumbCache.get(pageId);
    if (cached) { img.src = cached; return; }
    // G17 — prefer the overlay-aware raster; a null result means "no overlays on
    // this page", so fall through to the plain source thumbnail (unchanged path).
    if (this._overlayCompositor) {
      const composited = await this._overlayCompositor(index);
      if (composited) { this._thumbCache.set(pageId, composited); img.src = composited; return; }
    }
    const url = await this.renderer.generateThumbnail(index);
    if (url) { this._thumbCache.set(pageId, url); img.src = url; }
  }

  // oxlint-disable-next-line eslint/require-await -- Promise contract: callers (renderThumbnails, tests) await the returned Promise<void>
  async render(): Promise<void> {
    this._io?.disconnect();
    this.strip.innerHTML = '';
    const pages = this.model.pages;
    const current = this.model.currentPageIndex;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const item = document.createElement('div');
      item.className = 'thumb-item' + (i === current ? ' thumb-active' : '');
      item.dataset.index = String(i);
      item.dataset.pageId = page.id;
      item.draggable = true;
      // M0 #8 — keyboard accessibility: the nav thumbnail is operable by keyboard,
      // not just pointer. role=button + tabindex=0 + aria-label + Enter/Space.
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      item.setAttribute('aria-label', t('thumbnail.goToPage', { page: i + 1 }));

      // Thumbnail image
      const img = document.createElement('img');
      img.className = 'thumb-img';
      img.alt = t('thumbnail.pageAlt', { page: i + 1 });

      let needsThumb = false;
      if (this._thumbCache.has(page.id)) {
        img.src = this._thumbCache.get(page.id) ?? '';
      } else {
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // blank placeholder
        needsThumb = true; // generated lazily (on intersect) after the item is appended
      }

      // Page number label
      const label = document.createElement('span');
      label.className = 'thumb-label';
      label.textContent = String(i + 1);

      // Delete button
      const del = document.createElement('button');
      del.className = 'thumb-delete';
      del.textContent = '×';
      del.title = t('thumbnail.deletePage');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        this._focusSlotAfterRender = i; // restore focus to this slot after the re-render (#QA P3 #1)
        this.onDelete(page.id);
      });

      // Rotate CCW (↺) and CW (↻) buttons
      const rotateCcw = document.createElement('button');
      rotateCcw.className = 'thumb-rotate thumb-rotate-ccw';
      rotateCcw.textContent = '↺';
      rotateCcw.title = t('thumbnail.rotateCcw');
      rotateCcw.addEventListener('click', (e) => { e.stopPropagation(); this.onRotate(page.id, 90); });

      const rotateCw = document.createElement('button');
      rotateCw.className = 'thumb-rotate thumb-rotate-cw';
      rotateCw.textContent = '↻';
      rotateCw.title = t('thumbnail.rotateCw');
      rotateCw.addEventListener('click', (e) => { e.stopPropagation(); this.onRotate(page.id, -90); });

      // Per-page download buttons
      const dlPdfBtn = document.createElement('button');
      dlPdfBtn.className = 'thumb-dl thumb-dl-pdf';
      dlPdfBtn.textContent = '📄';
      dlPdfBtn.title = t('thumbnail.exportPagePdf', { page: i + 1 });
      dlPdfBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onDownload(i); });

      const dlImgBtn = document.createElement('button');
      dlImgBtn.className = 'thumb-dl thumb-dl-img';
      dlImgBtn.textContent = '🖼';
      dlImgBtn.title = t('thumbnail.exportPageImg', { page: i + 1 });
      // G20 — open a small format/resolution preset menu instead of exporting the
      // one fixed PNG. Picking a preset calls onDownloadImage with its options;
      // the bare-default preset (no opts) reproduces the historic export exactly.
      dlImgBtn.addEventListener('click', (e) => { e.stopPropagation(); this._openImageMenu(dlImgBtn, i); });

      item.appendChild(img);
      item.appendChild(label);
      item.appendChild(rotateCcw);
      item.appendChild(rotateCw);
      item.appendChild(dlPdfBtn);
      item.appendChild(dlImgBtn);
      item.appendChild(del);

      // Navigate on click
      item.addEventListener('click', () => this.onNavigate(i));
      // Navigate on Enter/Space (keyboard parity with click). Space is prevented
      // from scrolling the page; both ignore events bubbling up from child buttons.
      item.addEventListener('keydown', (e) => {
        if (e.target !== item) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.onNavigate(i);
        }
      });

      // Drag-and-drop reorder
      item.addEventListener('dragstart', (e) => {
        this._dragSrcIndex = i;
        item.classList.add('thumb-dragging');
        e.dataTransfer?.setData('text/plain', String(i));
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('thumb-dragging');
        this._dragSrcIndex = null;
        this.strip.querySelectorAll('.thumb-item').forEach(el => el.classList.remove('thumb-over'));
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (this._dragSrcIndex !== null && this._dragSrcIndex !== i) {
          item.classList.add('thumb-over');
        }
      });
      item.addEventListener('dragleave', () => item.classList.remove('thumb-over'));
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('thumb-over');
        if (this._dragSrcIndex === null || this._dragSrcIndex === i) return;
        const newOrder = [...this.model.pages.map(p => p.id)];
        const [moved] = newOrder.splice(this._dragSrcIndex, 1);
        newOrder.splice(i, 0, moved);
        this.onReorder(newOrder);
      });

      this.strip.appendChild(item);

      if (needsThumb) {
        // Observe for lazy rasterization; eagerly generate if there's no observer.
        const io = this._ensureObserver();
        if (io) io.observe(item);
        else void this._loadThumb(i, page.id, img);
      }
    }

    // "Add PDF" button at the end
    const addBtn = document.createElement('button');
    addBtn.className = 'thumb-add-btn';
    addBtn.title = t('thumbnail.addPagesTitle');
    const plusSpan = document.createElement('span');
    plusSpan.textContent = '+';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'thumb-add-label';
    labelSpan.textContent = t('thumbnail.addPages');
    addBtn.append(plusSpan, labelSpan);
    addBtn.addEventListener('click', this.onAddPdf);
    this.strip.appendChild(addBtn);

    // #QA-2026-06-23 P3 #1 — restore focus after a delete re-render. The deleted slot index
    // is clamped to the last surviving thumbnail (deleting the end page focuses the new last).
    if (this._focusSlotAfterRender !== null) {
      const items = this.strip.querySelectorAll<HTMLElement>('.thumb-item');
      if (items.length > 0) {
        const slot = Math.min(this._focusSlotAfterRender, items.length - 1);
        items[slot]?.focus();
      }
      this._focusSlotAfterRender = null;
    }
  }

  /** Invalidate thumbnail cache for a page (call after page content changes) */
  invalidateThumb(pageId: string): void {
    this._thumbCache.delete(pageId);
  }

  /** Invalidate all thumbnails (call after zoom/source changes) */
  invalidateAll(): void {
    this._thumbCache.clear();
  }

  updateActive(): void {
    const current = this.model.currentPageIndex;
    this.strip.querySelectorAll('.thumb-item').forEach((el, i) => {
      el.classList.toggle('thumb-active', i === current);
    });
  }
}
