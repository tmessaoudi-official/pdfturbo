import { PDFElement, type ElementJSON } from './annotationElement';

export class SignatureElement extends PDFElement {
  data: string;

  constructor(x: number, y: number, pageId: string, signatureData: string, options: { width?: number; height?: number } = {}) {
    super('signature', x, y, options.width ?? 200, options.height ?? 80, pageId);
    this.data = signatureData;
  }

  render(_container: HTMLElement, canvasOffset: { left: number; top: number }, scale = 1): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'pdf-element signature-element';
    div.dataset.id = String(this.id);
    this.applyStyles(div, canvasOffset, scale);
    div.style.backgroundImage = `url(${this.data})`;
    div.style.backgroundSize = 'contain';
    div.style.backgroundRepeat = 'no-repeat';
    div.style.backgroundPosition = 'center';
    div.appendChild(this.createRotationHandle());
    div.appendChild(this.createControls());
    div.appendChild(this.createResizeHandle());
    return div;
  }

  applyStyles(div: HTMLDivElement, canvasOffset: { left: number; top: number }, scale = 1): void {
    div.style.left = (canvasOffset.left + this.x * scale) + 'px';
    div.style.top = (canvasOffset.top + this.y * scale) + 'px';
    div.style.width = (this.width * scale) + 'px';
    div.style.height = (this.height * scale) + 'px';
  }

  override toJSON(): ElementJSON {
    return { ...super.toJSON(), data: this.data };
  }
}
