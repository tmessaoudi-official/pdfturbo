import * as pdfjsLib from 'pdfjs-dist';
import type { PDFRenderer } from '../infra/pdfRenderer';
import type { PDFElement } from '../elements/annotationElement';
import type { ShapeElement } from '../elements/shapeElement';
import {
  HistoryManager, AddPagesCmd, DeletePageCmd, ReorderPagesCmd, RotatePageCmd,
  SetPageCropCmd, InsertBlankPageCmd, MacroCmd, TransformAnnotationsCmd,
  type Command, type ElementTransformSnapshot,
} from './historyManager';
import type { InkLayer } from '../infra/inkLayer';
import { DocumentModel, PAGE_SIZES, type DocumentPage, type PageCrop } from './documentModel';
import type { IErrorReporter } from './errorReporter';
import type { IProgressManager } from '../ui/progressManager';
import { transformCanvasPoint, redactionRectToContent, clampContentRect, marginsToRect } from '../utils/geometry';
import type { ToolMode } from './pdfTurboApp';

/**
 * NaN-safe parse for the custom blank-page mm inputs (#QA-2026-06-23 P3 #4). Empty / non-numeric
 * / non-positive input falls back to the given default; the result is clamped to a sane positive
 * page range (10mm–5080mm ≈ the PDF 14400pt ceiling) so a malformed value can never insert a
 * NaN-, zero-, or absurdly-sized blank page.
 */
export function clampPageMm(raw: string | undefined, fallbackMm: number): number {
  const n = parseFloat(raw ?? '');
  const mm = Number.isFinite(n) && n > 0 ? n : fallbackMm;
  return Math.min(5080, Math.max(10, mm));
}

export interface IPageContext {
  readonly documentModel: DocumentModel;
  readonly elements: PDFElement[];
  readonly historyManager: HistoryManager;
  readonly inkLayer: InkLayer;
  readonly reportError: IErrorReporter;
  readonly progress: IProgressManager;
  readonly renderer: PDFRenderer;

  zoomScale: number;
  isFitMode: boolean;
  pendingModeAfterBlankPage: string | null;

  readonly containerWidth: number;

  onPageStructureChange(): Promise<void>;
  renderCurrentPage(): Promise<void>;
  rebuildElementLayer(): void;
  renderInkLayer(): void;
  updatePageInfo(): void;
  selectElement(el: PDFElement | null): void;
  autosave(): void;
  enableUI(): void;
  enableFileMenuDocItems(): void;
  setMode(mode: ToolMode): void;
  hideEmptyState(): void;

  clearSearchMatches(): void;
  clearSearchManagerState(): void;
  hasFindBarOpen(): boolean;
  hasFindInput(): boolean;
  clearFindCount(): void;
  searchIfActive(): void;

  setZoomDisplay(text: string): void;

  refreshExportPreviewIfOpen(): void;

  invalidateThumbnail(pageId: string): void;
  invalidateAllThumbnails(): void;
  updateActiveThumbnail(): void;
  renderThumbnails(): Promise<void>;
  ensureThumbnailPanel(): void;
  showThumbnailContainer(): void;

  clearTextSearchCache(): void;
  imagesToPdf(files: File[]): Promise<{ bytes: Uint8Array; name: string }>;
}

export class PageService {
  constructor(private readonly _ctx: IPageContext) {}

