import { PDFElement, type ElementJSON } from './annotationElement';

export type ShapeType = 'arrow' | 'rect' | 'ellipse' | 'freehand';

export interface ShapeOptions {
  strokeColor?: string;
  fillColor?: string;
  strokeWidth?: number;
  x1?: number; y1?: number;
  x2?: number; y2?: number;
  points?: Array<{ x: number; y: number }>;
}

export class ShapeElement extends PDFElement {
  shapeType: ShapeType;
  strokeColor: string;
  fillColor?: string;
  strokeWidth: number;
  x1: number; y1: number;
  x2: number; y2: number;
  points: Array<{ x: number; y: number }>;

  constructor(shapeType: ShapeType, x: number, y: number, width: number, height: number, pageId: string, options: ShapeOptions = {}) {
    super('shape', x, y, width, height, pageId);
    this.shapeType = shapeType;
    this.strokeColor = options.strokeColor ?? '#ef4444';
    this.fillColor = options.fillColor;
    this.strokeWidth = options.strokeWidth ?? 2;
    this.x1 = options.x1 ?? x;      this.y1 = options.y1 ?? y;
    this.x2 = options.x2 ?? x + width; this.y2 = options.y2 ?? y + height;
    this.points = options.points ?? [];
  }

  render(_container: HTMLElement, canvasOffset: { left: number; top: number }, scale = 1): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'pdf-element shape-element';
    if (this.shapeType === 'freehand') div.classList.add('freehand-element');
    div.dataset.id = String(this.id);
    this.applyStyles(div, canvasOffset, scale);

    const w = Math.max(1, this.width * scale);
    const h = Math.max(1, this.height * scale);
    const sw = this.strokeWidth * scale;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.style.overflow = 'visible';
    svg.style.position = 'absolute';
    svg.style.top = '0'; svg.style.left = '0';
    svg.style.pointerEvents = 'none';

    switch (this.shapeType) {
      case 'rect':     this._renderRect(svg, w, h, sw);     break;
      case 'ellipse':  this._renderEllipse(svg, w, h, sw);  break;
      case 'arrow':    this._renderArrow(svg, scale, sw);   break;
      case 'freehand': this._renderFreehand(svg, scale, sw); break;
    }

    div.appendChild(svg);
    div.appendChild(this.createRotationHandle());
    div.appendChild(this.createControls());
    if (this.shapeType !== 'freehand' && this.shapeType !== 'arrow') div.appendChild(this.createResizeHandle());
    return div;
  }

  private _renderRect(svg: SVGSVGElement, w: number, h: number, sw: number): void {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    el.setAttribute('x', String(sw / 2)); el.setAttribute('y', String(sw / 2));
    el.setAttribute('width', String(Math.max(1, w - sw)));
    el.setAttribute('height', String(Math.max(1, h - sw)));
    el.setAttribute('fill', this.fillColor ?? 'none');
    el.setAttribute('stroke', this.strokeColor);
    el.setAttribute('stroke-width', String(sw));
    svg.appendChild(el);
  }

  private _renderEllipse(svg: SVGSVGElement, w: number, h: number, sw: number): void {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    el.setAttribute('cx', String(w / 2)); el.setAttribute('cy', String(h / 2));
    el.setAttribute('rx', String(Math.max(1, w / 2 - sw / 2)));
    el.setAttribute('ry', String(Math.max(1, h / 2 - sw / 2)));
    el.setAttribute('fill', this.fillColor ?? 'none');
    el.setAttribute('stroke', this.strokeColor);
    el.setAttribute('stroke-width', String(sw));
    svg.appendChild(el);
  }

  private _renderArrow(svg: SVGSVGElement, scale: number, sw: number): void {
    const x1s = (this.x1 - this.x) * scale, y1s = (this.y1 - this.y) * scale;
    const x2s = (this.x2 - this.x) * scale, y2s = (this.y2 - this.y) * scale;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x1s)); line.setAttribute('y1', String(y1s));
    line.setAttribute('x2', String(x2s)); line.setAttribute('y2', String(y2s));
    line.setAttribute('stroke', this.strokeColor);
    line.setAttribute('stroke-width', String(sw));
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);

    const headLen = Math.max(8, sw * 4);
    const angle = Math.atan2(y2s - y1s, x2s - x1s);
    const pts = [
      `${x2s},${y2s}`,
      `${x2s + headLen * Math.cos(angle + Math.PI * 0.8)},${y2s + headLen * Math.sin(angle + Math.PI * 0.8)}`,
      `${x2s + headLen * Math.cos(angle - Math.PI * 0.8)},${y2s + headLen * Math.sin(angle - Math.PI * 0.8)}`,
    ].join(' ');
    const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    head.setAttribute('points', pts);
    head.setAttribute('fill', this.strokeColor);
    head.setAttribute('stroke', 'none');
    svg.appendChild(head);
  }

  private _renderFreehand(svg: SVGSVGElement, scale: number, sw: number): void {
    if (this.points.length < 2) return;
    const pts = this.points.map(p => `${(p.x - this.x) * scale},${(p.y - this.y) * scale}`).join(' ');
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    pl.setAttribute('points', pts);
    pl.setAttribute('fill', this.fillColor ?? 'none');
    pl.setAttribute('stroke', this.strokeColor);
    pl.setAttribute('stroke-width', String(sw));
    pl.setAttribute('stroke-linecap', 'round');
    pl.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(pl);
  }

  applyStyles(div: HTMLDivElement, canvasOffset: { left: number; top: number }, scale = 1): void {
    div.style.left   = (canvasOffset.left + this.x * scale) + 'px';
    div.style.top    = (canvasOffset.top  + this.y * scale) + 'px';
    div.style.width  = Math.max(1, this.width  * scale) + 'px';
    div.style.height = Math.max(1, this.height * scale) + 'px';
  }

  override toJSON(): ElementJSON {
    return { ...super.toJSON(), shapeType: this.shapeType, strokeColor: this.strokeColor,
      fillColor: this.fillColor, strokeWidth: this.strokeWidth,
      x1: this.x1, y1: this.y1, x2: this.x2, y2: this.y2, points: this.points };
  }
}
