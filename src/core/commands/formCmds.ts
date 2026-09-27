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
 *
 * `before` may be `undefined`: the field had no stored value, so the overlay showed the PDF's own. Undo then
 * DELETES the key rather than storing `''`, which would override that value and blank a pre-filled field
 * (limits row 26 — an XFDF import fills fields the user never touched).
 */
export class SetFormValueCmd implements Command {
  constructor(
    private store: Record<string, Record<string, string>>,
    private srcId: string,
    private field: string,
    private before: string | undefined,
    private after: string,
  ) {}

  private _set(v: string | undefined): void {
    if (v === undefined) { delete this.store[this.srcId]?.[this.field]; return; }
    if (!this.store[this.srcId]) this.store[this.srcId] = {};
    this.store[this.srcId][this.field] = v;
  }

  execute(): void { this._set(this.after); }
  undo(): void { this._set(this.before); }
}
