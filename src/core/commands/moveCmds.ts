import type { PDFElement } from '../../elements/annotationElement';
import type { Command } from './command';

export class MoveResizeCmd implements Command {
  constructor(
    private elements: PDFElement[],
    private el: PDFElement,
    private before: Record<string, unknown>,
    private after: Record<string, unknown>
  ) {}
  execute() {
    const live = this.elements.find(e => e.id === this.el.id) ?? _warnMissing('MoveResizeCmd', this.el.id, this.el);
    Object.assign(live, this.after);
  }
  undo() {
    const live = this.elements.find(e => e.id === this.el.id) ?? _warnMissing('MoveResizeCmd', this.el.id, this.el);
    Object.assign(live, this.before);
  }
}

/**
 * Log (don't silently ignore) a command targeting an element no longer in the live array
 * (#QA-2026-06-23 P3 #20). Returns the fallback so callers keep their prior behavior — the
 * warning just surfaces the stale-target condition for diagnosis instead of a silent no-op.
 */
function _warnMissing<T>(cmd: string, id: number, fallback: T): T {
  // eslint-disable-next-line no-console -- low-level command has no errorReporter; surface the stale target
  console.warn(`[history] ${cmd}: element #${id} not found in live array (stale target)`);
  return fallback;
}

export class TextEditCmd implements Command {
  constructor(
    private elements: PDFElement[],
    private elementId: number,
    private before: string,
    private after: string,
  ) {}

  execute(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = this.elements.find(e => e.id === this.elementId) as any;
    if (el) el.text = this.after; else _warnMissing('TextEditCmd', this.elementId, null);
  }

  undo(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = this.elements.find(e => e.id === this.elementId) as any;
    if (el) el.text = this.before; else _warnMissing('TextEditCmd', this.elementId, null);
  }
}

export class FillColorCmd implements Command {
  constructor(
    private elements: PDFElement[],
    private elementId: number,
    private before: string | undefined,
    private after: string | undefined,
  ) {}

  execute(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = this.elements.find(e => e.id === this.elementId) as any;
    if (el) el.fillColor = this.after; else _warnMissing('FillColorCmd', this.elementId, null);
  }

  undo(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = this.elements.find(e => e.id === this.elementId) as any;
    if (el) el.fillColor = this.before; else _warnMissing('FillColorCmd', this.elementId, null);
  }
}

export class RotateElementCmd implements Command {
  constructor(
    private elements: PDFElement[],
    private el: PDFElement,
    private before: number,
    private after: number,
  ) {}
  execute() {
    const live = this.elements.find(e => e.id === this.el.id) ?? this.el;
    live.rotation = this.after;
  }
  undo() {
    const live = this.elements.find(e => e.id === this.el.id) ?? this.el;
    live.rotation = this.before;
  }
}

export interface ElementTransformSnapshot {
  x: number; y: number; width: number; height: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  points?: Array<{ x: number; y: number }>;
  rotation?: number;
}

export class TransformAnnotationsCmd implements Command {
  constructor(
    private arr: PDFElement[],
    private before: Map<number, ElementTransformSnapshot>,
    private after:  Map<number, ElementTransformSnapshot>,
  ) {}

  private _apply(snaps: Map<number, ElementTransformSnapshot>): void {
    for (const el of this.arr) {
      const s = snaps.get(el.id);
      if (!s) continue;
      el.x = s.x; el.y = s.y; el.width = s.width; el.height = s.height;
      if (s.rotation !== undefined) el.rotation = s.rotation;
      // ShapeElement extra fields — cast to any to avoid circular import
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sh = el as any;
      if (s.x1 !== undefined) sh.x1 = s.x1;
      if (s.y1 !== undefined) sh.y1 = s.y1;
      if (s.x2 !== undefined) sh.x2 = s.x2;
      if (s.y2 !== undefined) sh.y2 = s.y2;
      if (s.points !== undefined) sh.points = s.points.map((p: { x: number; y: number }) => ({ ...p }));
    }
  }

  execute(): void { this._apply(this.after); }
  undo():    void { this._apply(this.before); }
}
