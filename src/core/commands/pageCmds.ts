import type { PDFElement } from '../../elements/annotationElement';
import type { DocumentModel, DocumentPage, SourcePdf, PageCrop } from '../documentModel';
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

// Insert a blank page at a given index; undo removes it and restores the prior current index.
// `page` is populated by execute() so the caller can drive UI updates against the new page.
export class InsertBlankPageCmd implements Command {
  page!: DocumentPage;
  private _prevIndex = 0;

  constructor(
    private model: DocumentModel,
    private w: number,
    private h: number,
    private atIndex: number,
    private onUpdate: () => void,
  ) {}

  execute() {
    this._prevIndex = this.model.currentPageIndex;
    this.page = this.model.addBlankPage(this.w, this.h, this.atIndex);
    this.model.currentPageIndex = this.model.pages.indexOf(this.page);
    this.onUpdate();
  }

  undo() {
    this.model.deletePage(this.page.id);
    const len = this.model.pages.length;
    this.model.currentPageIndex = len === 0 ? 0 : Math.max(0, Math.min(this._prevIndex, len - 1));
    this.onUpdate();
  }
}

// Set (or clear, when newCrop is null) a page's user crop. Undo restores the prior
// crop exactly (including "no crop"). Mirrors RotatePageCmd — the crop rides on the
// page object, so it moves/persists with the page automatically.
export class SetPageCropCmd implements Command {
  private prevCrop: PageCrop | undefined;
  private _captured = false;

  constructor(
    private model: DocumentModel,
    private pageId: string,
    private newCrop: PageCrop | null,
    private onUpdate: () => void,
  ) {}

  execute() {
    const page = this.model.pages.find(p => p.id === this.pageId);
    if (!page) return;
    this.prevCrop = page.crop;
    this._captured = true;
    if (this.newCrop) page.crop = { ...this.newCrop };
    else delete page.crop;
    this.onUpdate();
  }

  undo() {
    const page = this.model.pages.find(p => p.id === this.pageId);
    if (!page || !this._captured) return;
    if (this.prevCrop) page.crop = { ...this.prevCrop };
    else delete page.crop;
    this.onUpdate();
  }
}
