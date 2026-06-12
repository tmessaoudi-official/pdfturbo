import { ElementFactory } from '../utils/elementFactory';
import type { PDFElement } from '../elements/annotationElement';
import type { DocumentModel, DocumentPage, SourcePdf } from './documentModel';
import type { InkLayer, InkStroke } from '../infra/inkLayer';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface Command {
  execute(): void;
  undo(): void;
}

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

export class MoveResizeCmd implements Command {
  constructor(
    private elements: PDFElement[],
    private el: PDFElement,
    private before: Record<string, unknown>,
    private after: Record<string, unknown>
  ) {}
  execute() {
    const live = this.elements.find(e => e.id === this.el.id) ?? this.el;
    Object.assign(live, this.after);
  }
  undo() {
    const live = this.elements.find(e => e.id === this.el.id) ?? this.el;
    Object.assign(live, this.before);
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
    if (el) el.text = this.after;
  }

  undo(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = this.elements.find(e => e.id === this.elementId) as any;
    if (el) el.text = this.before;
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
    if (el) el.fillColor = this.after;
  }

  undo(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = this.elements.find(e => e.id === this.elementId) as any;
    if (el) el.fillColor = this.before;
  }
}

// Snapshot before/after page order for reorder undo
export class ReorderPagesCmd implements Command {
  constructor(
    private model: DocumentModel,
    private before: string[],
    private after: string[],
    private onUpdate: () => void,
  ) {}
  execute() { this.model.reorderPages(this.after); this.onUpdate(); }
  undo()    { this.model.reorderPages(this.before); this.onUpdate(); }
}

// Delete a page along with its elements; undo restores both
export class DeletePageCmd implements Command {
  private removedPage: DocumentPage | null = null;
  private removedPageIndex = 0;
  private removedElements: PDFElement[] = [];

  constructor(
    private model: DocumentModel,
    private elements: PDFElement[],
    private pageId: string,
    private onUpdate: () => void,
    // If the source PDF is GC'd when all its pages are deleted, preserve it for undo
    private sourcePdfSnapshot?: SourcePdf,
  ) {}

  execute() {
    this.removedPageIndex = this.model.pages.findIndex(p => p.id === this.pageId);
    this.removedElements = this.elements.filter(e => e.pageId === this.pageId);
    this.removedElements.forEach(e => {
      const i = this.elements.indexOf(e);
      if (i !== -1) this.elements.splice(i, 1);
    });
    this.removedPage = this.model.deletePage(this.pageId);
    this.onUpdate();
  }

  undo() {
    if (!this.removedPage) return;
    // Re-add source PDF if it was GC'd
    if (this.sourcePdfSnapshot && !this.model.sourcePdfs.has(this.sourcePdfSnapshot.id)) {
      this.model.sourcePdfs.set(this.sourcePdfSnapshot.id, this.sourcePdfSnapshot);
    }
    this.model.restorePage(this.removedPage, this.removedPageIndex);
    this.elements.push(...this.removedElements);
    this.onUpdate();
  }
}

// Add pages from a source PDF (undo removes them and GCs source if unused)
export class AddPagesCmd implements Command {
  private addedPages: DocumentPage[] = [];

  constructor(
    private model: DocumentModel,
    private sourcePdfId: string,
    private pageNums: number[] | undefined,
    private onUpdate: () => void,
  ) {}

  execute() {
    this.addedPages = this.model.addPagesFrom(this.sourcePdfId, this.pageNums);
    this.onUpdate();
  }

  undo() {
    this.addedPages.forEach(p => this.model.deletePage(p.id));
    this.onUpdate();
  }
}

export interface SourcePdfSnapshot {
  bytes: Uint8Array;
  doc: PDFDocumentProxy;
}

// Swap a source PDF's bytes + pdfjs doc (true text edit); undo restores the originals.
// Both pdfjs documents stay alive while the command sits on the history stack.
export class ReplaceSourcePdfBytesCmd implements Command {
  constructor(
    private src: SourcePdf,
    private before: SourcePdfSnapshot,
    private after: SourcePdfSnapshot,
    private onUpdate: () => void,
  ) {}

  execute() {
    this.src.bytes = this.after.bytes;
    this.src.doc = this.after.doc;
    this.onUpdate();
  }

  undo() {
    this.src.bytes = this.before.bytes;
    this.src.doc = this.before.doc;
    this.onUpdate();
  }
}

