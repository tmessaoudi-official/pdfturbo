import type { SourcePdf } from '../documentModel';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Command } from './command';

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

  // Called by HistoryManager only when this command has permanently left the history
  // stack (overflow eviction, redo-branch invalidation, or clear()). At that point this
  // command's *other* branch — the pdfjs document it was holding for the direction the
  // user is no longer on — is unreachable and leaks worker memory unless destroyed.
  //
  // USE-AFTER-FREE SAFETY (deliberately conservative):
  //   - `this.src.doc` is the document the live app is currently rendering. It MUST NOT be
  //     destroyed — doing so causes a use-after-free crash on the next render.
  //   - We therefore destroy a snapshot's doc ONLY when it is not identical to the live
  //     `this.src.doc`. After execute(): live === after.doc, so we free before.doc. After
  //     undo(): live === before.doc, so we free after.doc.
  //   - If a doc equals the live one (or before/after share the same doc), we skip it.
  //     A leak is strictly preferable to a use-after-free. We never share/dedupe docs
  //     beyond this command, so identity comparison against the live ref is sufficient and
  //     safe; any uncertainty falls through to the skip branch.
  // Teardown: pdf.js v6 PDFDocumentProxy has NO destroy() method — full release of the
  // document and its worker transport goes through the document's loadingTask.destroy()
  // (returns a Promise). The `_disposed` guard makes a second dispose() a harmless no-op.
  private _disposed = false;
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    const live = this.src.doc;
    for (const snap of [this.before, this.after]) {
      const doc = snap?.doc;
      if (doc && doc !== live) {
        const task = doc.loadingTask;
        if (task && typeof task.destroy === 'function') {
          // best-effort async cleanup; never throw/reject out of dispose()
          void task.destroy().catch(() => {});
        }
      }
    }
  }
}
