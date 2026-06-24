import type { IAppContext } from '../core/appContext';
import type { PDFElement } from '../elements/annotationElement';
import type { ShapeElement } from '../elements/shapeElement';
import { MoveResizeCmd, RotateElementCmd } from '../core/historyManager';

interface PendingTouchDrag {
  element: PDFElement;
  div: HTMLDivElement;
  offsetX: number;
  offsetY: number;
  startClientX: number;
  startClientY: number;
  pointerId: number;
}

export class InteractionHandler {
  private app: IAppContext;
  isDragging = false;
  isResizing = false;
  isRotating = false;
  currentElement: PDFElement | null = null;
  private _activePointerId: number | null = null;
  private offsetX = 0;
  private offsetY = 0;
  private startX = 0;
  private startY = 0;
  private startWidth = 0;
  private startHeight = 0;
  private _beforeState: Record<string, unknown> | null = null;
  private _pendingTouchDrag: PendingTouchDrag | null = null;
  private static readonly _DRAG_THRESHOLD = 5;
  private _rotCenterX = 0;
  private _rotCenterY = 0;
  private _rotStartAngle = 0;
  private _rotStartRotation = 0;

  constructor(app: IAppContext) {
    this.app = app;
  }

  private _captureState(el: PDFElement): Record<string, unknown> {
    const base = { x: el.x, y: el.y, width: el.width, height: el.height, rotation: el.rotation };
    if (el.type === 'shape') {
      const s = el as ShapeElement;
      if (s.shapeType === 'arrow') {
        return { ...base, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 };
      }
      if (s.shapeType === 'freehand') {
        return { ...base, points: s.points.map(p => ({ ...p })) };
      }
    }
    return base;
  }

  handlePointerDown(e: PointerEvent, element: PDFElement, div: HTMLDivElement): void {
    if ((e.target as HTMLElement).classList.contains('control-btn')) return;
    if ((e.target as HTMLElement).classList.contains('rotation-handle')) {
      this.startRotation(e, element, div);
    } else if ((e.target as HTMLElement).classList.contains('resize-handle')) {
      this.startResize(e, element);
    } else if ((e.target as HTMLElement).matches('input, textarea') && e.pointerType === 'touch') {
      // On touch, defer drag start until movement threshold so tap-to-edit still works
      const divRect = div.getBoundingClientRect();
      this._pendingTouchDrag = {
        element, div,
        offsetX: e.clientX - divRect.left,
        offsetY: e.clientY - divRect.top,
        startClientX: e.clientX,
        startClientY: e.clientY,
        pointerId: e.pointerId
      };
    } else if (!(e.target as HTMLElement).matches('input, textarea')) {
      this.startDrag(e, element, div);
    }
  }

  private _commitTouchDrag(e: PointerEvent): void {
    const p = this._pendingTouchDrag;
    if (!p) return;
    this.isDragging = true;
    this.currentElement = p.element;
    this._activePointerId = p.pointerId;
    this._beforeState = this._captureState(p.element);
    this.offsetX = p.offsetX;
    this.offsetY = p.offsetY;
    try { p.div.setPointerCapture(p.pointerId); } catch { /* pointer already released */ }
    this._pendingTouchDrag = null;
    this.drag(e);
  }

