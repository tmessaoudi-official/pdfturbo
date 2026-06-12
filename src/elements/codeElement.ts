import { PDFElement, type ElementJSON } from './annotationElement';
import type { QRStyleOptions, BwipOptions } from '../utils/codeGenerator';

export interface CodeElementOptions {
  codeType: string;
  data: string;
  qrStyle?: QRStyleOptions | null;
  bwipOpts?: BwipOptions | null;
}

export class CodeElement extends PDFElement {
  codeType: string;
  data: string;
  qrStyle: QRStyleOptions | null;
  bwipOpts: BwipOptions | null;
  /** High-resolution PNG data URL generated once and reused for both DOM display and PDF export. */
  cachedDataUrl: string;

  constructor(
    x: number,
    y: number,
    pageId: string,
    opts: CodeElementOptions,
    cachedDataUrl: string,
    dims?: { w: number; h: number },
  ) {
    super('code', x, y, dims?.w ?? 200, dims?.h ?? 200, pageId);
    this.codeType = opts.codeType;
    this.data = opts.data;
    this.qrStyle = opts.qrStyle ?? null;
    this.bwipOpts = opts.bwipOpts ?? null;
    this.cachedDataUrl = cachedDataUrl;
  }

  render(_container: HTMLElement, canvasOffset: { left: number; top: number }, scale = 1): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'pdf-element code-element';
    div.dataset.id = String(this.id);
    div.style.left      = (canvasOffset.left + this.x * scale) + 'px';
    div.style.top       = (canvasOffset.top  + this.y * scale) + 'px';
    div.style.width     = Math.max(10, this.width  * scale) + 'px';
    div.style.height    = Math.max(10, this.height * scale) + 'px';
    div.style.position  = 'absolute';
    div.style.cursor    = 'move';
    div.style.userSelect  = 'none';
    div.style.boxSizing   = 'border-box';

    const img = document.createElement('img');
    img.src = this.cachedDataUrl;
    img.style.width   = '100%';
    img.style.height  = '100%';
    img.style.objectFit    = 'fill';
    img.style.display      = 'block';
    img.style.pointerEvents = 'none';
    img.draggable = false;

    div.appendChild(img);
    div.appendChild(this.createRotationHandle());
    div.appendChild(this.createControls());
    div.appendChild(this.createResizeHandle());

    // Double-click bubbles up to the canvas container; pdfEditorApp listens for this event.
    div.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      div.dispatchEvent(new CustomEvent('code-element-edit', { bubbles: true, detail: { id: this.id } }));
    });

    return div;
  }

  override toJSON(): ElementJSON {
    return {
      ...super.toJSON(),
      codeType: this.codeType,
      data: this.data,
      qrStyle: this.qrStyle,
      bwipOpts: this.bwipOpts,
      cachedDataUrl: this.cachedDataUrl,
    };
  }
}
