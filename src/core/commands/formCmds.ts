import type { Command } from './command';

/**
 * SetFormValueCmd — undoable AcroForm field fill (#QA-2026-06-23 P1).
 *
 * Form fills previously mutated `_formValues` directly, bypassing the history stack, so
 * Ctrl+Z could not revert them (a violation of the project's cardinal undo rule). This
 * command captures `before`/`after` for one (sourcePdfId, fieldName) and re-applies either
 * to the shared `_formValues` store. It is `record()`ed (not `execute()`d) — the live value
 * is already set by the input handler — so undo/redo flip the stored value and the caller
 * re-renders the form overlay to reflect it.
 */
export class SetFormValueCmd implements Command {
  constructor(
    private store: Record<string, Record<string, string>>,
    private srcId: string,
    private field: string,
    private before: string,
    private after: string,
  ) {}

  private _set(v: string): void {
    if (!this.store[this.srcId]) this.store[this.srcId] = {};
    this.store[this.srcId][this.field] = v;
  }

  execute(): void { this._set(this.after); }
  undo(): void { this._set(this.before); }
}
