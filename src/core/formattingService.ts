import { TextElement, resolveDirection, type TextAlign, type TextDirection } from '../elements/textElement';
import { ShapeElement } from '../elements/shapeElement';
import { RedactionElement } from '../elements/redactionElement';
import { MoveResizeCmd, type HistoryManager } from './historyManager';
import { applyTextCase, type TextCaseMode } from '../utils/textCase';
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
  private _copiedTextStyle: Record<string, unknown> | null = null;

  constructor(private readonly _ctx: IFormattingContext) {}

  get effectiveFillColor(): string | undefined {
    return this._noFill ? undefined : this._ctx.ui.fillColorInput.value;
  }

  get painterArmed(): boolean {
    return this._copiedTextStyle !== null;
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

  toggleUnderline(): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { underline: te.underline };
    te.underline = !te.underline;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { underline: te.underline }));
    this._ctx.ui.underlineBtn.classList.toggle('btn-active-fmt', te.underline);
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  toggleStrikethrough(): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { strikethrough: te.strikethrough };
    te.strikethrough = !te.strikethrough;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { strikethrough: te.strikethrough }));
    this._ctx.ui.strikeBtn.classList.toggle('btn-active-fmt', te.strikethrough);
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  /** Cycle text alignment left → center → right → left. */
  cycleAlign(): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const next = te.align === 'left' ? 'center' : te.align === 'center' ? 'right' : 'left';
    const before = { align: te.align };
    te.align = next;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { align: next }));
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

  setAlign(value: TextAlign): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { align: te.align };
    te.align = value;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { align: value }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  /** Set text direction. When the result resolves RTL and align is still the default
   *  'left', default it to 'right' (the RTL right-align convention) in the same command. */
  setDirection(dir: TextDirection): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { direction: te.direction, align: te.align };
    te.direction = dir;
    if (resolveDirection(dir, te.text) === 'rtl' && te.align === 'left') te.align = 'right';
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { direction: te.direction, align: te.align }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  /** Override the resolved direction to the opposite explicit value (RTL↔LTR). */
  toggleDirection(): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    this.setDirection(resolveDirection(te.direction, te.text) === 'rtl' ? 'ltr' : 'rtl');
  }

  setLineHeight(mult: number): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const v = Math.min(3, Math.max(1, mult));
    const before = { lineHeight: te.lineHeight };
    te.lineHeight = v;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { lineHeight: v }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  setTextOpacity(v: number): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const o = Math.min(1, Math.max(0, v));
    const before = { opacity: te.opacity };
    te.opacity = o;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { opacity: o }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  setTextBackground(value: string): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { backgroundColor: te.backgroundColor };
    te.backgroundColor = value;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { backgroundColor: value }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  clearTextBackground(): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { backgroundColor: te.backgroundColor };
    te.backgroundColor = undefined;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { backgroundColor: undefined }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  // Text outline: the stroke is drawn in the element's own fill color (chosen from the
  // shared color palette) — there is no separate stroke color. Only the width is set here.
  setTextStroke(width: number): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const w = Math.min(10, Math.max(0, Number.isFinite(width) ? width : 0));
    const before = { strokeWidth: te.strokeWidth };
    te.strokeWidth = w;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { strokeWidth: w }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  clearTextStroke(): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = { strokeWidth: te.strokeWidth };
    te.strokeWidth = undefined;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { strokeWidth: undefined }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  setCharSpacing(pt: number): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const v = Math.min(20, Math.max(-5, Number.isFinite(pt) ? pt : 0));
    const before = { charSpacing: te.charSpacing };
    te.charSpacing = v;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { charSpacing: v }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  setHorizontalScale(pct: number): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const v = Math.min(200, Math.max(50, Number.isFinite(pct) ? pct : 100));
    const before = { horizontalScale: te.horizontalScale };
    te.horizontalScale = v;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { horizontalScale: v }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  setBaselineShift(mode: 'super' | 'sub' | null): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const v = mode ?? undefined;
    const before = { baselineShift: te.baselineShift };
    te.baselineShift = v;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { baselineShift: v }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  transformCase(mode: TextCaseMode): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const next = applyTextCase(te.text, mode);
    if (next === te.text) return;
    const before = { text: te.text };
    te.text = next;
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, { text: next }));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  clearFormatting(): void {
    if (!this._ctx.selectedElement || this._ctx.selectedElement.type !== 'text') return;
    const te = this._ctx.selectedElement as TextElement;
    const before = {
      bold: te.bold,
      italic: te.italic,
      underline: te.underline,
      strikethrough: te.strikethrough,
      align: te.align,
      fontFamily: te.fontFamily,
      fontSize: te.fontSize,
      color: te.color,
      lineHeight: te.lineHeight,
      opacity: te.opacity,
      backgroundColor: te.backgroundColor,
      strokeWidth: te.strokeWidth,
      charSpacing: te.charSpacing,
      horizontalScale: te.horizontalScale,
      baselineShift: te.baselineShift,
    };
    const after = {
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      align: 'left' as const,
      fontFamily: 'Arial',
      fontSize: 14,
      color: '#000000',
      lineHeight: undefined,
      opacity: undefined,
      backgroundColor: undefined,
      strokeWidth: undefined,
      charSpacing: undefined,
      horizontalScale: undefined,
      baselineShift: undefined,
    };
    Object.assign(te, after);
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, after));
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }

  copyTextStyle(): boolean {
    if (this._ctx.selectedElement?.type !== 'text') return false;
    const te = this._ctx.selectedElement as TextElement;
    this._copiedTextStyle = {
      bold: te.bold,
      italic: te.italic,
      underline: te.underline,
      strikethrough: te.strikethrough,
      align: te.align,
      fontFamily: te.fontFamily,
      fontSize: te.fontSize,
      color: te.color,
      lineHeight: te.lineHeight,
      opacity: te.opacity,
      backgroundColor: te.backgroundColor,
      strokeWidth: te.strokeWidth,
      charSpacing: te.charSpacing,
      horizontalScale: te.horizontalScale,
      baselineShift: te.baselineShift,
    };
    return true;
  }

  cancelPainter(): void {
    this._copiedTextStyle = null;
  }

  pasteTextStyle(): void {
    if (!this._copiedTextStyle || this._ctx.selectedElement?.type !== 'text') {
      this._copiedTextStyle = null;
      return;
    }
    const te = this._ctx.selectedElement as TextElement;
    const keys = Object.keys(this._copiedTextStyle);
    const before: Record<string, unknown> = {};
    for (const k of keys) {
      before[k] = (te as unknown as Record<string, unknown>)[k];
    }
    Object.assign(te, this._copiedTextStyle);
    this._ctx.historyManager.record(new MoveResizeCmd(this._ctx.elements, te, before, this._copiedTextStyle));
    this._copiedTextStyle = null;
    this._ctx.rebuildElementLayer();
    this._ctx.autosave();
  }
}
