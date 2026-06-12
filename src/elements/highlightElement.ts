import { PDFElement, type ElementJSON } from './annotationElement';

export class HighlightElement extends PDFElement {
  color: string;
  opacity: number;

  constructor(x: number, y: number, width: number, height: number, pageId: string, color = '#FFFF00', opacity = 0.3) {
    super('highlight', x, y, width, height, pageId);
    this.color = color;
    this.opacity = opacity;
  }

  render(_container: HTMLElement, canvasOffset: { left: number; top: number }, scale: number): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'pdf-element highlight-element';
    div.dataset.id = String(this.id);

    const hex = this.color.replace(/^#/, '');
    const parseHexCh = (s: string): number => { const v = parseInt(s, 16); return isNaN(v) ? 0 : v; };
    const r = parseHexCh(hex.substring(0, 2));
    const g = parseHexCh(hex.substring(2, 4));
    const b = parseHexCh(hex.substring(4, 6));

    Object.assign(div.style, {
      position: 'absolute',
      left: `${canvasOffset.left + this.x * scale}px`,
      top: `${canvasOffset.top + this.y * scale}px`,
      width: `${this.width * scale}px`,
      height: `${this.height * scale}px`,
      background: `rgba(${r},${g},${b},${this.opacity})`,
      cursor: 'pointer',
      zIndex: '2',
    });

    div.appendChild(this.createRotationHandle());
    div.appendChild(this.createControls());
    div.appendChild(this.createResizeHandle());
    return div;
  }

  override toJSON(): ElementJSON {
    return { ...super.toJSON(), color: this.color, opacity: this.opacity };
  }
}
