import type { PDFRenderer } from '../infra/pdfRenderer';
import type { DocumentModel } from '../core/documentModel';
import { t } from '../utils/i18n';

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
  private onDownloadImage: (index: number) => void;
  private _dragSrcIndex: number | null = null;
  private _thumbCache: Map<string, string> = new Map(); // pageId → dataURL

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
    onDownloadImage: (index: number) => void;
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

  // oxlint-disable-next-line eslint/require-await -- Promise contract: callers (renderThumbnails, tests) await the returned Promise<void>
  async render(): Promise<void> {
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

      if (this._thumbCache.has(page.id)) {
        img.src = this._thumbCache.get(page.id) ?? '';
      } else {
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // blank placeholder
        // Lazy-generate
        this.renderer.generateThumbnail(i).then(url => {
          if (url) {
            this._thumbCache.set(page.id, url);
            img.src = url;
          }
        });
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
      dlImgBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onDownloadImage(i); });

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
