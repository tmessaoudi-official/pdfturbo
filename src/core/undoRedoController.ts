import { TextElement } from '../elements/textElement';
import { TextEditCmd, type HistoryManager } from './historyManager';
import type { PDFElement } from '../elements/annotationElement';
import type { IErrorReporter } from './errorReporter';

export interface IUndoRedoContext {
  readonly historyManager: HistoryManager;
  readonly elements: PDFElement[];
  setSelectedElement(el: PDFElement | null): void;
  renderCurrentPage(): Promise<void>;
  rebuildElementLayer(): void;
  updateActiveThumbnail(): void;
  updatePageInfo(): void;
  updateFormattingToolbar(): void;
  _autosave(): void;
  readonly reportError: IErrorReporter;
}

export class UndoRedoController {
  private _textChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingTextBefore: string | null = null;
  private _pendingTextElementId: number | null = null;

  constructor(private readonly _ctx: IUndoRedoContext) {}

  handleTextInput(element: TextElement, input: HTMLInputElement | HTMLTextAreaElement): void {
    if (this._pendingTextElementId !== element.id) {
      this._pendingTextBefore = element.text;
      this._pendingTextElementId = element.id;
    }
    element.text = input.value;
    clearTimeout(this._textChangeTimer ?? undefined);
    this._textChangeTimer = setTimeout(() => {
      const before = this._pendingTextBefore;
      const id = this._pendingTextElementId;
      this._pendingTextBefore = null;
      this._pendingTextElementId = null;
      this._textChangeTimer = null;
      if (id !== null && before !== null && before !== element.text) {
        this._ctx.historyManager.record(new TextEditCmd(this._ctx.elements, id, before, element.text));
      }
      this._ctx._autosave();
    }, 500);
  }

  private _cancelPendingTextEdit(): void {
    if (this._textChangeTimer !== null) {
      clearTimeout(this._textChangeTimer);
      this._textChangeTimer = null;
      this._pendingTextBefore = null;
      this._pendingTextElementId = null;
    }
  }

  undo(): void {
    this._cancelPendingTextEdit();
    if (this._ctx.historyManager.undo()) {
      this._ctx.setSelectedElement(null);
      this._ctx.renderCurrentPage().then(() => {
        this._ctx.rebuildElementLayer();
        this._ctx.updateActiveThumbnail();
        this._ctx.updatePageInfo();
      }).catch((err: unknown) => {
        this._ctx.reportError.error('toast.renderFailedUndo', err);
      });
      this._ctx.updateFormattingToolbar();
      this._ctx._autosave();
    }
  }

  redo(): void {
    this._cancelPendingTextEdit();
    if (this._ctx.historyManager.redo()) {
      this._ctx.setSelectedElement(null);
      this._ctx.renderCurrentPage().then(() => {
        this._ctx.rebuildElementLayer();
        this._ctx.updateActiveThumbnail();
        this._ctx.updatePageInfo();
      }).catch((err: unknown) => {
        this._ctx.reportError.error('toast.renderFailedRedo', err);
      });
      this._ctx.updateFormattingToolbar();
      this._ctx._autosave();
    }
  }
}
