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
  private _deleted: PDFElement[];
  constructor(private arr: PDFElement[], elements: PDFElement[]) {
    this._deleted = [...elements];
  }
  execute(): void {
    this._deleted.forEach(el => {
      const i = this.arr.findIndex(e => e.id === el.id);
      if (i !== -1) this.arr.splice(i, 1);
    });
  }
  undo(): void {
    this.arr.push(...this._deleted);
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
