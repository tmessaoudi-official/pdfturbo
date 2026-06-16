import type { InkLayer, InkStroke } from '../../infra/inkLayer';
import type { PDFElement } from '../../elements/annotationElement';
import type { Command } from './command';

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
