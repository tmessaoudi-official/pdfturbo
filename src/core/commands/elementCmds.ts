import { ElementFactory } from '../../utils/elementFactory';
import type { PDFElement } from '../../elements/annotationElement';
import type { Command } from './command';

export class AddElementCmd implements Command {
  constructor(private elements: PDFElement[], private el: PDFElement) {}
  execute() { this.elements.push(this.el); }
  undo() {
    // Use id-based lookup: SnapshotCmd may replace element instances while preserving ids
    const i = this.elements.findIndex(e => e.id === this.el.id);
    if (i !== -1) this.elements.splice(i, 1);
  }
}

export class RemoveElementCmd implements Command {
  private index: number;
  constructor(private elements: PDFElement[], private el: PDFElement) {
    this.index = elements.indexOf(el);
  }
  execute() {
    const i = this.elements.findIndex(e => e.id === this.el.id);
    if (i !== -1) this.elements.splice(i, 1);
  }
  undo() { this.elements.splice(Math.max(0, this.index), 0, this.el); }
}

export class ClearAllCmd implements Command {
  private saved: PDFElement[];
  constructor(private elements: PDFElement[]) {
    this.saved = [...elements];
  }
  execute() { this.elements.splice(0); }
  undo() { this.elements.splice(0, 0, ...this.saved); }
}

export class BulkDeleteCmd implements Command {
  // Capture each element's ORIGINAL index so undo restores z-order (array order = paint order),
  // not append order (#QA-2026-06-23 P2). Sorted ascending for a stable re-insert.
  private _deleted: { el: PDFElement; index: number }[];
  constructor(private arr: PDFElement[], elements: PDFElement[]) {
    this._deleted = elements
      .map(el => ({ el, index: arr.indexOf(el) }))
      .sort((a, b) => a.index - b.index);
  }
  execute(): void {
    for (const { el } of this._deleted) {
      const i = this.arr.findIndex(e => e.id === el.id);
      if (i !== -1) this.arr.splice(i, 1);
    }
  }
  undo(): void {
    // Re-insert at original indices, ascending — each earlier insert keeps later indices valid.
    for (const { el, index } of this._deleted) {
      const at = Math.min(Math.max(0, index), this.arr.length);
      this.arr.splice(at, 0, el);
    }
  }
}

// Full-snapshot command for text-edit checkpoints
export class SnapshotCmd implements Command {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private before: Array<Record<string, any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private after: Array<Record<string, any>> | null = null;

  constructor(private elements: PDFElement[]) {
    this.before = elements.map(el => ({ ...el.toJSON() }));
  }

  captureAfter() {
    this.after = this.elements.map(el => ({ ...el.toJSON() }));
  }

  execute() {
    if (!this.after) return;
    const restored = this.after.map(d => ElementFactory.fromJSON(d)).filter(Boolean) as PDFElement[];
    this.elements.splice(0, this.elements.length, ...restored);
  }

  undo() {
    const restored = this.before.map(d => ElementFactory.fromJSON(d)).filter(Boolean) as PDFElement[];
    this.elements.splice(0, this.elements.length, ...restored);
  }
}
