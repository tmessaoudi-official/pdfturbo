import type { IAppContext } from '../core/appContext';
import type { PDFElement } from '../elements/annotationElement';
import type { ShapeElement } from '../elements/shapeElement';
import { MoveResizeCmd, RotateElementCmd } from '../core/historyManager';

interface PendingDrag {
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
  private _pendingDrag: PendingDrag | null = null;
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
    const target = e.target as HTMLElement;
    if (target.classList.contains('control-btn')) return;
    // The grips have no click meaning, so they engage immediately — a press on one is
    // never anything but a resize/rotate.
    if (target.classList.contains('rotation-handle')) { this.startRotation(e, element, div); return; }
    if (target.classList.contains('resize-handle')) { this.startResize(e, element); return; }
    // A MOUSE press inside a text control is left entirely to the browser: that is what
    // keeps caret placement and drag-to-select-text working inside a focused text box.
    // (An unselected element's input is `pointer-events:none`, so this only applies once
    // the element is selected — see ElementLayerRenderer.)
    if (target.matches('input, textarea') && e.pointerType !== 'touch') return;
    // Everything else — the element body with any pointer type, and a touch on its text
    // control — DEFERS the drag until the pointer has actually moved.
    //
    // The threshold is load-bearing for more than ergonomics. Engaging a drag on the bare
    // pointerdown makes `_finish()` run `rebuildElementLayer()` on pointerup, which
    // destroys the node that received `mousedown`; a mouse `click` is only dispatched when
    // mousedown and mouseup share a live common ancestor, so the click was suppressed
    // outright and `handleElementClick` → `selectElement` never ran. An element that was
    // not already selected could then never be selected or edited with a mouse. Touch was
    // immune (its click survives the swap), which is exactly why this reached users as
    // "editing text works on mobile but not on desktop". Guarded by
    // tests/browser/element-click-select.browser.test.ts.
    const divRect = div.getBoundingClientRect();
    this._pendingDrag = {
      element, div,
      offsetX: e.clientX - divRect.left,
      offsetY: e.clientY - divRect.top,
      startClientX: e.clientX,
      startClientY: e.clientY,
      pointerId: e.pointerId
    };
  }

  private _commitDrag(e: PointerEvent): void {
    const p = this._pendingDrag;
    if (!p) return;
    this.isDragging = true;
    this.currentElement = p.element;
    this._activePointerId = p.pointerId;
    this._beforeState = this._captureState(p.element);
    this.offsetX = p.offsetX;
    this.offsetY = p.offsetY;
    try { p.div.setPointerCapture(p.pointerId); } catch { /* pointer already released */ }
    this._pendingDrag = null;
    this.drag(e);
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
    if (this._pendingDrag && e.pointerId === this._pendingDrag.pointerId) {
      const dx = e.clientX - this._pendingDrag.startClientX;
      const dy = e.clientY - this._pendingDrag.startClientY;
      if (Math.hypot(dx, dy) > InteractionHandler._DRAG_THRESHOLD) this._commitDrag(e);
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
    if (this._pendingDrag && e.pointerId === this._pendingDrag.pointerId) {
      this._pendingDrag = null;
      return;
    }
    if (e.pointerId !== this._activePointerId) return;
    this._finish();
  }

  handlePointerCancel(e: PointerEvent): void {
    if (this._pendingDrag && e.pointerId === this._pendingDrag.pointerId) {
      this._pendingDrag = null;
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