  private startDrag(e: PointerEvent, element: PDFElement, div: HTMLDivElement): void {
    this.isDragging = true;
    this.currentElement = element;
    this._activePointerId = e.pointerId;
    this._beforeState = this._captureState(element);
    const divRect = div.getBoundingClientRect();
    this.offsetX = e.clientX - divRect.left;
    this.offsetY = e.clientY - divRect.top;
    try { div.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    e.preventDefault();
  }

  private startResize(e: PointerEvent, element: PDFElement): void {
    this.isResizing = true;
    this.currentElement = element;
    this._activePointerId = e.pointerId;
    this._beforeState = this._captureState(element);
    this.startX = e.clientX; this.startY = e.clientY;
    this.startWidth = element.width; this.startHeight = element.height;
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    e.preventDefault(); e.stopPropagation();
  }

  private startRotation(e: PointerEvent, element: PDFElement, div: HTMLDivElement): void {
    this.isRotating = true;
    this.currentElement = element;
    this._activePointerId = e.pointerId;
    this._beforeState = this._captureState(element);
    this._rotStartRotation = element.rotation;
    const rect = div.getBoundingClientRect();
    this._rotCenterX = rect.left + rect.width / 2;
    this._rotCenterY = rect.top + rect.height / 2;
    this._rotStartAngle = Math.atan2(e.clientY - this._rotCenterY, e.clientX - this._rotCenterX) * 180 / Math.PI;
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    e.preventDefault(); e.stopPropagation();
  }

  handlePointerMove(e: PointerEvent): void {
    if (this._pendingTouchDrag && e.pointerId === this._pendingTouchDrag.pointerId) {
      const dx = e.clientX - this._pendingTouchDrag.startClientX;
      const dy = e.clientY - this._pendingTouchDrag.startClientY;
      if (Math.hypot(dx, dy) > InteractionHandler._DRAG_THRESHOLD) this._commitTouchDrag(e);
      return;
    }
    if (e.pointerId !== this._activePointerId) return;
    if (this.isDragging && this.currentElement) this.drag(e);
    else if (this.isResizing && this.currentElement) this.resize(e);
    else if (this.isRotating && this.currentElement) this._rotate(e);
  }

  private drag(e: PointerEvent): void {
    const el = this.currentElement;
    if (!el) return;
    const canvas = this.app.renderer.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    const scale = this.app.zoomScale;
    const newX = (e.clientX - canvasRect.left - this.offsetX) / scale;
    const newY = (e.clientY - canvasRect.top - this.offsetY) / scale;
    const maxX = (canvas.width / scale) - el.width;
    const maxY = (canvas.height / scale) - el.height;
    const clampedX = Math.max(0, Math.min(maxX, newX));
    const clampedY = Math.max(0, Math.min(maxY, newY));
    const dx = clampedX - el.x;
    const dy = clampedY - el.y;
    el.x = clampedX;
    el.y = clampedY;

    const shape = el as ShapeElement;
    if (shape.type === 'shape') {
      if (shape.shapeType === 'arrow') {
        shape.x1 += dx; shape.y1 += dy; shape.x2 += dx; shape.y2 += dy;
      } else if (shape.shapeType === 'freehand') {
        shape.points = shape.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      }
    }
    this._applyLiveUpdate();
  }

  /**
   * Re-render ONLY the active element's node in place (not the whole layer) and
   * re-acquire pointer capture on the fresh node. Called on every drag/resize/
   * rotate move: avoids the O(n) DOM teardown that lagged on mobile, and — because
   * a full rebuild removes the captured node and releases capture mid-gesture —
   * keeps the capture held so the browser never reclaims the touch as a scroll.
   */
  private _applyLiveUpdate(): void {
    const el = this.currentElement;
    if (!el) return;
    const fresh = this.app.rerenderElement(el);
    if (!fresh) return;
    if (this._activePointerId !== null) {
      try { fresh.setPointerCapture(this._activePointerId); } catch { /* pointer already released */ }
    }
  }

  private resize(e: PointerEvent): void {
    const el = this.currentElement;
    if (!el) return;
    const canvas = this.app.renderer.canvas;
    const scale = this.app.zoomScale;
    const deltaX = (e.clientX - this.startX) / scale;
    const deltaY = (e.clientY - this.startY) / scale;
    const minW = 5, minH = 5;
    const maxW = (canvas.width  / scale) - el.x;
    const maxH = (canvas.height / scale) - el.y;
    if (e.shiftKey && this.startWidth > 0 && this.startHeight > 0) {
      const scaleX = Math.max(minW, this.startWidth  + deltaX) / this.startWidth;
      const scaleY = Math.max(minH, this.startHeight + deltaY) / this.startHeight;
      const s = Math.max(scaleX, scaleY);
      el.width  = Math.min(this.startWidth  * s, maxW);
      el.height = Math.min(this.startHeight * s, maxH);
    } else {
      el.width  = Math.min(Math.max(minW, this.startWidth  + deltaX), maxW);
      el.height = Math.min(Math.max(minH, this.startHeight + deltaY), maxH);
    }
    this._applyLiveUpdate();
  }

  handlePointerUp(e: PointerEvent): void {
    if (this._pendingTouchDrag && e.pointerId === this._pendingTouchDrag.pointerId) {
      this._pendingTouchDrag = null;
      return;
    }
    if (e.pointerId !== this._activePointerId) return;
    this._finish();
  }

  handlePointerCancel(e: PointerEvent): void {
    if (this._pendingTouchDrag && e.pointerId === this._pendingTouchDrag.pointerId) {
      this._pendingTouchDrag = null;
      return;
    }
    if (e.pointerId !== this._activePointerId) return;
    this._finish();
  }

  private _rotate(e: PointerEvent): void {
    const el = this.currentElement;
    if (!el) return;
    const angle = Math.atan2(e.clientY - this._rotCenterY, e.clientX - this._rotCenterX) * 180 / Math.PI;
    const delta = angle - this._rotStartAngle;
    let rot = ((this._rotStartRotation + delta) % 360 + 360) % 360;
    if (e.shiftKey)     rot = Math.round(rot / 45) * 45 % 360;
    else if (e.ctrlKey) rot = Math.round(rot / 5)  * 5  % 360;
    el.rotation = rot;
    this._applyLiveUpdate();
  }

  private _finish(): void {
    const wasDragging = this.isDragging;
    const wasResizing = this.isResizing;
    const wasRotating = this.isRotating;
    const movedEl = this.currentElement;
    const before = this._beforeState;
    this.isDragging = false; this.isResizing = false; this.isRotating = false;
    this.currentElement = null; this._activePointerId = null;
    this._beforeState = null;
    // Per-move updates re-rendered only the active node; do one full rebuild now to
    // reconcile the layer (z-order, selection state) after the gesture completes.
    if (wasDragging || wasResizing || wasRotating) this.app.rebuildElementLayer();

    if (wasRotating && movedEl && before) {
      const beforeRot = before['rotation'] as number;
      if (movedEl.rotation !== beforeRot) {
        this.app.historyManager.record(new RotateElementCmd(this.app.elements, movedEl, beforeRot, movedEl.rotation));
        this.app.autosave();
      }
      return;
    }

    if (movedEl && (wasDragging || wasResizing) && before) {
      const after = this._captureState(movedEl);
      const moved = (after['x'] !== before['x']) || (after['y'] !== before['y']);
      const resized = wasResizing && ((after['width'] !== before['width']) || (after['height'] !== before['height']));
      if (moved || resized) {
        this.app.historyManager.record(new MoveResizeCmd(this.app.elements, movedEl, before, after));
        this.app.autosave();
      }
    }
  }
}