  async rotatePage(pageId: string, delta: number): Promise<void> {
    const ctx = this._ctx;
    const docPage = ctx.documentModel.pages.find(p => p.id === pageId);
    if (!docPage) return;
    const src = ctx.documentModel.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return;

    const pageElements = ctx.elements.filter(e => e.pageId === pageId);

    const pdfPage = await src.doc.getPage(docPage.sourcePageNum);
    const srcRot = (pdfPage.rotate as number) ?? 0;
    const vp0 = pdfPage.getViewport({ scale: 1, rotation: 0 });
    const W = vp0.width, H = vp0.height;

    const oldUserRot = docPage.rotation ?? 0;
    const newUserRot = ((oldUserRot + delta) % 360 + 360) % 360;
    const fromRot = ((srcRot + oldUserRot) % 360 + 360) % 360;
    const toRot   = ((srcRot + newUserRot) % 360 + 360) % 360;

    const rotateCmd = new RotatePageCmd(ctx.documentModel, pageId, delta, () => {
      ctx.invalidateThumbnail(pageId);
      void ctx.onPageStructureChange();
    });

    const inkStrokes = ctx.inkLayer.getStrokes(pageId);
    const inkBefore  = inkStrokes.map(s => s.points.map(p => ({ ...p })));
    const inkAfter   = inkStrokes.map(s =>
      s.points.map(p => transformCanvasPoint(p.x, p.y, W, H, fromRot, toRot))
    );
    const hasInk = inkStrokes.length > 0;

    if (!pageElements.length && !hasInk) {
      ctx.historyManager.execute(rotateCmd);
      return;
    }

    const before = new Map<number, ElementTransformSnapshot>();
    const after  = new Map<number, ElementTransformSnapshot>();
    for (const el of pageElements) {
      before.set(el.id, {
        x: el.x, y: el.y, width: el.width, height: el.height,
        rotation: el.rotation,
        x1: (el as ShapeElement).x1, y1: (el as ShapeElement).y1,
        x2: (el as ShapeElement).x2, y2: (el as ShapeElement).y2,
        points: (el as ShapeElement).points?.map(p => ({ ...p })),
      });
      const snap = this._rotateElementSnapshot(el, W, H, fromRot, toRot);
      const shapType = (el as ShapeElement).shapeType;
      const isGeometric = el.type === 'shape' && (shapType === 'arrow' || shapType === 'freehand');
      if (!isGeometric) snap.rotation = ((el.rotation + delta) % 360 + 360) % 360;
      after.set(el.id, snap);
    }

    const cmds: Command[] = [];
    if (pageElements.length) {
      cmds.push(new TransformAnnotationsCmd(ctx.elements, before, after));
    }
    if (hasInk) {
      cmds.push({
        execute: () => { inkStrokes.forEach((s, i) => { s.points = inkAfter[i].map(p => ({ ...p })); }); },
        undo:    () => { inkStrokes.forEach((s, i) => { s.points = inkBefore[i].map(p => ({ ...p })); }); ctx.renderInkLayer(); },
      });
    }
    cmds.push(rotateCmd);

    ctx.historyManager.execute(cmds.length === 1 ? cmds[0] : new MacroCmd(cmds));
    ctx.reportError.info('toast.annotationsAdjusted');
  }

  /**
   * Crop a page (or every page with `applyToAll`). `displayRect` is the rectangle the
   * user drew in editor DISPLAY space (rotated, y-down, top-left); it is mapped into the
   * page's unrotated content space (rotation-correct via redactionRectToContent), clamped
   * to the page box, and stored as `page.crop`. `null` clears the crop. Undoable.
   */
  async cropPage(pageId: string, displayRect: PageCrop | null, applyToAll = false): Promise<void> {
    const ctx = this._ctx;
    const target = ctx.documentModel.pages.find(p => p.id === pageId);
    if (!target) return;

    // Map the drawn display-space rect → the target page's unrotated content space.
    let contentCrop: PageCrop | null = null;
    if (displayRect) {
      const g = await this._pageGeom(target);
      if (!g) return;
      const totalRot = ((g.srcRot + (target.rotation ?? 0)) % 360 + 360) % 360;
      const clamped = clampContentRect(redactionRectToContent(displayRect, g.W, g.H, totalRot), g.W, g.H);
      if (clamped.width < 1 || clamped.height < 1) return; // degenerate drag → ignore
      contentCrop = clamped;
    }

    if (!applyToAll) {
      this._commitCrops([{ pageId, crop: contentCrop }], !!contentCrop, false);
      return;
    }

    // Apply the SAME content-space crop to every page, clamped to each page's own box.
    const entries: { pageId: string; crop: PageCrop | null }[] = [];
    for (const p of ctx.documentModel.pages) {
      let perPage: PageCrop | null = contentCrop;
      if (contentCrop) {
        const g = await this._pageGeom(p);
        if (!g) continue;
        const c = clampContentRect(contentCrop, g.W, g.H);
        if (c.width < 1 || c.height < 1) continue;
        perPage = c;
      }
      entries.push({ pageId: p.id, crop: perPage });
    }
    this._commitCrops(entries, !!contentCrop, true);
  }

