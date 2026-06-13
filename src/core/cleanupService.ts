import { TextElement } from '../elements/textElement';
import type { PDFElement } from '../elements/annotationElement';

export interface ICleanupContext {
  readonly elements: PDFElement[];
  rebuildElementLayer(): void;
}

export class CleanupService {
  constructor(private readonly _ctx: ICleanupContext) {}

  cleanEmptyTextElements(): void {
    const focused = document.activeElement;
    const before = this._ctx.elements.length;
    const keep = this._ctx.elements.filter(e => {
      if (!(e.type === 'text' && !(e as TextElement).text)) return true;
      const input = document.querySelector(`[data-id="${e.id}"] input, [data-id="${e.id}"] textarea`);
      return input ? input === focused : true;
    });
    if (keep.length < before) {
      this._ctx.elements.splice(0, this._ctx.elements.length, ...keep);
      this._ctx.rebuildElementLayer();
    }
  }
}
