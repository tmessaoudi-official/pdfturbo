import { TextElement } from '../elements/textElement';
import { ShapeElement } from '../elements/shapeElement';
import { RedactionElement } from '../elements/redactionElement';
import { MoveResizeCmd, type HistoryManager } from './historyManager';
import type { PDFElement } from '../elements/annotationElement';
import type { AppDOMRefs } from '../ui/uiController';
import type { ToolMode } from '../types/tools';

export interface IFormattingContext {
  readonly selectedElement: PDFElement | null;
  readonly historyManager: HistoryManager;
  readonly elements: PDFElement[];
  readonly ui: AppDOMRefs;
  readonly mode: ToolMode;
  rebuildElementLayer(): void;
  autosave(): void;
  /** Delegates to uiController.updateFormattingToolbar(selectedElement, mode). */
  syncFormattingUIDisplay(el: PDFElement | null, mode: ToolMode): void;
}

export class FormattingService {
  private _noFill = true;

  constructor(private readonly _ctx: IFormattingContext) {}

  get effectiveFillColor(): string | undefined {
    return this._noFill ? undefined : this._ctx.ui.fillColorInput.value;
  }

  _syncFillToggleUI(): void {
    const noFill = this._noFill;
    this._ctx.ui.fillNoneBtn.classList.toggle('active', noFill);
    this._ctx.ui.fillNoneBtn.setAttribute('aria-pressed', String(noFill));
    this._ctx.ui.fillColorInput.style.opacity = noFill ? '0.35' : '1';
  }

  updateFormattingToolbar(): void {
    this._ctx.syncFormattingUIDisplay(this._ctx.selectedElement, this._ctx.mode);
    if (this._ctx.selectedElement?.type === 'shape') {
      const she = this._ctx.selectedElement as ShapeElement;
      const isFillable = she.shapeType === 'rect' || she.shapeType === 'ellipse' || she.shapeType === 'freehand';
      if (isFillable) this._noFill = she.fillColor === undefined;
    }
    this._syncFillToggleUI();
  }

  setFontFamily(value: string): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { fontFamily: te.fontFamily };
    te.fontFamily = value;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { fontFamily: value }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  toggleBold(): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { bold: te.bold };
    te.bold = !te.bold;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { bold: te.bold }));
    this._ctx.ui.boldBtn.classList.toggle('btn-active-fmt', te.bold);
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  toggleItalic(): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { italic: te.italic };
    te.italic = !te.italic;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { italic: te.italic }));
    this._ctx.ui.italicBtn.classList.toggle('btn-active-fmt', te.italic);
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  setFontSize(size: number): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { fontSize: te.fontSize };
    te.fontSize = size;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { fontSize: size }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  adjustFontSize(delta: number): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { fontSize: te.fontSize };
    const newSize = Math.max(8, Math.min(72, te.fontSize + delta));
    te.fontSize = newSize;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { fontSize: newSize }));
    this._ctx.ui.fontSizeInput.value = String(newSize);
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  setElementColor(value: string): void {
    if (this._ctx.selectedElement?.type === 'text') {
      const te = this._ctx.selectedElement as TextElement;
      const before = { color: te.color };
      te.color = value;
      this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { color: value }));
      this._ctx.rebuildElementLayer();
      this._ctx.autosave();
    } else if (this._ctx.selectedElement?.type === 'shape') {
      const she = this._ctx.selectedElement as ShapeElement;
      const before = { strokeColor: she.strokeColor };
      she.strokeColor = value;
      this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, she, before, { strokeColor: value }));
      this._ctx.rebuildElementLayer();
      this._ctx.autosave();
    } else if (this._ctx.selectedElement?.type === 'redaction') {
      const re = this._ctx.selectedElement as RedactionElement;
      const before = { color: re.color };
      re.color = value;
      this._ctx.ui.redactColorInput.value = value;
      this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, re, before, { color: value }));
      this._ctx.rebuildElementLayer();
      this._ctx.autosave();
    }
  }

  setFillNone(): void {
    this._noFill = true;
    this._syncFillToggleUI();
    if (this._ctx.selectedElement?.type === 'shape') {
      const she = this._ctx.selectedElement as ShapeElement;
      const before = { fillColor: she.fillColor };
      she.fillColor = undefined;
      this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, she, before, { fillColor: undefined }));
      this._ctx.rebuildElementLayer();
      this._ctx.autosave();
    }
  }

  startFillColor(): void {
    this._noFill = false;
    this._syncFillToggleUI();
  }

  setFillColor(value: string): void {
    this._noFill = false;
    this._syncFillToggleUI();
    if (this._ctx.selectedElement?.type === 'shape') {
      const she = this._ctx.selectedElement as ShapeElement;
      const before = { fillColor: she.fillColor };
      she.fillColor = value;
      this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, she, before, { fillColor: value }));
      this._ctx.rebuildElementLayer();
      this._ctx.autosave();
    }
  }

  setRedactColor(value: string): void {
    if (this._ctx.selectedElement?.type !== 'redaction') return;
    const re = this._ctx.selectedElement as RedactionElement;
    const before = { color: re.color };
    re.color = value;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, re, before, { color: value }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  setShapeStrokeWidth(value: number): void {
    if (this._ctx.selectedElement?.type !== 'shape') return;
    const she = this._ctx.selectedElement as ShapeElement;
    const before = { strokeWidth: she.strokeWidth };
    she.strokeWidth = value;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, she, before, { strokeWidth: value }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }
}