  /**
   * Crop by typed per-edge MARGINS in points (#G23 v1b), the numeric companion to drag-to-crop.
   *
   * Margins are converted PER PAGE rather than once, which is a genuine improvement over the drag
   * path's apply-to-all: "20pt off each edge" means the same thing on a mixed-size document, whereas
   * one rect clamped to each page does not. A page whose margins leave nothing to show is skipped
   * rather than cropped to nothing. Shares `_commitCrops`, so undo/redo, thumbnail invalidation and
   * the toast are identical to the drag path by construction.
   */
  async cropPageByMargins(
    pageId: string,
    margins: { top: number; right: number; bottom: number; left: number },
    applyToAll = false,
  ): Promise<void> {
    const ctx = this._ctx;
    const targets = applyToAll
      ? ctx.documentModel.pages
      : ctx.documentModel.pages.filter(p => p.id === pageId);
    if (!targets.length) return;

    // Nothing typed is NOT a crop. Without this, clicking ✓ on four empty inputs stored a full-page
    // "crop", consumed an undo entry for a visually undetectable change, and — because
    // `getPageCropBox` falls back to the MediaBox — added a /CropBox to a page that had none, so the
    // exported bytes stopped being byte-identical. The ⤺ button is how a crop is cleared.
    if (margins.top <= 0 && margins.right <= 0 && margins.bottom <= 0 && margins.left <= 0) return;

    const entries: { pageId: string; crop: PageCrop | null }[] = [];
    let swallowed = 0;
    for (const p of targets) {
      const g = await this._pageGeom(p);
      if (!g) continue;
      // ROTATION: the user types what they SEE, so inset the DISPLAY box and map the result through the
      // same `redactionRectToContent` the drag path uses. Deriving the content rect from margins
      // directly ignored `srcRot`/`p.rotation` and cropped the wrong visual edge on any rotated page —
      // and a `/Rotate 90` landscape scan hits that without the user rotating anything. Sharing the
      // mapping is what makes "top" mean the same thing in both entry points.
      const totalRot = ((g.srcRot + (p.rotation ?? 0)) % 360 + 360) % 360;
      const swap = totalRot % 180 === 90;
      const displayRect = marginsToRect(margins, swap ? g.H : g.W, swap ? g.W : g.H);
      if (!displayRect) { swallowed += 1; continue; } // margins swallow this page — skip, never crop to nothing
      const crop = clampContentRect(redactionRectToContent(displayRect, g.W, g.H, totalRot), g.W, g.H);
      if (crop.width < 1 || crop.height < 1) { swallowed += 1; continue; }
      entries.push({ pageId: p.id, crop });
    }
    if (!entries.length) { ctx.reportError.warn('toast.cropMarginsTooLarge'); return; }
    this._commitCrops(entries, true, applyToAll);
    // A PARTIAL skip must be surfaced too: reporting "applied to all pages" while silently leaving a
    // small page uncropped is the misleading case, and mixed-size documents are exactly what per-page
    // conversion exists for.
    if (swallowed > 0) ctx.reportError.warn('toast.cropMarginsTooLarge');
  }

  /**
   * Build and execute the crop command(s). ONE place, so the drag and margin entry points cannot drift
   * on undo grouping, thumbnail invalidation or which toast fires. The canvas re-render rides the
   * CURRENT page's command (so it fires on execute AND undo); every page invalidates its own thumbnail.
   */
  private _commitCrops(
    entries: { pageId: string; crop: PageCrop | null }[],
    cropping: boolean,
    all: boolean,
  ): void {
    const ctx = this._ctx;
    if (!entries.length) return;
    const currentId = ctx.documentModel.currentPage?.id;
    const cmds: Command[] = entries.map(({ pageId: pid, crop }) => {
      const onUpd = pid === currentId
        ? () => { ctx.invalidateThumbnail(pid); void ctx.onPageStructureChange(); }
        : () => { ctx.invalidateThumbnail(pid); };
      return new SetPageCropCmd(ctx.documentModel, pid, crop, onUpd);
    });
    ctx.historyManager.execute(cmds.length === 1 ? cmds[0] : new MacroCmd(cmds));
    if (!cropping) { ctx.reportError.info('toast.cropRemoved'); return; }
    ctx.reportError.info(all ? 'toast.cropAppliedAll' : 'toast.cropApplied');
  }

  /** Unrotated content dimensions + source rotation for a page (source viewport or blank dims). */
  private async _pageGeom(p: DocumentPage): Promise<{ W: number; H: number; srcRot: number } | null> {
    if (p.sourcePdfId === 'blank') return { W: p.blankWidth ?? 595, H: p.blankHeight ?? 842, srcRot: 0 };
    const src = this._ctx.documentModel.sourcePdfs.get(p.sourcePdfId);
    if (!src) return null;
    const pg = await src.doc.getPage(p.sourcePageNum);
    const vp = pg.getViewport({ scale: 1, rotation: 0 });
    return { W: vp.width, H: vp.height, srcRot: (pg.rotate as number) ?? 0 };
  }

