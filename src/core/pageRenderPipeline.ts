import type { DocumentModel } from './documentModel';
import type { PDFRenderer } from '../infra/pdfRenderer';
import type { AppDOMRefs } from '../ui/uiController';
import type { ToolMode } from '../types/tools';
import type { FormFieldOverlay } from '../utils/formFieldOverlay';
import type { TextLayerManager } from '../utils/textLayer';
import type { IErrorReporter } from '../contracts/errorReporter';
import { CROP_HANDLES, handleCursor, handlePositions, resizeDisplayRect } from '../utils/cropResize';
import { contentRectToDisplay } from '../utils/geometry';
import { isEnabled } from '../config/features';

export interface IPageRenderContext {
  readonly documentModel: DocumentModel;
  readonly renderer: PDFRenderer;
  readonly ui: AppDOMRefs;
  readonly zoomScale: number;
  readonly mode: ToolMode;
  readonly formFieldOverlay: FormFieldOverlay;
  readonly textLayerManager: TextLayerManager;
  readonly reportError: IErrorReporter;
  // Form field anti-stale pattern
  advanceFormFieldGen(): number;
  isCurrentFormFieldGen(gen: number): boolean;
  // Form values
  getFormValues(sourcePdfId: string): Record<string, string>;
  setFormValue(sourcePdfId: string, fieldName: string, value: string): void;
  /** Debounced, undoable form-fill (sets value live + records a SetFormValueCmd on idle). */
  handleFormInput(sourcePdfId: string, fieldName: string, value: string): void;
  // Warn flag
  getWarnedUnsupportedFields(): boolean;
  setWarnedUnsupportedFields(v: boolean): void;
  // Side effects
  autosave(): void;
  renderInkLayer(): void;
  /** Tile the document watermark onto a 2D context (shared with the export-preview panel). */
  drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  /** When the export-preview ghost is open it draws its OWN watermark — suppress the live one to avoid doubling. */
  readonly exportPreviewOpen: boolean;
  /**
   * Commit a resized crop frame (#G23 v1c). The rect is in editor DISPLAY space, i.e. exactly what
   * `PageService.cropPage` takes — so a resize goes through the same undoable command and the same
   * rotation mapping as a freshly drawn crop, with no second convention.
   */
  commitCropRect(pageId: string, displayRect: { x: number; y: number; width: number; height: number }): void;
}

export class PageRenderPipeline {
  constructor(private readonly _ctx: IPageRenderContext) {}

  async renderCurrentPage(): Promise<void> {
    // M0 #4 — one render epoch wraps the whole run (canvas → form → text → ink).
    // Each await is a yield point where a newer renderCurrentPage (rapid nav/zoom)
    // can start and advance the shared epoch; if that happens this run bails so it
    // never paints a stale text layer / form overlay over the newer page's canvas.
    const myGen = this._ctx.advanceFormFieldGen();
    await this._ctx.renderer.renderPageAtIndex(this._ctx.documentModel.currentPageIndex);
    if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
    await this._renderFormFields(myGen);
    if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
    await this._renderTextLayer(myGen);
    if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
    this._ctx.renderInkLayer();
    await this._renderCropFrame(myGen);
    this._renderWatermarkOverlay();
  }

  /**
   * Live watermark — draw the document watermark onto a dedicated overlay canvas above the
   * page raster so it's visible WHILE editing (it was previously export-only, which read as
   * "watermark not working"). Mirrors the export-preview ghost: a separate canvas (NOT the
   * pdf.js page canvas, so true-edit colour sampling / thumbnails stay clean), pointer-events
   * none, z-index 1 (above the page, below annotations). Removed + recreated every render, so
   * toggling the watermark or switching page/doc never leaves a stale tile. The exported PDF
   * is unaffected — export tiling stays in `buildPageOverlays` via pdf-lib.
   */
  private _renderWatermarkOverlay(): void {
    const container = this._ctx.ui.container;
    if (!container || typeof container.querySelector !== 'function') return;
    container.querySelector('#watermarkOverlay')?.remove();

    // In export-preview mode the ghost draws its own watermark canvas — skip the live one
    // so the two don't stack (which would darken the watermark).
    if (this._ctx.exportPreviewOpen) return;

    const wm = this._ctx.documentModel.watermark;
    if (!wm.enabled || !wm.text) return;

    const canvas = this._ctx.ui.canvas;
    const overlay = document.createElement('canvas');
    overlay.id = 'watermarkOverlay';
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    Object.assign(overlay.style, {
      position: 'absolute',
      left: canvas.offsetLeft + 'px',
      top: canvas.offsetTop + 'px',
      width: canvas.width + 'px',
      height: canvas.height + 'px',
      pointerEvents: 'none',
      zIndex: '1',
    });
    const ctx = overlay.getContext('2d');
    if (ctx) this._ctx.drawWatermark(ctx, canvas.width, canvas.height);
    container.appendChild(overlay);
  }

