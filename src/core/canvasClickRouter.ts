import type { PDFElement } from '../elements/annotationElement';
import type { DocumentModel } from './documentModel';
import type { AppDOMRefs } from '../ui/uiController';
import type { ToolMode } from '../types/tools';
import type { InkLayer } from '../infra/inkLayer';
import type { HistoryManager } from './historyManager';
import type { ShapeElement } from '../elements/shapeElement';
import { FillColorCmd, InkFillColorCmd } from './historyManager';
import { hitTestShape, ptSegDist, ptInPolygon } from '../utils/hitTest';

export interface ICanvasClickRouterContext {
  readonly documentModel: DocumentModel;
  readonly ui: AppDOMRefs;
  readonly zoomScale: number;
  readonly mode: ToolMode;
  readonly elements: PDFElement[];
  readonly inkLayer: InkLayer;
  readonly historyManager: HistoryManager;
  readonly effectiveFillColor: string | undefined;
  readonly currentSignature: string | null;
  consumeSkipNextClick(): boolean;
  hasPendingImageSrc(): boolean;
  isShapeMode(): boolean;
  handleTextEditClick(e: MouseEvent): void;
  selectElement(el: PDFElement | null): void;
  autosave(): void;
  rebuildElementLayer(): void;
  renderInkLayer(): void;
}

export class CanvasClickRouter {
  constructor(private readonly _ctx: ICanvasClickRouterContext) {}

  handleCanvasClick(e: MouseEvent): void {
    if (this._ctx.consumeSkipNextClick()) return;
    if (this._ctx.isShapeMode()) return;
    const m = this._ctx.mode;
    if (m === 'addText' || (m === 'addImage' && this._ctx.hasPendingImageSrc()) ||
        m === 'addComment' || (m === 'addSignature' && this._ctx.currentSignature) ||
        m === 'addCode') return;
    if (m === 'fillBucket') {
      this._handleFillBucketClick(e);
    } else if (m === 'editText') {
      this._ctx.handleTextEditClick(e);
    } else {
      this._ctx.selectElement(null);
    }
  }

  private _handleFillBucketClick(e: MouseEvent): void {
    const pageId = this._ctx.documentModel.currentPage?.id;
    if (!pageId) return;
    const rect = this._ctx.ui.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this._ctx.zoomScale;
    const y = (e.clientY - rect.top) / this._ctx.zoomScale;
    const newColor = this._ctx.effectiveFillColor;

    const shapeTarget = [...this._ctx.elements]
      .reverse()
      .find(el => el.pageId === pageId && el.type === 'shape' &&
        hitTestShape(el as ShapeElement, x, y));
    if (shapeTarget) {
      this._ctx.historyManager.execute(new FillColorCmd(
        this._ctx.elements, shapeTarget.id, (shapeTarget as ShapeElement).fillColor, newColor,
      ));
      this._ctx.autosave();
      this._ctx.rebuildElementLayer();
      return;
    }

    if (newColor === undefined) return;
    const strokes = this._ctx.inkLayer.getStrokes(pageId);
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (s.type !== 'ink') continue;
      const insidePoly = ptInPolygon(x, y, s.points);
      let nearStroke = false;
      if (!insidePoly) {
        const threshold = s.width / 2 + 4;
        for (let j = 0; j < s.points.length - 1; j++) {
          if (ptSegDist(x, y, s.points[j].x, s.points[j].y, s.points[j + 1].x, s.points[j + 1].y) <= threshold) {
            nearStroke = true; break;
          }
        }
      }
      if (insidePoly || nearStroke) {
        this._ctx.historyManager.execute(new InkFillColorCmd(
          this._ctx.inkLayer, pageId, i, s.fillColor, newColor, () => this._ctx.renderInkLayer(),
        ));
        this._ctx.autosave();
        return;
      }
    }
  }
}