  deletePage(pageId: string): void {
    const ctx = this._ctx;
    if (ctx.documentModel.pageCount <= 1) {
      ctx.reportError.warn('toast.cannotDeleteOnlyPage');
      return;
    }
    const src = ctx.documentModel.sourcePdfs.get(
      ctx.documentModel.pages.find(p => p.id === pageId)?.sourcePdfId ?? ''
    );
    const cmd = new DeletePageCmd(
      ctx.documentModel, ctx.elements, pageId,
      () => ctx.onPageStructureChange(),
      src,
    );
    ctx.historyManager.execute(cmd);
  }

  reorderPages(newOrder: string[]): void {
    const ctx = this._ctx;
    const before = ctx.documentModel.pages.map(p => p.id);
    const cmd = new ReorderPagesCmd(ctx.documentModel, before, newOrder, () => ctx.onPageStructureChange());
    ctx.historyManager.execute(cmd);
  }

  async addPages(e: Event): Promise<void> {
    const ctx = this._ctx;
    const files = Array.from((e.target as HTMLInputElement).files ?? []);
    (e.target as HTMLInputElement).value = '';
    ctx.clearTextSearchCache();
    if (!files.length) return;

    const addProg = ctx.progress.begin('progress.loadingDocument');
    let addedCount = 0;
    try {
      for (const file of files) {
        const isPdf   = file.type === 'application/pdf';
        const isImage = file.type.startsWith('image/');
        if (!isPdf && !isImage) continue;
        try {
          let typedBytes: Uint8Array;
          let fileName: string;
          if (isImage) {
            const { bytes, name } = await ctx.imagesToPdf([file]);
            typedBytes = bytes;
            fileName = name;
          } else {
            typedBytes = new Uint8Array(await file.arrayBuffer());
            fileName = file.name;
          }
          const bytesToStore = typedBytes.slice(0);
          const doc = await pdfjsLib.getDocument({ data: typedBytes }).promise;
          const src = ctx.documentModel.addSourcePdf(doc, bytesToStore, fileName);
          const cmd = new AddPagesCmd(ctx.documentModel, src.id, undefined, () => ctx.onPageStructureChange());
          ctx.historyManager.execute(cmd);
          addedCount++;
        } catch (err) {
          ctx.reportError.error('toast.fileLoadFailed', err, { name: file.name });
        }
      }
      if (addedCount > 0) {
        ctx.reportError.info('toast.filesAdded', { count: addedCount });
      }
      addProg.done();
    } catch (err) {
      addProg.failed();
      ctx.reportError.error('toast.pdfLoadFailed', err);
    }
  }

  insertBlankPage(): void {
    const ctx = this._ctx;
    const sizeKey = (document.getElementById('blankPageSize') as HTMLSelectElement)?.value ?? 'a4';
    const position = (document.getElementById('blankPagePosition') as HTMLSelectElement)?.value ?? 'end';

    let w = 595, h = 842;
    if (sizeKey === 'custom') {
      const mmW = clampPageMm((document.getElementById('blankPageW') as HTMLInputElement)?.value, 210);
      const mmH = clampPageMm((document.getElementById('blankPageH') as HTMLInputElement)?.value, 297);
      w = Math.round(mmW * 2.8346);
      h = Math.round(mmH * 2.8346);
    } else if (sizeKey === 'match') {
      const cur = ctx.documentModel.currentPage;
      if (cur?.blankWidth) { w = cur.blankWidth; h = cur.blankHeight ?? 842; }
    } else {
      const s = PAGE_SIZES[sizeKey];
      if (s) { w = s.width; h = s.height; }
    }

    const wasEmpty = ctx.documentModel.pageCount === 0;

    let atIndex: number;
    const total = ctx.documentModel.pageCount;
    switch (position) {
      case 'beginning': atIndex = 0; break;
      case 'after':     atIndex = ctx.documentModel.currentPageIndex + 1; break;
      default:          atIndex = total;
    }

    const cmd = new InsertBlankPageCmd(
      ctx.documentModel, w, h, atIndex, () => ctx.onPageStructureChange(),
    );
    ctx.historyManager.execute(cmd);

    if (wasEmpty) {
      void (async () => {
        try {
          ctx.hideEmptyState();
          ctx.isFitMode = true;
          const fitScale = await ctx.renderer.computeFitScale(ctx.containerWidth);
          const isMobile = window.innerWidth <= 640;
          await this.applyZoom(isMobile ? Math.max(fitScale, 0.65) : fitScale);
          ctx.enableUI();
          ctx.enableFileMenuDocItems();
          ctx.showThumbnailContainer();
          ctx.ensureThumbnailPanel();
          await ctx.renderThumbnails();
          ctx.updatePageInfo();
          ctx.rebuildElementLayer();
          ctx.autosave();
          ctx.reportError.info('toast.blankPageInserted');
          const pendingMode = ctx.pendingModeAfterBlankPage;
          ctx.pendingModeAfterBlankPage = null;
          if (pendingMode) ctx.setMode(pendingMode as ToolMode);
        } catch (err) {
          ctx.reportError.error('toast.blankPageInsertFailed', err);
        }
      })();
    } else {
      ctx.autosave();
      void ctx.renderThumbnails().catch((e: unknown) => ctx.reportError.silent(e, 'insertBlankPage:thumbnails'));
      ctx.updateActiveThumbnail();
      ctx.updatePageInfo();
      // M0 #9 — surface a render failure instead of leaving an unhandled rejection.
      void ctx.renderCurrentPage()
        .then(() => ctx.rebuildElementLayer())
        .catch((e: unknown) => ctx.reportError.error('toast.renderFailed', e));
      ctx.reportError.info('toast.blankPageInserted');
    }
  }

