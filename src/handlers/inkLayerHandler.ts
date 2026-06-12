import type { IAppContext } from '../core/appContext';
import type { InkStroke } from '../infra/inkLayer';
import { InkStrokeCmd } from '../core/historyManager';

export class InkLayerHandler {
  private _drawing = false;
  private _currentPoints: Array<{ x: number; y: number }> = [];
  private _activePointerId: number | null = null;
  private _strokeType: 'ink' | 'erase' = 'ink';

  constructor(private app: IAppContext) {}

  cancel(): void {
    this._drawing = false;
    this._currentPoints = [];
    this._activePointerId = null;
    this.app.renderInkLayer();
  }

  handlePointerDown(e: PointerEvent): void {
    if (this.app.mode !== 'drawFreehand' && this.app.mode !== 'drawErase') return;
    if (!this.app.documentModel.currentPage) return;

    // Second finger during a stroke = pinch gesture — discard the in-progress stroke
    if (this._drawing) {
      this.cancel();
      return;
    }

    const rect = this.app.ui.canvas.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top  || e.clientY > rect.bottom) return;

    this._strokeType = this.app.mode === 'drawErase' ? 'erase' : 'ink';
    this._drawing = true;
    this._activePointerId = e.pointerId;
    this._currentPoints = [this._coord(e, rect)];
    this.app.ui.canvas.setPointerCapture(e.pointerId);
  }

  handlePointerMove(e: PointerEvent): void {
    if (!this._drawing || e.pointerId !== this._activePointerId) return;
    const rect = this.app.ui.canvas.getBoundingClientRect();
    const pt = this._coord(e, rect);
    const last = this._currentPoints[this._currentPoints.length - 1];
    const dist = Math.hypot((pt.x - last.x) * this.app.zoomScale, (pt.y - last.y) * this.app.zoomScale);
    if (dist > 2) {
      this._currentPoints.push(pt);
      this.app.renderInkLayerWithLive(this._currentPoints, this._strokeType);
    }
  }

  handlePointerUp(e: PointerEvent): void {
    if (!this._drawing || e.pointerId !== this._activePointerId) return;
    this._drawing = false;
    this._activePointerId = null;

    const pageId = this.app.documentModel.currentPage?.id;
    if (!pageId || this._currentPoints.length < 2) {
      this._currentPoints = [];
      this.app.renderInkLayer();
      return;
    }

    const sw = parseInt(this.app.ui.shapeWidth.value) || 3;
    const stroke: InkStroke = {
      type: this._strokeType,
      points: [...this._currentPoints],
      width: this._strokeType === 'erase' ? Math.max(12, sw * 4) : sw,
      color: this.app.ui.colorInput.value,
    };
    this._currentPoints = [];

    this.app.historyManager.execute(
      new InkStrokeCmd(this.app.inkLayer, pageId, stroke, () => this.app.renderInkLayer())
    );
    this.app._autosave();
  }

  handlePointerCancel(e: PointerEvent): void {
    if (e.pointerId === this._activePointerId) this.cancel();
  }

  private _coord(e: PointerEvent, rect: DOMRect): { x: number; y: number } {
    return {
      x: (e.clientX - rect.left) / this.app.zoomScale,
      y: (e.clientY - rect.top)  / this.app.zoomScale,
    };
  }
}
