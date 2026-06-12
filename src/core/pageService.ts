import * as pdfjsLib from 'pdfjs-dist';
import type { PDFRenderer } from '../infra/pdfRenderer';
import type { PDFElement } from '../elements/annotationElement';
import type { ShapeElement } from '../elements/shapeElement';
import {
  HistoryManager, AddPagesCmd, DeletePageCmd, ReorderPagesCmd, RotatePageCmd,
  MacroCmd, TransformAnnotationsCmd,
  type Command, type ElementTransformSnapshot,
} from './historyManager';
import type { InkLayer } from '../infra/inkLayer';
import { DocumentModel, PAGE_SIZES } from './documentModel';
import type { IErrorReporter } from './errorReporter';
import type { IProgressManager } from '../ui/progressManager';
import { transformCanvasPoint } from '../utils/geometry';
import type { ToolMode } from './pdfEditorApp';

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
      const mmW = parseFloat((document.getElementById('blankPageW') as HTMLInputElement)?.value ?? '210');
      const mmH = parseFloat((document.getElementById('blankPageH') as HTMLInputElement)?.value ?? '297');
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

    const newPage = ctx.documentModel.addBlankPage(w, h, atIndex);
    ctx.documentModel.currentPageIndex = ctx.documentModel.pages.indexOf(newPage);

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
      void ctx.renderThumbnails();
      ctx.updateActiveThumbnail();
      ctx.updatePageInfo();
      void ctx.renderCurrentPage().then(() => ctx.rebuildElementLayer());
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