  async goToPageIndex(index: number): Promise<void> {
    const ctx = this._ctx;
    if (index < 0 || index >= ctx.documentModel.pageCount) return;
    if (index === ctx.documentModel.currentPageIndex) return;
    ctx.documentModel.currentPageIndex = index;
    ctx.selectElement(null);
    ctx.clearSearchMatches();
    ctx.clearSearchManagerState();
    if (ctx.hasFindBarOpen()) ctx.clearFindCount();
    if (ctx.isFitMode) {
      const fitScale = await ctx.renderer.computeFitScale(ctx.containerWidth);
      const isMobile = window.innerWidth <= 640;
      ctx.zoomScale = isMobile ? Math.max(fitScale, 0.65) : fitScale;
      ctx.renderer.setScale(ctx.zoomScale);
      ctx.setZoomDisplay(Math.round(ctx.zoomScale * 100) + '%');
    }
    await ctx.renderCurrentPage();
    ctx.updateActiveThumbnail();
    ctx.updatePageInfo();
    ctx.rebuildElementLayer();
    if (ctx.hasFindBarOpen() && ctx.hasFindInput()) ctx.searchIfActive();
    ctx.refreshExportPreviewIfOpen();
  }

  async applyZoom(newScale: number): Promise<void> {
    const ctx = this._ctx;
    if (!Number.isFinite(newScale) || newScale <= 0) return;
    ctx.zoomScale = Math.max(0.25, Math.min(3.0, newScale));
    ctx.renderer.setScale(ctx.zoomScale);
    ctx.setZoomDisplay(Math.round(ctx.zoomScale * 100) + '%');
    await ctx.renderCurrentPage();
    ctx.invalidateAllThumbnails();
    ctx.rebuildElementLayer();
    if (ctx.hasFindBarOpen() && ctx.hasFindInput()) ctx.searchIfActive();
    ctx.refreshExportPreviewIfOpen();
  }

  private _rotateElementSnapshot(
    el: PDFElement, W: number, H: number, fromRot: number, toRot: number,
  ): ElementTransformSnapshot {
    const tp = (cx: number, cy: number) => transformCanvasPoint(cx, cy, W, H, fromRot, toRot);
    const shape = el as ShapeElement;

    if (el.type === 'shape' && shape.shapeType === 'arrow') {
      const p1 = tp(shape.x1, shape.y1);
      const p2 = tp(shape.x2, shape.y2);
      return {
        x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y),
        width:  Math.abs(p2.x - p1.x) || el.width,
        height: Math.abs(p2.y - p1.y) || el.height,
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      };
    }

    if (el.type === 'shape' && shape.shapeType === 'freehand') {
      const pts = shape.points.map(p => tp(p.x, p.y));
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      return {
        x: Math.min(...xs), y: Math.min(...ys),
        width:  Math.max(...xs) - Math.min(...xs) || el.width,
        height: Math.max(...ys) - Math.min(...ys) || el.height,
        points: pts,
      };
    }

    const c = tp(el.x + el.width / 2, el.y + el.height / 2);
    return {
      x: c.x - el.width / 2,
      y: c.y - el.height / 2,
      width: el.width,
      height: el.height,
    };
  }
}
