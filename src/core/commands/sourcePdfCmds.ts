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
}
