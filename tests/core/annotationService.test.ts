import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnnotationService, type IAnnotationContext } from '../../src/core/annotationService';
import { DocumentModel } from '../../src/core/documentModel';
import { HistoryManager, AddElementCmd, RemoveElementCmd, ClearAllCmd } from '../../src/core/historyManager';
import { TextElement } from '../../src/elements/textElement';
import type { PDFElement, ElementJSON } from '../../src/elements/annotationElement';

vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));

function makeCtx(overrides: Partial<IAnnotationContext> = {}): IAnnotationContext & {
  elements: PDFElement[];
  historyManager: HistoryManager;
  documentModel: DocumentModel;
} {
  const elements: PDFElement[] = [];
  const historyManager = new HistoryManager(50, vi.fn());
  const documentModel = new DocumentModel();
  const inkLayer = { hasAnyContent: vi.fn().mockReturnValue(false), clearAll: vi.fn() } as unknown as IAnnotationContext['inkLayer'];
  const reportError = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), silent: vi.fn() };

  const ctx: IAnnotationContext = {
    elements,
    historyManager,
    documentModel,
    inkLayer,
    reportError,
    selectedElement: null,
    clipboard: null,
    autosave: vi.fn(),
    rebuildElementLayer: vi.fn(),
    renderInkLayer: vi.fn(),
    updateFormattingToolbar: vi.fn(),
    updateCopyPasteBtns: vi.fn(),
    selectElement: vi.fn(),
    ...overrides,
  };
  return Object.assign(ctx, { elements, historyManager, documentModel });
}

function addBlankPage(doc: DocumentModel) {
  doc.addBlankPage(595, 842);
}

describe('AnnotationService.clearAll', () => {
  it('warns when there are no annotations and no ink', () => {
    const ctx = makeCtx();
    const svc = new AnnotationService(ctx);
    svc.clearAll();
    expect(ctx.reportError.warn).toHaveBeenCalledWith('toast.noAnnotationsToClear');
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });

  it('executes ClearAllCmd when elements exist', () => {
    const ctx = makeCtx();
    ctx.elements.push(new TextElement(0, 0, 'p1'));
    vi.spyOn(ctx.historyManager, 'execute');
    const svc = new AnnotationService(ctx);
    svc.clearAll();
    expect(ctx.historyManager.execute).toHaveBeenCalledWith(expect.any(ClearAllCmd));
  });

  it('clears selectedElement and rebuilds layer after clear', () => {
    const ctx = makeCtx();
    const el = new TextElement(0, 0, 'p1');
    ctx.elements.push(el);
    ctx.selectedElement = el;
    const svc = new AnnotationService(ctx);
    svc.clearAll();
    expect(ctx.selectedElement).toBeNull();
    expect(ctx.rebuildElementLayer).toHaveBeenCalled();
    expect(ctx.autosave).toHaveBeenCalled();
  });

  it('executes combined macro when both elements and ink exist', () => {
    const ctx = makeCtx({
      inkLayer: { hasAnyContent: vi.fn().mockReturnValue(true), clearAll: vi.fn(), getStrokes: vi.fn().mockReturnValue([]), toJSON: vi.fn().mockReturnValue({}) } as unknown as IAnnotationContext['inkLayer'],
    });
    ctx.elements.push(new TextElement(0, 0, 'p1'));
    vi.spyOn(ctx.historyManager, 'execute');
    const svc = new AnnotationService(ctx);
    svc.clearAll();
    expect(ctx.historyManager.execute).toHaveBeenCalledTimes(1);
  });
});

