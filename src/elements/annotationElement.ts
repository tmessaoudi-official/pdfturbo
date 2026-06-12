import { t } from '../utils/i18n';

export type ElementType = 'text' | 'signature' | 'shape' | 'image' | 'highlight' | 'comment' | 'redaction' | 'code';

export interface ElementJSON {
  id: number;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  pageId: string;
  rotation?: number;
  [key: string]: unknown;
}

export abstract class PDFElement {
  static _nextId = 1;
  id: number;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  pageId: string;
  rotation = 0;

  constructor(type: ElementType, x: number, y: number, width: number, height: number, pageId: string) {
    this.id = PDFElement._nextId++;
    this.type = type;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.pageId = pageId;
  }

  createControls(): HTMLDivElement {
    const controls = document.createElement('div');
    controls.className = 'element-controls';
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'control-btn delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = t('element.deleteTitle');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteBtn.dispatchEvent(
        new CustomEvent<{ id: number }>('element:delete', {
          bubbles: true,
          composed: true,
          detail: { id: this.id },
        })
      );
    });
    controls.appendChild(deleteBtn);
    return controls;
  }

  createRotationHandle(): HTMLDivElement {
    const handle = document.createElement('div');
    handle.className = 'rotation-handle';
    handle.title = t('element.rotateTitle');
    handle.textContent = '↻';
    return handle;
  }

  createResizeHandle(): HTMLDivElement {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    return handle;
  }

  abstract render(container: HTMLElement, canvasOffset: { left: number; top: number }, scale: number): HTMLDivElement;

  toJSON(): ElementJSON {
    return { id: this.id, type: this.type, x: this.x, y: this.y, width: this.width, height: this.height, pageId: this.pageId, rotation: this.rotation };
  }
}

