import { PDFElement, type ElementJSON } from '../elements/annotationElement';
import { ElementFactory } from '../utils/elementFactory';
import {
  HistoryManager, AddElementCmd, RemoveElementCmd, ClearAllCmd,
  MacroCmd, ClearInkCmd,
} from './historyManager';
import type { InkLayer } from '../infra/inkLayer';
import type { DocumentModel } from './documentModel';
import type { IErrorReporter } from './errorReporter';

export interface IAnnotationContext {
  readonly elements: PDFElement[];
  readonly historyManager: HistoryManager;
  readonly inkLayer: InkLayer;
  selectedElement: PDFElement | null;
  readonly reportError: IErrorReporter;
  clipboard: ElementJSON | null;
  readonly documentModel: DocumentModel;
  autosave(): void;
  rebuildElementLayer(): void;
  renderInkLayer(): void;
  updateFormattingToolbar(): void;
  updateCopyPasteBtns(): void;
  selectElement(el: PDFElement | null): void;
}

export class AnnotationService {
  constructor(private readonly _ctx: IAnnotationContext) {}

  clearAll(): void {
    const ctx = this._ctx;
    const hasVector = ctx.elements.length > 0;
    const hasInk    = ctx.inkLayer.hasAnyContent();
    if (!hasVector && !hasInk) { ctx.reportError.warn('toast.noAnnotationsToClear'); return; }
    const cmds = [];
    if (hasVector) cmds.push(new ClearAllCmd(ctx.elements));
    if (hasInk)    cmds.push(new ClearInkCmd(ctx.inkLayer, () => ctx.renderInkLayer()));
    ctx.historyManager.execute(cmds.length === 1 ? cmds[0] : new MacroCmd(cmds));
    ctx.selectedElement = null;
    ctx.updateFormattingToolbar();
    ctx.autosave();
    ctx.rebuildElementLayer();
    ctx.reportError.info('toast.annotationsCleared');
  }

  removeElement(id: number): void {
    const ctx = this._ctx;
    const el = ctx.elements.find(e => e.id === id);
    if (!el) return;
    ctx.historyManager.execute(new RemoveElementCmd(ctx.elements, el));
    if (ctx.selectedElement?.id === id) {
      ctx.selectedElement = null;
      ctx.updateFormattingToolbar();
    }
    ctx.rebuildElementLayer();
    ctx.autosave();
  }

  copySelectedElement(): void {
    const ctx = this._ctx;
    if (!ctx.selectedElement) return;
    ctx.clipboard = ctx.selectedElement.toJSON() as ElementJSON;
    ctx.updateCopyPasteBtns();
    ctx.reportError.info('toast.copied');
  }

  pasteElement(): void {
    const ctx = this._ctx;
    if (!ctx.clipboard || !ctx.documentModel.currentPage) return;
    const clone = ElementFactory.fromJSON({ ...ctx.clipboard } as Record<string, unknown>);
    if (!clone) return;
    clone.id = PDFElement._nextId++;
    clone.x += 10;
    clone.y += 10;
    clone.pageId = ctx.documentModel.currentPage.id;
    ctx.historyManager.execute(new AddElementCmd(ctx.elements, clone));
    ctx.selectElement(clone);
    ctx.autosave();
    ctx.reportError.info('toast.pastedUndo');
  }
}
