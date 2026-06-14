import type { PDFElement } from '../elements/annotationElement';
import type { DocumentModel } from '../core/documentModel';
import type { InkLayer } from '../infra/inkLayer';
import type { AppDOMRefs } from './uiController';
import type { ToolMode } from '../types/tools';
import type { CodeElement } from '../elements/codeElement';
import type { TextElement } from '../elements/textElement';

export interface IElementLayerContext {
  readonly elements: PDFElement[];
  readonly documentModel: DocumentModel;
  readonly ui: AppDOMRefs;
  readonly inkLayer: InkLayer;
  readonly inkCanvas: HTMLCanvasElement;
  readonly zoomScale: number;
  readonly mode: ToolMode;
  readonly selectedElement: PDFElement | null;
  // Callbacks — keep business logic in the app, renderer just wires DOM
  handleElementPointerDown(e: PointerEvent, el: PDFElement, div: HTMLDivElement): void;
  handleElementClick(el: PDFElement): void;
  handleCodeElementEdit(el: CodeElement): void;
  handleTextInput(el: TextElement, input: HTMLInputElement | HTMLTextAreaElement): void;
}

export class ElementLayerRenderer {
  constructor(private readonly _ctx: IElementLayerContext) {}

  rebuildElementLayer(): void {
    this._ctx.ui.container.querySelectorAll('.pdf-element').forEach(el => el.remove());
    const currentPageId = this._ctx.documentModel.currentPage?.id;
    if (!currentPageId) return;
    const canvasOffset = {
      left: this._ctx.ui.canvas.offsetLeft,
      top:  this._ctx.ui.canvas.offsetTop,
    };
    const interactable = this._ctx.mode === 'select';
    this._ctx.elements
      .filter(el => el.pageId === currentPageId)
      .forEach(element => {
        const div = element.render(this._ctx.ui.container, canvasOffset, this._ctx.zoomScale);
        div.style.pointerEvents = interactable ? 'auto' : 'none';
        if (element.rotation) {
          div.style.transform = `rotate(${element.rotation}deg)`;
          div.style.transformOrigin = 'center center';
        }
        if (this._ctx.selectedElement?.id === element.id) div.classList.add('selected');
        div.addEventListener('click', e => { e.stopPropagation(); this._ctx.handleElementClick(element); });
        div.addEventListener('pointerdown', e => { this._ctx.handleElementPointerDown(e, element, div); });
        if (element.type === 'code') {
          div.addEventListener('code-element-edit', e => {
            const id = (e as CustomEvent<{ id: number }>).detail.id;
            const el = this._ctx.elements.find(x => x.id === id) as CodeElement | undefined;
            if (el) this._ctx.handleCodeElementEdit(el);
          });
        }
        if (element.type === 'text') {
          const input = div.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
          if (input) {
            const isSelected = this._ctx.selectedElement?.id === element.id;
            if (!isSelected) (input as HTMLElement).style.pointerEvents = 'none';
            input.addEventListener('input', () => {
              this._ctx.handleTextInput(element as TextElement, input);
            });
          }
        }
        this._ctx.ui.container.appendChild(div);
      });
  }

  renderInkLayer(): void {
    const canvas = this._ctx.ui.canvas;
    const ic = this._ctx.inkCanvas;
    ic.style.left   = canvas.offsetLeft + 'px';
    ic.style.top    = canvas.offsetTop  + 'px';
    ic.style.width  = canvas.offsetWidth  + 'px';
    ic.style.height = canvas.offsetHeight + 'px';
    if (ic.width !== canvas.width || ic.height !== canvas.height) {
      ic.width  = canvas.width;
      ic.height = canvas.height;
    }
    const pageId = this._ctx.documentModel.currentPage?.id ?? '';
    this._ctx.inkLayer.renderToCanvas(pageId, ic, this._ctx.zoomScale);
  }

  renderInkLayerWithLive(points: Array<{ x: number; y: number }>, type: 'ink' | 'erase'): void {
    this.renderInkLayer();
    if (points.length < 2) return;
    const ctx = this._ctx.inkCanvas.getContext('2d');
    if (!ctx) return;
    const sw = parseInt(this._ctx.ui.shapeWidth.value, 10) || 3;
    ctx.save();
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = (type === 'erase' ? Math.max(12, sw * 4) : sw) * this._ctx.zoomScale;
    if (type === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = this._ctx.ui.colorInput.value;
    }
    ctx.moveTo(points[0].x * this._ctx.zoomScale, points[0].y * this._ctx.zoomScale);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * this._ctx.zoomScale, points[i].y * this._ctx.zoomScale);
    }
    ctx.stroke();
    ctx.restore();
  }
}