describe('AnnotationService.removeElement', () => {
  it('does nothing if element id is not found', () => {
    const ctx = makeCtx();
    vi.spyOn(ctx.historyManager, 'execute');
    const svc = new AnnotationService(ctx);
    svc.removeElement(9999);
    expect(ctx.historyManager.execute).not.toHaveBeenCalled();
  });

  it('executes RemoveElementCmd for the matching element', () => {
    const ctx = makeCtx();
    const el = new TextElement(0, 0, 'p1');
    ctx.elements.push(el);
    vi.spyOn(ctx.historyManager, 'execute');
    const svc = new AnnotationService(ctx);
    svc.removeElement(el.id);
    expect(ctx.historyManager.execute).toHaveBeenCalledWith(expect.any(RemoveElementCmd));
  });

  it('clears selectedElement when the removed element was selected', () => {
    const ctx = makeCtx();
    const el = new TextElement(0, 0, 'p1');
    ctx.elements.push(el);
    ctx.selectedElement = el;
    const svc = new AnnotationService(ctx);
    svc.removeElement(el.id);
    expect(ctx.selectedElement).toBeNull();
    expect(ctx.updateFormattingToolbar).toHaveBeenCalled();
  });

  it('calls rebuildElementLayer and autosave', () => {
    const ctx = makeCtx();
    const el = new TextElement(0, 0, 'p1');
    ctx.elements.push(el);
    const svc = new AnnotationService(ctx);
    svc.removeElement(el.id);
    expect(ctx.rebuildElementLayer).toHaveBeenCalled();
    expect(ctx.autosave).toHaveBeenCalled();
  });
});

describe('AnnotationService.copySelectedElement', () => {
  it('does nothing when no element is selected', () => {
    const ctx = makeCtx();
    const svc = new AnnotationService(ctx);
    svc.copySelectedElement();
    expect(ctx.clipboard).toBeNull();
    expect(ctx.updateCopyPasteBtns).not.toHaveBeenCalled();
  });

  it('sets clipboard to selected element JSON and shows toast', () => {
    const ctx = makeCtx();
    const el = new TextElement(10, 20, 'p1');
    ctx.selectedElement = el;
    const svc = new AnnotationService(ctx);
    svc.copySelectedElement();
    expect(ctx.clipboard).not.toBeNull();
    expect((ctx.clipboard as ElementJSON).type).toBe('text');
    expect(ctx.updateCopyPasteBtns).toHaveBeenCalled();
    expect(ctx.reportError.info).toHaveBeenCalledWith('toast.copied');
  });
});

describe('AnnotationService.pasteElement', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('does nothing when clipboard is empty', () => {
    const ctx = makeCtx();
    addBlankPage(ctx.documentModel);
    const svc = new AnnotationService(ctx);
    vi.spyOn(ctx.historyManager, 'execute');
    svc.pasteElement();
    expect(ctx.historyManager.execute).not.toHaveBeenCalled();
    expect(ctx.selectElement).not.toHaveBeenCalled();
  });

  it('does nothing when there is no current page', () => {
    const ctx = makeCtx();
    ctx.clipboard = { type: 'text', id: 1, x: 0, y: 0, width: 100, height: 40, pageId: 'p1', text: 'hi', fontSize: 16, color: '#000', fontFamily: 'Arial', bold: false, italic: false } as unknown as ElementJSON;
    const svc = new AnnotationService(ctx);
    svc.pasteElement();
    expect(ctx.selectElement).not.toHaveBeenCalled();
  });

  it('clones element with offset and pushes AddElementCmd', () => {
    const ctx = makeCtx();
    addBlankPage(ctx.documentModel);
    const el = new TextElement(50, 60, ctx.documentModel.pages[0].id);
    ctx.clipboard = el.toJSON() as ElementJSON;
    vi.spyOn(ctx.historyManager, 'execute');
    const svc = new AnnotationService(ctx);
    svc.pasteElement();
    expect(ctx.historyManager.execute).toHaveBeenCalledWith(expect.any(AddElementCmd));
    expect(ctx.selectElement).toHaveBeenCalled();
    expect(ctx.reportError.info).toHaveBeenCalledWith('toast.pastedUndo');
  });
});