  /**
   * #G23 — draw a persistent dimmed-margin frame over the canvas showing the current
   * page's crop (Design β: the page renders full; the frame communicates what export keeps).
   * Removed when there is no crop. Maps the stored content-space crop → view space via the
   * page's effective rotation. Pure presentation — skipped when the container isn't a real DOM node.
   */
  private async _renderCropFrame(myGen: number): Promise<void> {
    const container = this._ctx.ui.container;
    if (!container || typeof container.querySelector !== 'function') return;
    container.querySelector('#cropFrameOverlay')?.remove();

    const docPage = this._ctx.documentModel.currentPage;
    // #28 kill switch, the same gate `exportPipeline` applies to BOTH its paths. Without it the
    // switch killed the button (`main.ts` removes it and `#cropControls`) while leaving a stored
    // crop painted here with live grips that still commit `SetPageCropCmd` — a frame the user can
    // drag while the export ignores the crop entirely. The removal above is deliberately BEFORE
    // this return, so flipping the switch off clears a frame an earlier render left on screen.
    if (!docPage?.crop || !isEnabled('crop')) return;

    let W: number, H: number, srcRot = 0;
    if (docPage.sourcePdfId === 'blank') {
      W = docPage.blankWidth ?? 595; H = docPage.blankHeight ?? 842;
    } else {
      const src = this._ctx.documentModel.sourcePdfs.get(docPage.sourcePdfId);
      if (!src) return;
      const page = await src.doc.getPage(docPage.sourcePageNum);
      if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
      const vp0 = page.getViewport({ scale: 1, rotation: 0 });
      W = vp0.width; H = vp0.height; srcRot = (page.rotate as number) ?? 0;
    }

    const totalRot = ((srcRot + (docPage.rotation ?? 0)) % 360 + 360) % 360;
    const disp = contentRectToDisplay(docPage.crop, W, H, totalRot);
    const dW = (totalRot === 90 || totalRot === 270) ? H : W;
    const dH = (totalRot === 90 || totalRot === 270) ? W : H;

    const z = this._ctx.zoomScale;
    const canvas = this._ctx.ui.canvas;
    const ox = canvas.offsetLeft, oy = canvas.offsetTop;
    const vx = disp.x * z + ox, vy = disp.y * z + oy;
    const vw = disp.width * z, vh = disp.height * z;
    const pageW = dW * z, pageH = dH * z;

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.id = 'cropFrameOverlay';
    Object.assign(svg.style, {
      position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
      pointerEvents: 'none', overflow: 'visible', zIndex: '9',
    });
    const dim = (x: number, y: number, w: number, h: number): void => {
      if (w <= 0 || h <= 0) return;
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', String(x)); r.setAttribute('y', String(y));
      r.setAttribute('width', String(w)); r.setAttribute('height', String(h));
      r.setAttribute('fill', 'rgba(0,0,0,0.4)');
      svg.appendChild(r);
    };
    dim(ox, oy, pageW, vy - oy);                       // top margin
    dim(ox, vy + vh, pageW, oy + pageH - (vy + vh));   // bottom margin
    dim(ox, vy, vx - ox, vh);                          // left margin
    dim(vx + vw, vy, ox + pageW - (vx + vw), vh);      // right margin
    const outline = document.createElementNS(ns, 'rect');
    outline.setAttribute('x', String(vx)); outline.setAttribute('y', String(vy));
    outline.setAttribute('width', String(vw)); outline.setAttribute('height', String(vh));
    outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke', '#2563eb');
    outline.setAttribute('stroke-width', '1.5');
    outline.setAttribute('stroke-dasharray', '5,3');
    // Marked so tests (and the QA driver) can address the frame itself rather than guessing at a
    // child index — the grips appended below are also <rect>.
    outline.setAttribute('data-crop-outline', '');
    svg.appendChild(outline);

    // ── resize grips (#G23 v1c) ────────────────────────────────────────────────────────────────────
    // The SVG is pointer-events:none so it never intercepts drawing; each grip re-enables events for
    // itself only. The drag updates the outline and the dimmed bands live (visual only) and commits ONE
    // undoable crop on pointerup, through the same `cropPage` the drawn path uses.
    const GRIP = 9;
    const pageId = docPage.id;
    const commit = this._ctx.commitCropRect.bind(this._ctx);
    // Work in DISPLAY units and convert to viewport px only when drawing, so the rect handed to
    // cropPage needs no inverse transform.
    let live = { x: disp.x, y: disp.y, width: disp.width, height: disp.height };

    const paint = (): void => {
      const px = live.x * z + ox, py = live.y * z + oy;
      const pw = live.width * z, ph = live.height * z;
      outline.setAttribute('x', String(px)); outline.setAttribute('y', String(py));
      outline.setAttribute('width', String(pw)); outline.setAttribute('height', String(ph));
      // Re-lay the four dim bands (children 0..3, in the order appended above).
      const bands: [number, number, number, number][] = [
        [ox, oy, pageW, py - oy],
        [ox, py + ph, pageW, oy + pageH - (py + ph)],
        [ox, py, px - ox, ph],
        [px + pw, py, ox + pageW - (px + pw), ph],
      ];
      const rects = svg.querySelectorAll('rect');
      bands.forEach((b, i) => {
        const r = rects[i];
        if (!r) return;
        r.setAttribute('x', String(b[0])); r.setAttribute('y', String(b[1]));
        r.setAttribute('width', String(Math.max(0, b[2]))); r.setAttribute('height', String(Math.max(0, b[3])));
      });
      for (const h of CROP_HANDLES) {
        const g = svg.querySelector(`[data-crop-handle="${h}"]`);
        if (!g) continue;
        const pos = handlePositions(live);
        g.setAttribute('x', String(pos[h].x * z + ox - GRIP / 2));
        g.setAttribute('y', String(pos[h].y * z + oy - GRIP / 2));
      }
    };

    for (const h of CROP_HANDLES) {
      const pos = handlePositions(live)[h];
      const g = document.createElementNS(ns, 'rect');
      g.setAttribute('data-crop-handle', h);
      g.setAttribute('x', String(pos.x * z + ox - GRIP / 2));
      g.setAttribute('y', String(pos.y * z + oy - GRIP / 2));
      g.setAttribute('width', String(GRIP));
      g.setAttribute('height', String(GRIP));
      g.setAttribute('fill', '#ffffff');
      g.setAttribute('stroke', '#2563eb');
      g.setAttribute('stroke-width', '1.5');
      Object.assign((g as unknown as SVGElement & { style: CSSStyleDeclaration }).style, {
        pointerEvents: 'all', cursor: handleCursor(h), touchAction: 'none',
      });
      g.addEventListener('pointerdown', (ev: Event) => {
        const pe = ev as PointerEvent;
        pe.preventDefault();
        pe.stopPropagation();          // never let a grip drag start a new crop rectangle
        const start = { x: pe.clientX, y: pe.clientY };
        const from = { ...live };
        const onMove = (m: PointerEvent): void => {
          // Deltas are viewport px; divide by zoom to get display units.
          live = resizeDisplayRect(from, h, (m.clientX - start.x) / z, (m.clientY - start.y) / z, dW, dH);
          paint();
        };
        const onUp = (): void => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          // A grip press with no movement must not push an undo entry for nothing.
          const moved = live.x !== from.x || live.y !== from.y
            || live.width !== from.width || live.height !== from.height;
          if (moved) commit(pageId, { ...live });
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
      svg.appendChild(g);
    }

    container.appendChild(svg);
  }

  private async _renderTextLayer(myGen: number): Promise<void> {
    const docPage = this._ctx.documentModel.currentPage;
    if (!docPage) { this._ctx.textLayerManager.clear(); return; }
    if (docPage.sourcePdfId === 'blank') { this._ctx.textLayerManager.clear(); return; }
    const src = this._ctx.documentModel.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return;
    const page = await src.doc.getPage(docPage.sourcePageNum);
    if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
    const effectiveRotation = ((page.rotate + (docPage.rotation ?? 0)) % 360 + 360) % 360;
    const viewport = page.getViewport({ scale: this._ctx.zoomScale, rotation: effectiveRotation });
    const canvasOffset = { left: this._ctx.ui.canvas.offsetLeft, top: this._ctx.ui.canvas.offsetTop };
    await this._ctx.textLayerManager.render(page, viewport, canvasOffset);
    if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
    this._ctx.textLayerManager.setPointerEvents(this._ctx.mode === 'select');
  }

  private async _renderFormFields(myGen: number): Promise<void> {
    const docPage = this._ctx.documentModel.currentPage;
    if (!docPage) { this._ctx.formFieldOverlay.clear(); return; }
    if (docPage.sourcePdfId === 'blank') { this._ctx.formFieldOverlay.clear(); return; }
    const src = this._ctx.documentModel.sourcePdfs.get(docPage.sourcePdfId);
    if (!src) return;
    const page = await src.doc.getPage(docPage.sourcePageNum);
    if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
    const effectiveRotation = ((page.rotate + (docPage.rotation ?? 0)) % 360 + 360) % 360;
    const viewport = page.getViewport({ scale: this._ctx.zoomScale, rotation: effectiveRotation });
    const canvasOffset = { left: this._ctx.ui.canvas.offsetLeft, top: this._ctx.ui.canvas.offsetTop };
    const values = this._ctx.getFormValues(docPage.sourcePdfId);
    const { unsupportedCount } = await this._ctx.formFieldOverlay.render(
      page, viewport, canvasOffset, values,
      (fieldName, value) => {
        // #QA-2026-06-23 P1 — route through the debounced, undoable form-fill path
        // (sets the value live + autosaves on flush) instead of a direct mutation.
        this._ctx.handleFormInput(docPage.sourcePdfId, fieldName, value);
      }
    );
    if (!this._ctx.isCurrentFormFieldGen(myGen)) return;
    if (unsupportedCount > 0 && !this._ctx.getWarnedUnsupportedFields()) {
      this._ctx.setWarnedUnsupportedFields(true);
      this._ctx.reportError.warn('toast.unsupportedFields', { count: unsupportedCount });
    }
    this._ctx.formFieldOverlay.setPointerEvents(this._ctx.mode === 'select');
  }
}
