import type { IAppContext } from '../core/appContext';
import { ShapeElement } from '../elements/shapeElement';
import { HighlightElement } from '../elements/highlightElement';
import { RedactionElement } from '../elements/redactionElement';
import { AddElementCmd } from '../core/historyManager';

export class DrawingHandler {
  private _drawing = false;
  private _drawStart: { x: number; y: number } | null = null;
  private _drawPoints: Array<{ x: number; y: number }> = [];
  private _previewSvg: SVGSVGElement | null = null;
  private _activeDrawPointerId: number | null = null;
  private _pinchPointers: Map<number, { x: number; y: number }> = new Map();
  private _pinchStartDist: number | null = null;
  private _pinchStartZoom: number | null = null;
  private _lastPinchDist: number | null = null;
  private _pinchCentroidDoc: { x: number; y: number } | null = null;
  private _pinchCentroidViewport: { x: number; y: number } | null = null;

  constructor(private app: IAppContext) {}

  cancel(): void {
    if (this._previewSvg) { this._previewSvg.remove(); this._previewSvg = null; }
    this._drawing = false;
    this._drawStart = null;
    this._drawPoints = [];
    this._activeDrawPointerId = null;
  }

  handlePointerDown(e: PointerEvent): void {
    if (!this.app.documentModel.currentPage) return;

    this._pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pinchPointers.size >= 2) {
      this.cancel();
      if (this._previewSvg) { this._previewSvg.remove(); this._previewSvg = null; }
      this._pinchStartDist = this._getPinchDist();
      this._pinchStartZoom = this.app.zoomScale;
      this._lastPinchDist  = this._pinchStartDist;

      const pts = [...this._pinchPointers.values()];
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      this._pinchCentroidViewport = { x: cx, y: cy };
      const container = this.app.ui.container;
      const cRect = container.getBoundingClientRect();
      const canvas = this.app.ui.canvas;
      this._pinchCentroidDoc = {
        x: (cx - cRect.left + container.scrollLeft - canvas.offsetLeft) / this.app.zoomScale,
        y: (cy - cRect.top  + container.scrollTop  - canvas.offsetTop)  / this.app.zoomScale,
      };

      e.preventDefault();
      return;
    }

    if (!this.app.mode.startsWith('draw') && this.app.mode !== 'addText' && this.app.mode !== 'addImage' && this.app.mode !== 'addComment' && this.app.mode !== 'addSignature' && this.app.mode !== 'addCode') return;
    if (this.app.mode === 'drawFreehand') return; // handled by InkLayerHandler
    if (this._previewSvg) { this._previewSvg.remove(); this._previewSvg = null; }