// Rotate a page CCW by delta degrees; undo restores prior rotation exactly
export class RotatePageCmd implements Command {
  private prevRotation = 0;

  constructor(
    private model: DocumentModel,
    private pageId: string,
    private delta: number,
    private onUpdate: () => void,
  ) {}

  execute() {
    const page = this.model.pages.find(p => p.id === this.pageId);
    if (!page) return;
    this.prevRotation = page.rotation ?? 0;
    page.rotation = ((this.prevRotation + this.delta) % 360 + 360) % 360;
    this.onUpdate();
  }

  undo() {
    const page = this.model.pages.find(p => p.id === this.pageId);
    if (!page) return;
    page.rotation = this.prevRotation;
    this.onUpdate();
  }
}

export class HistoryManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  constructor(
    private maxSize: number,
    private onChange: (canUndo: boolean, canRedo: boolean) => void
  ) {}

  execute(cmd: Command): void {
    cmd.execute();
    this._push(cmd);
  }

  record(cmd: Command): void {
    this._push(cmd);
  }

  private _push(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    this.redoStack = [];
    this.onChange(true, false);
  }

  undo(): boolean {
    if (!this.undoStack.length) return false;
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this.onChange(this.undoStack.length > 0, true);
    return true;
  }

  redo(): boolean {
    if (!this.redoStack.length) return false;
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute();
    this.undoStack.push(cmd);
    this.onChange(true, this.redoStack.length > 0);
    return true;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange(false, false);
  }
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

export class SplitStrokeCmd implements Command {
  constructor(
    private arr: PDFElement[],
    private original: PDFElement,
    private replacements: PDFElement[],
  ) {}
  execute(): void {
    const i = this.arr.indexOf(this.original);
    if (i !== -1) this.arr.splice(i, 1, ...this.replacements);
  }
  undo(): void {
    const i = this.arr.findIndex(e => e.id === this.replacements[0].id);
    if (i !== -1) this.arr.splice(i, this.replacements.length, this.original);
  }
}

export class MacroCmd implements Command {
  constructor(private cmds: Command[]) {}
  execute(): void { this.cmds.forEach(c => c.execute()); }
  undo(): void { [...this.cmds].reverse().forEach(c => c.undo()); }
}

export interface ElementTransformSnapshot {
  x: number; y: number; width: number; height: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  points?: Array<{ x: number; y: number }>;
  rotation?: number;
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

export class InkStrokeCmd implements Command {
  constructor(
    private layer: InkLayer,
    private pageId: string,
    private stroke: InkStroke,
    private onUpdate: () => void,
  ) {}
  execute(): void { this.layer.addStroke(this.pageId, this.stroke); this.onUpdate(); }
  undo():    void { this.layer.removeLastStroke(this.pageId); this.onUpdate(); }
}

export class InkColorCmd implements Command {
  constructor(
    private layer: InkLayer,
    private pageId: string,
    private strokeIndex: number,
    private before: string,
    private after: string,
    private onUpdate: () => void,
  ) {}
  execute(): void {
    const s = this.layer.getStrokes(this.pageId)[this.strokeIndex];
    if (s) { s.color = this.after; this.onUpdate(); }
  }
  undo(): void {
    const s = this.layer.getStrokes(this.pageId)[this.strokeIndex];
    if (s) { s.color = this.before; this.onUpdate(); }
  }
}

export class InkFillColorCmd implements Command {
  constructor(
    private layer: InkLayer,
    private pageId: string,
    private strokeIndex: number,
    private before: string | undefined,
    private after: string | undefined,
    private onUpdate: () => void,
  ) {}
  execute(): void {
    const s = this.layer.getStrokes(this.pageId)[this.strokeIndex];
    if (s) { s.fillColor = this.after; this.onUpdate(); }
  }
  undo(): void {
    const s = this.layer.getStrokes(this.pageId)[this.strokeIndex];
    if (s) { s.fillColor = this.before; this.onUpdate(); }
  }
}

export class ClearInkCmd implements Command {
  private _saved: Record<string, InkStroke[]>;
  constructor(private layer: InkLayer, private onUpdate: () => void) {
    this._saved = layer.toJSON();
  }
  execute(): void { this.layer.clearAll(); this.onUpdate(); }
  undo():    void { this.layer.fromJSON(this._saved); this.onUpdate(); }
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
