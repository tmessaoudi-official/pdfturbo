import type { IAppContext } from '../core/appContext';
import type { PDFElement } from '../elements/annotationElement';
import { ShapeElement } from '../elements/shapeElement';
import { BulkDeleteCmd, SplitStrokeCmd, MacroCmd, type Command } from '../core/historyManager';
import { bboxIntersectsPolyline, splitFreehandAtErase, type Point } from '../utils/eraserGeometry';

/** Eraser half-width in element space — matches the 10-unit preview stroke. */
const ERASE_VISUAL_RADIUS = 5;

export class EraserHandler {
  private _drawing = false;
  private _points: Point[] = [];
  private _previewSvg: SVGSVGElement | null = null;
  private _activePointerId: number | null = null;

  constructor(private app: IAppContext) {}

  cancel(): void {
    if (this._previewSvg) { this._previewSvg.remove(); this._previewSvg = null; }
    this._drawing = false;
    this._points = [];
    this._activePointerId = null;
  }

  handlePointerDown(e: PointerEvent): void {
    if (this.app.mode !== 'drawErase') return;
    if (this._previewSvg) { this._previewSvg.remove(); this._previewSvg = null; }

    const rect = this.app.ui.canvas.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top  || e.clientY > rect.bottom) return;

    const x = (e.clientX - rect.left) / this.app.zoomScale;
    const y = (e.clientY - rect.top)  / this.app.zoomScale;
    this._drawing = true;
    this._activePointerId = e.pointerId;
    this._points = [{ x, y }];

    this._previewSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this._previewSvg.id = 'eraserPreview';
    Object.assign(this._previewSvg.style, {
      position: 'absolute', top: '0', left: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none', overflow: 'visible', zIndex: '11'
    });
    this.app.ui.container.appendChild(this._previewSvg);
    e.preventDefault();
  }

  handlePointerMove(e: PointerEvent): void {
    if (!this._drawing || e.pointerId !== this._activePointerId) return;
    const rect = this.app.ui.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.app.zoomScale;
    const y = (e.clientY - rect.top)  / this.app.zoomScale;
    const last = this._points[this._points.length - 1];
    if (Math.hypot(x - last.x, y - last.y) > 3 / this.app.zoomScale) {
      this._points.push({ x, y });
    }
    this._updatePreview();
  }

  handlePointerUp(e: PointerEvent): void {
    if (!this._drawing || e.pointerId !== this._activePointerId) return;
    this._drawing = false;
    this._activePointerId = null;
    if (this._previewSvg) { this._previewSvg.remove(); this._previewSvg = null; }

    if (this._points.length < 2) { this._points = []; return; }

    const erasePoints = this._points;
    this._points = [];
    this._applyErase(erasePoints);
  }

  private _applyErase(erasePoints: Point[]): void {
    const pageId = this.app.documentModel.currentPage?.id;
    if (!pageId) return;

    const pageElements = this.app.elements.filter(el => el.pageId === pageId);
    const eraseBbox = this._polylineBbox(erasePoints);

    const toDelete: PDFElement[] = [];
    const splits: Array<{ original: ShapeElement; replacements: ShapeElement[] }> = [];

    for (const el of pageElements) {
      if ((el as ShapeElement).shapeType === 'freehand') {
        const s = el as ShapeElement;
        if (s.points.length < 2) { toDelete.push(el); continue; }

        // Effective radius = the visible eraser half-width plus the target
        // stroke's own half-width, so a thick stroke is cut when the eraser
        // touches its edge (not only its centreline).
        const radius = ERASE_VISUAL_RADIUS + (s.strokeWidth ?? 0) / 2;
        const surviving = splitFreehandAtErase(s.points, erasePoints, radius);
        if (surviving.length === 0) {
          toDelete.push(el);
        } else if (surviving.length === 1 && surviving[0].length === s.points.length) {
          // unchanged
        } else {
          const pageId2 = el.pageId;
          const opts = { strokeColor: s.strokeColor, strokeWidth: s.strokeWidth };
          const replacements = surviving.map(pts => {
            const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
            const x = Math.min(...xs), y = Math.min(...ys);
            const w = Math.max(...xs) - x, h = Math.max(...ys) - y;
            return new ShapeElement('freehand', x, y, Math.max(1, w), Math.max(1, h), pageId2, { ...opts, points: pts });
          });
          splits.push({ original: s, replacements });
        }
      } else {
        // For non-freehand elements, delete if erase stroke intersects their bounding box
        const elBbox = { x: el.x, y: el.y, w: el.width, h: el.height };
        // Quick bbox-vs-bbox check first
        if (eraseBbox.x < elBbox.x + elBbox.w && eraseBbox.x + eraseBbox.w > elBbox.x &&
            eraseBbox.y < elBbox.y + elBbox.h && eraseBbox.y + eraseBbox.h > elBbox.y) {
          if (bboxIntersectsPolyline(elBbox, erasePoints)) {
            toDelete.push(el);
          }
        }
      }
    }

    if (toDelete.length === 0 && splits.length === 0) return;

    const cmds: Command[] = [];
    if (toDelete.length > 0) cmds.push(new BulkDeleteCmd(this.app.elements, toDelete));
    for (const { original, replacements } of splits) {
      cmds.push(new SplitStrokeCmd(this.app.elements, original, replacements));
    }
    this.app.historyManager.execute(new MacroCmd(cmds));

    this.app.autosave();
    this.app.rebuildElementLayer();
  }

  private _updatePreview(): void {
    if (!this._previewSvg || this._points.length < 2) return;
    while (this._previewSvg.firstChild) this._previewSvg.firstChild.remove();

    const s = this.app.zoomScale;
    const ox = this.app.ui.canvas.offsetLeft;
    const oy = this.app.ui.canvas.offsetTop;
    const pts = this._points.map(p => `${p.x * s + ox},${p.y * s + oy}`).join(' ');

    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    pl.setAttribute('points', pts);
    pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', 'rgba(220,38,38,0.7)');
    pl.setAttribute('stroke-width', String(10 * s));
    pl.setAttribute('stroke-linecap', 'round');
    pl.setAttribute('stroke-linejoin', 'round');
    pl.setAttribute('stroke-dasharray', `${6 * s},${3 * s}`);
    this._previewSvg.appendChild(pl);
  }

  private _polylineBbox(pts: Point[]): { x: number; y: number; w: number; h: number } {
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
}