    const rect = this.app.ui.canvas.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top  || e.clientY > rect.bottom) return;

    const x = (e.clientX - rect.left) / this.app.zoomScale;
    const y = (e.clientY - rect.top)  / this.app.zoomScale;
    this._drawing             = true;
    this._activeDrawPointerId = e.pointerId;
    this._drawStart           = { x, y };
    this._drawPoints          = [{ x, y }];

    this._previewSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this._previewSvg.id = 'drawPreview';
    Object.assign(this._previewSvg.style, {
      position: 'absolute', top: '0', left: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none', overflow: 'visible', zIndex: '10'
    });
    this.app.ui.container.appendChild(this._previewSvg);
    e.preventDefault();
  }

  handlePointerMove(e: PointerEvent): void {
    if (this._pinchPointers.has(e.pointerId)) {
      this._pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (this._pinchPointers.size >= 2 && this._pinchStartDist) {
      const dist = this._getPinchDist();
      this._lastPinchDist = dist;
      const ratio = dist / this._pinchStartDist;

      if (this._pinchCentroidDoc) {
        const canvas = this.app.ui.canvas;
        const tlX = this._pinchCentroidDoc.x * this.app.zoomScale;
        const tlY = this._pinchCentroidDoc.y * this.app.zoomScale;
        canvas.style.transformOrigin = `${tlX}px ${tlY}px`;
      } else {
        this.app.ui.canvas.style.transformOrigin = 'center center';
      }
      this.app.ui.canvas.style.transform = `scale(${ratio})`;
      return;
    }

    if (!this._drawing || !this._drawStart) return;
    if (e.pointerId !== this._activeDrawPointerId) return;

    const rect = this.app.ui.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.app.zoomScale;
    const y = (e.clientY - rect.top)  / this.app.zoomScale;

    if (this.app.mode === 'drawFreehand') {
      const last = this._drawPoints[this._drawPoints.length - 1];
      const dist = Math.hypot((x - last.x) * this.app.zoomScale, (y - last.y) * this.app.zoomScale);
      if (dist > 3) this._drawPoints.push({ x, y });
    }
    this._updatePreview(x, y);
  }

  async handlePointerUp(e: PointerEvent): Promise<void> {
    this._pinchPointers.delete(e.pointerId);

    if (this._pinchStartDist !== null && this._pinchStartZoom !== null && this._pinchPointers.size < 2) {
      const finalDist = this._lastPinchDist ?? this._pinchStartDist;
      const newScale = this._pinchStartZoom * finalDist / this._pinchStartDist;
      const centroidDoc = this._pinchCentroidDoc;
      const centroidViewport = this._pinchCentroidViewport;

      this.app.ui.canvas.style.transform       = '';
      this.app.ui.canvas.style.transformOrigin = '';
      this._pinchStartDist = null;
      this._pinchStartZoom = null;
      this._lastPinchDist  = null;
      this._pinchCentroidDoc = null;
      this._pinchCentroidViewport = null;

      try {
        await this.app.applyZoom(newScale);
      } catch (err) {
        console.error('[DrawingHandler] applyZoom failed:', err);
        return;
      }

      // Guard: skip correction if a new pinch began during the await
      if (!this._pinchStartDist && centroidDoc && centroidViewport) {
        const container = this.app.ui.container;
        const cRect = container.getBoundingClientRect();
        const canvas = this.app.ui.canvas;
        container.scrollLeft = centroidDoc.x * this.app.zoomScale + canvas.offsetLeft
                               - (centroidViewport.x - cRect.left);
        container.scrollTop  = centroidDoc.y * this.app.zoomScale + canvas.offsetTop
                               - (centroidViewport.y - cRect.top);
      }
      return;
    }

    if (!this._drawing) return;
    if (e.pointerId !== this._activeDrawPointerId) return;
    this._drawing             = false;
    this._activeDrawPointerId = null;

    if (this._previewSvg) { this._previewSvg.remove(); this._previewSvg = null; }

    const rect = this.app.ui.canvas.getBoundingClientRect();
    const endX = (e.clientX - rect.left) / this.app.zoomScale;
    const endY = (e.clientY - rect.top)  / this.app.zoomScale;
    const col    = this.app.ui.colorInput.value;
    const sw     = parseInt(this.app.ui.shapeWidth.value, 10) || 2;
    const opts   = { strokeColor: col, strokeWidth: sw };
    const start  = this._drawStart;
    const pageId = this.app.documentModel.currentPage?.id ?? '';
    let shape: ShapeElement | null = null;

    if (!start || !pageId) { this._drawPoints = []; return; }

    if (this.app.mode === 'drawArrow') {
      const x = Math.min(start.x, endX);
      const y = Math.min(start.y, endY);
      const w = Math.abs(endX - start.x);
      const h = Math.abs(endY - start.y);
      if (w < 5 && h < 5) { this._drawStart = null; this._drawPoints = []; return; }
      shape = new ShapeElement('arrow', x, y, w, h, pageId, {
        ...opts, x1: start.x, y1: start.y, x2: endX, y2: endY
      });

    } else if (this.app.mode === 'drawRect' || this.app.mode === 'drawEllipse') {
      const st = this.app.mode === 'drawRect' ? 'rect' : 'ellipse';
      const x = Math.min(start.x, endX);
      const y = Math.min(start.y, endY);
      const w = Math.abs(endX - start.x);
      const h = Math.abs(endY - start.y);
      if (w < 5 && h < 5) { this._drawStart = null; this._drawPoints = []; return; }
      const fillC = this.app.effectiveFillColor;
      shape = new ShapeElement(st as 'rect' | 'ellipse', x, y, w, h, pageId, { ...opts, fillColor: fillC });

    } else if (this.app.mode === 'drawHighlight') {
      const x = Math.min(start.x, endX);
      const y = Math.min(start.y, endY);
      const w = Math.abs(endX - start.x);
      const h = Math.abs(endY - start.y);
      if (w < 5 && h < 5) { this._drawStart = null; this._drawPoints = []; return; }
      const hlEl = new HighlightElement(x, y, w, h, pageId);
      this._drawStart = null;
      this._drawPoints = [];
      this.app.historyManager.execute(new AddElementCmd(this.app.elements, hlEl));
      this.app._autosave();
      this.app.setMode('select');
      this.app.selectElement(hlEl);
      return;

    } else if (this.app.mode === 'drawFreehand') {
      this._drawPoints.push({ x: endX, y: endY });
      if (this._drawPoints.length < 2) { this._drawStart = null; this._drawPoints = []; return; }
      const xs = this._drawPoints.map(p => p.x);
      const ys = this._drawPoints.map(p => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      const w = Math.max(...xs) - x, h = Math.max(...ys) - y;
      if (w < 5 && h < 5) { this._drawStart = null; this._drawPoints = []; return; }
      const fillC = this.app.effectiveFillColor;
      shape = new ShapeElement('freehand', x, y, w, h, pageId,
        { ...opts, fillColor: fillC, points: [...this._drawPoints] });

    } else if (this.app.mode === 'drawRedaction') {
      const x = Math.min(start.x, endX);
      const y = Math.min(start.y, endY);
      const w = Math.abs(endX - start.x);
      const h = Math.abs(endY - start.y);
      if (w < 5 && h < 5) { this._drawStart = null; this._drawPoints = []; return; }
      const redEl = new RedactionElement(x, y, w, h, pageId, this.app.ui.colorInput.value);
      this._drawStart = null;
      this._drawPoints = [];
      this.app.historyManager.execute(new AddElementCmd(this.app.elements, redEl));
      this.app._autosave();
      this.app.setMode('select');
      this.app.selectElement(redEl);
      return;

    } else if (this.app.mode === 'addText' || this.app.mode === 'addImage' || this.app.mode === 'addComment' || this.app.mode === 'addSignature' || this.app.mode === 'addCode') {
      const x = Math.min(start.x, endX);
      const y = Math.min(start.y, endY);
      const w = Math.abs(endX - start.x);
      const h = Math.abs(endY - start.y);
      this._drawStart  = null;
      this._drawPoints = [];
      this.app._commitPlacement(this.app.mode as 'addText' | 'addImage' | 'addComment' | 'addSignature' | 'addCode', x, y, w, h);
      return;
    }

    this._drawStart  = null;
    this._drawPoints = [];

    if (shape) {
      this.app.historyManager.execute(new AddElementCmd(this.app.elements, shape));
      this.app._autosave();
      if (this.app.mode === 'drawFreehand') {
        this.app.selectedElement = null;
        this.app.rebuildElementLayer();
      } else {
        this.app.setMode('select');
        this.app.selectElement(shape);
      }
    }
  }

  handlePointerCancel(e: PointerEvent): void {
    this._pinchPointers.delete(e.pointerId);
    // BUG-32: clear ALL pointer state to prevent stale entry triggering pinch on next touch
    this._pinchPointers.clear();
    this.cancel();

    this.app.ui.canvas.style.transform       = '';
    this.app.ui.canvas.style.transformOrigin = '';
    // Reset pinch state without applying zoom (pointer was cancelled, not lifted normally)
    this._pinchStartDist  = null;
    this._pinchStartZoom  = null;
    this._lastPinchDist   = null;
    this._pinchCentroidDoc = null;
    this._pinchCentroidViewport = null;
  }

  private _updatePreview(curX: number, curY: number): void {
    if (!this._previewSvg || !this._drawStart) return;
    while (this._previewSvg.firstChild) this._previewSvg.firstChild.remove();

    const s   = this.app.zoomScale;
    const ox  = this.app.ui.canvas.offsetLeft;
    const oy  = this.app.ui.canvas.offsetTop;
    const col = this.app.ui.colorInput.value;
    const sw  = (parseInt(this.app.ui.shapeWidth.value, 10) || 2) * s;

    const sx0 = this._drawStart.x * s + ox;
    const sy0 = this._drawStart.y * s + oy;
    const sxC = curX * s + ox;
    const syC = curY * s + oy;

    const ns = 'http://www.w3.org/2000/svg';

    const fillPreview = this.app.effectiveFillColor ?? 'none';
    if (this.app.mode === 'drawRect') {
      const el = document.createElementNS(ns, 'rect');
      el.setAttribute('x', String(Math.min(sx0, sxC)));
      el.setAttribute('y', String(Math.min(sy0, syC)));
      el.setAttribute('width', String(Math.abs(sxC - sx0)));
      el.setAttribute('height', String(Math.abs(syC - sy0)));
      el.setAttribute('fill', fillPreview);
      el.setAttribute('stroke', col);
      el.setAttribute('stroke-width', String(sw));
      this._previewSvg.appendChild(el);

    } else if (this.app.mode === 'drawEllipse') {
      const el = document.createElementNS(ns, 'ellipse');
      el.setAttribute('cx', String((sx0 + sxC) / 2));
      el.setAttribute('cy', String((sy0 + syC) / 2));
      el.setAttribute('rx', String(Math.abs(sxC - sx0) / 2));
      el.setAttribute('ry', String(Math.abs(syC - sy0) / 2));
      el.setAttribute('fill', fillPreview);
      el.setAttribute('stroke', col);
      el.setAttribute('stroke-width', String(sw));
      this._previewSvg.appendChild(el);

    } else if (this.app.mode === 'drawArrow') {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', String(sx0)); line.setAttribute('y1', String(sy0));
      line.setAttribute('x2', String(sxC)); line.setAttribute('y2', String(syC));
      line.setAttribute('stroke', col);
      line.setAttribute('stroke-width', String(sw));
      line.setAttribute('stroke-linecap', 'round');
      this._previewSvg.appendChild(line);

      const headLen = Math.max(8, sw * 4);
      const angle = Math.atan2(syC - sy0, sxC - sx0);
      const pts = [
        `${sxC},${syC}`,
        `${sxC + headLen * Math.cos(angle + Math.PI * 0.8)},${syC + headLen * Math.sin(angle + Math.PI * 0.8)}`,
        `${sxC + headLen * Math.cos(angle - Math.PI * 0.8)},${syC + headLen * Math.sin(angle - Math.PI * 0.8)}`,
      ].join(' ');
      const head = document.createElementNS(ns, 'polygon');
      head.setAttribute('points', pts);
      head.setAttribute('fill', col);
      head.setAttribute('stroke', 'none');
      this._previewSvg.appendChild(head);

    } else if (this.app.mode === 'drawHighlight') {
      const el = document.createElementNS(ns, 'rect');
      el.setAttribute('x', String(Math.min(sx0, sxC)));
      el.setAttribute('y', String(Math.min(sy0, syC)));
      el.setAttribute('width', String(Math.abs(sxC - sx0)));
      el.setAttribute('height', String(Math.abs(syC - sy0)));
      el.setAttribute('fill', 'rgba(255,220,0,0.35)');
      el.setAttribute('stroke', '#e5a000');
      el.setAttribute('stroke-width', '1');
      this._previewSvg.appendChild(el);

    } else if (this.app.mode === 'drawFreehand') {
      if (this._drawPoints.length < 2) return;
      const pts = this._drawPoints.map(p => `${p.x * s + ox},${p.y * s + oy}`).join(' ');
      const pl = document.createElementNS(ns, 'polyline');
      pl.setAttribute('points', pts);
      pl.setAttribute('fill', fillPreview);
      pl.setAttribute('stroke', col);
      pl.setAttribute('stroke-width', String(sw));
      pl.setAttribute('stroke-linecap', 'round');
      pl.setAttribute('stroke-linejoin', 'round');
      this._previewSvg.appendChild(pl);

    } else if (this.app.mode === 'drawRedaction') {
      const el = document.createElementNS(ns, 'rect');
      el.setAttribute('x', String(Math.min(sx0, sxC)));
      el.setAttribute('y', String(Math.min(sy0, syC)));
      el.setAttribute('width', String(Math.abs(sxC - sx0)));
      el.setAttribute('height', String(Math.abs(syC - sy0)));
      el.setAttribute('fill', this.app.ui.colorInput.value);
      el.setAttribute('fill-opacity', '0.8');
      el.setAttribute('stroke', '#c00');
      el.setAttribute('stroke-width', '2');
      el.setAttribute('stroke-dasharray', '6,3');
      this._previewSvg.appendChild(el);

    } else if (this.app.mode === 'addText') {
      const el = document.createElementNS(ns, 'rect');
      el.setAttribute('x', String(Math.min(sx0, sxC)));
      el.setAttribute('y', String(Math.min(sy0, syC)));
      el.setAttribute('width', String(Math.abs(sxC - sx0)));
      el.setAttribute('height', String(Math.abs(syC - sy0)));
      el.setAttribute('fill', 'rgba(37,99,235,0.07)');
      el.setAttribute('stroke', '#2563eb');
      el.setAttribute('stroke-width', '1.5');
      el.setAttribute('stroke-dasharray', '6,3');
      this._previewSvg.appendChild(el);

    } else if (this.app.mode === 'addImage') {
      const el = document.createElementNS(ns, 'rect');
      el.setAttribute('x', String(Math.min(sx0, sxC)));
      el.setAttribute('y', String(Math.min(sy0, syC)));
      el.setAttribute('width', String(Math.abs(sxC - sx0)));
      el.setAttribute('height', String(Math.abs(syC - sy0)));
      el.setAttribute('fill', 'rgba(22,163,74,0.07)');
      el.setAttribute('stroke', '#16a34a');
      el.setAttribute('stroke-width', '1.5');
      el.setAttribute('stroke-dasharray', '6,3');
      this._previewSvg.appendChild(el);

    } else if (this.app.mode === 'addComment') {
      const el = document.createElementNS(ns, 'rect');
      el.setAttribute('x', String(Math.min(sx0, sxC)));
      el.setAttribute('y', String(Math.min(sy0, syC)));
      el.setAttribute('width', String(Math.abs(sxC - sx0)));
      el.setAttribute('height', String(Math.abs(syC - sy0)));
      el.setAttribute('fill', 'rgba(234,179,8,0.08)');
      el.setAttribute('stroke', '#ca8a04');
      el.setAttribute('stroke-width', '1.5');
      el.setAttribute('stroke-dasharray', '6,3');
      this._previewSvg.appendChild(el);

    } else if (this.app.mode === 'addSignature') {
      const el = document.createElementNS(ns, 'rect');
      el.setAttribute('x', String(Math.min(sx0, sxC)));
      el.setAttribute('y', String(Math.min(sy0, syC)));
      el.setAttribute('width', String(Math.abs(sxC - sx0)));
      el.setAttribute('height', String(Math.abs(syC - sy0)));
      el.setAttribute('fill', 'rgba(147,51,234,0.07)');
      el.setAttribute('stroke', '#9333ea');
      el.setAttribute('stroke-width', '1.5');
      el.setAttribute('stroke-dasharray', '6,3');
      this._previewSvg.appendChild(el);

    } else if (this.app.mode === 'addCode') {
      const el = document.createElementNS(ns, 'rect');
      el.setAttribute('x', String(Math.min(sx0, sxC)));
      el.setAttribute('y', String(Math.min(sy0, syC)));
      el.setAttribute('width', String(Math.abs(sxC - sx0)));
      el.setAttribute('height', String(Math.abs(syC - sy0)));
      el.setAttribute('fill', 'rgba(13,148,136,0.08)');
      el.setAttribute('stroke', '#0d9488');
      el.setAttribute('stroke-width', '1.5');
      el.setAttribute('stroke-dasharray', '6,3');
      this._previewSvg.appendChild(el);
    }
  }

  private _getPinchDist(): number {
    const pts = [...this._pinchPointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  }
}
