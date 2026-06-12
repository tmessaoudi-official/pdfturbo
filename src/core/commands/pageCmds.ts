import type { PDFElement } from '../../elements/annotationElement';
import type { DocumentModel, DocumentPage, SourcePdf } from '../documentModel';
import type { Command } from './command';

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
