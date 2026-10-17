import { TextElement } from '../elements/textElement';
import { CommentElement } from '../elements/commentElement';
import { TextEditCmd, SetFormValueCmd, type HistoryManager } from './historyManager';
import type { PDFElement } from '../elements/annotationElement';
import type { IErrorReporter } from '../contracts/errorReporter';

export interface IUndoRedoContext {
  readonly historyManager: HistoryManager;
  readonly elements: PDFElement[];
  /** Shared AcroForm fill store ({sourcePdfId: {fieldName: value}}) — mutated by SetFormValueCmd. */
  readonly formValues: Record<string, Record<string, string>>;
  setSelectedElement(el: PDFElement | null): void;
  renderCurrentPage(): Promise<void>;
  rebuildElementLayer(): void;
  updateActiveThumbnail(): void;
  updatePageInfo(): void;
  updateFormattingToolbar(): void;
  autosave(): void;
  readonly reportError: IErrorReporter;
}

export class UndoRedoController {
  private _textChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingTextBefore: string | null = null;
  private _pendingTextElementId: number | null = null;

  // #QA-2026-06-23 P1 — debounced, undoable AcroForm fills.
  private _formChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingFormKey: string | null = null;
  private _pendingFormSrcId: string | null = null;
  private _pendingFormField: string | null = null;
  /** `undefined` = the field had no stored value (the overlay showed the PDF's own); `null` = nothing pending. */
  private _pendingFormBefore: string | undefined | null = null;
  private _pendingFormAfter: string | null = null;

  constructor(private readonly _ctx: IUndoRedoContext) {}

  /**
   * Handle a live AcroForm field edit. Sets the value immediately (so export/autosave see it)
   * and coalesces a burst of edits to one field into a SINGLE undoable SetFormValueCmd recorded
   * after a 500ms idle (mirrors handleTextInput). Switching fields or undo/redo flushes the
   * pending command first, so each settled field value is independently undoable.
   */
  handleFormInput(srcId: string, fieldName: string, value: string): void {
    const key = `${srcId}\u0000${fieldName}`;
    if (this._pendingFormKey !== key) {
      this._flushPendingFormEdit(); // settle the previous field as its own command
      this._pendingFormBefore = this._ctx.formValues[srcId]?.[fieldName];
      this._pendingFormKey = key;
      this._pendingFormSrcId = srcId;
      this._pendingFormField = fieldName;
    }
    if (!this._ctx.formValues[srcId]) this._ctx.formValues[srcId] = {};
    this._ctx.formValues[srcId][fieldName] = value;
    this._pendingFormAfter = value;
    clearTimeout(this._formChangeTimer ?? undefined);
    this._formChangeTimer = setTimeout(() => {
      this._flushPendingFormEdit();
      this._ctx.autosave();
    }, 500);
  }

  /** Record the pending form edit (if the value actually changed) and clear the pending state. */
  private _flushPendingFormEdit(): void {
    if (this._formChangeTimer !== null) {
      clearTimeout(this._formChangeTimer);
      this._formChangeTimer = null;
    }
    const srcId = this._pendingFormSrcId;
    const field = this._pendingFormField;
    const before = this._pendingFormBefore;
    const after = this._pendingFormAfter;
    this._pendingFormKey = null;
    this._pendingFormSrcId = null;
    this._pendingFormField = null;
    this._pendingFormBefore = null;
    this._pendingFormAfter = null;
    if (srcId !== null && field !== null && before !== null && after !== null && before !== after) {
      this._ctx.historyManager.record(new SetFormValueCmd(this._ctx.formValues, srcId, field, before, after));
    }
  }

  handleTextInput(element: TextElement | CommentElement, input: HTMLInputElement | HTMLTextAreaElement): void {
    if (this._pendingTextElementId !== element.id) {
      this._pendingTextBefore = element.text;
      this._pendingTextElementId = element.id;
    }
    element.text = input.value;
    clearTimeout(this._textChangeTimer ?? undefined);
    this._textChangeTimer = setTimeout(() => {
      this._flushPendingTextEdit();
      this._ctx.autosave();
    }, 500);
  }

  /**
   * Record the pending text edit (if the text actually changed) and clear the pending state.
   * #QA-2026-06-23 P2: called from undo()/redo() too, so an in-flight edit (before the 500ms
   * debounce fires) is FLUSHED — recorded then revertible — instead of being silently discarded.
   */
  private _flushPendingTextEdit(): void {
    if (this._textChangeTimer !== null) {
      clearTimeout(this._textChangeTimer);
      this._textChangeTimer = null;
    }
    const id = this._pendingTextElementId;
    const before = this._pendingTextBefore;
    this._pendingTextElementId = null;
    this._pendingTextBefore = null;
    if (id !== null && before !== null) {
      const el = this._ctx.elements.find(e => e.id === id) as { text?: string } | undefined;
      if (el && typeof el.text === 'string' && el.text !== before) {
        this._ctx.historyManager.record(new TextEditCmd(this._ctx.elements, id, before, el.text));
      }
    }
  }

  undo(): void {
    this._flushPendingTextEdit();
    this._flushPendingFormEdit();
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
      this._ctx.autosave();
    }
  }

  redo(): void {
    this._flushPendingTextEdit();
    this._flushPendingFormEdit();
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
      this._ctx.autosave();
    }
  }
}
