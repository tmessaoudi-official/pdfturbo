import { PDFElement, type ElementJSON } from './annotationElement';

export class ImageElement extends PDFElement {
  src: string; // data URL (PNG, JPEG, WEBP, etc.)

  constructor(
    x: number,
    y: number,
    width: number,
    height: number,
    pageId: string,
    src: string,
  ) {
    super('image', x, y, width, height, pageId);
    this.src = src;
  }

  render(_container: HTMLElement, canvasOffset: { left: number; top: number }, scale = 1): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'pdf-element image-element';
    div.dataset.id = String(this.id);
    div.style.left   = (canvasOffset.left + this.x * scale) + 'px';
    div.style.top    = (canvasOffset.top  + this.y * scale) + 'px';
    div.style.width  = Math.max(10, this.width  * scale) + 'px';
    div.style.height = Math.max(10, this.height * scale) + 'px';
    div.style.position = 'absolute';
    div.style.cursor = 'move';
    div.style.userSelect = 'none';
    div.style.boxSizing = 'border-box';

    const img = document.createElement('img');
    img.src = this.src;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'fill';
    img.style.display = 'block';
    img.style.pointerEvents = 'none';
    img.draggable = false;

    div.appendChild(img);
    div.appendChild(this.createRotationHandle());
    div.appendChild(this.createControls());
    div.appendChild(this.createResizeHandle());
    return div;
  }

  override toJSON(): ElementJSON {
    return { ...super.toJSON(), src: this.src };
  }
}
