import { describe, it, expect, vi } from 'vitest';
import { UndoRedoController, type IUndoRedoContext } from '../../src/core/undoRedoController';
import { HistoryManager, TextEditCmd } from '../../src/core/historyManager';
import { TextElement } from '../../src/elements/textElement';
import { CommentElement } from '../../src/elements/commentElement';
import type { PDFElement } from '../../src/elements/annotationElement';
import type { IErrorReporter } from '../../src/core/errorReporter';

vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));

function makeReporter(): IErrorReporter {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as IErrorReporter;
}

function makeCtx(): IUndoRedoContext & {
  elements: PDFElement[];
  historyManager: HistoryManager;
} {
  const elements: PDFElement[] = [];
  const historyManager = new HistoryManager(50, vi.fn());
  const ctx = {
    elements,
    historyManager,
    formValues: {} as Record<string, Record<string, string>>,
    reportError: makeReporter(),
    setSelectedElement: vi.fn(),
    renderCurrentPage: vi.fn().mockResolvedValue(undefined),
    rebuildElementLayer: vi.fn(),
    updateActiveThumbnail: vi.fn(),
    updatePageInfo: vi.fn(),
    updateFormattingToolbar: vi.fn(),
    autosave: vi.fn(),
  } satisfies IUndoRedoContext;
  return Object.assign(ctx, { elements, historyManager });
}

// ── handleTextInput ────────────────────────────────────────────────────────

describe('UndoRedoController.handleTextInput', () => {
  it('updates element.text immediately', () => {
    vi.useFakeTimers();
    const te = new TextElement(0, 0, 'p1');
    te.text = 'hello';
    const ctx = makeCtx();
    ctx.elements.push(te);
    new UndoRedoController(ctx).handleTextInput(te, { value: 'world' } as HTMLInputElement);
    expect(te.text).toBe('world');
    vi.useRealTimers();
  });

  it('records a TextEditCmd after the 500ms debounce', () => {
    vi.useFakeTimers();
    const te = new TextElement(0, 0, 'p1');
    te.text = 'before';
    const ctx = makeCtx();
    ctx.elements.push(te);
    const ctrl = new UndoRedoController(ctx);
    ctrl.handleTextInput(te, { value: 'after' } as HTMLInputElement);
    expect(ctx.historyManager.canUndo()).toBe(false);
    vi.advanceTimersByTime(500);
    expect(ctx.historyManager.canUndo()).toBe(true);
    vi.useRealTimers();
  });

  it('does NOT record a command when text is unchanged', () => {
    vi.useFakeTimers();
    const te = new TextElement(0, 0, 'p1');
    te.text = 'same';
    const ctx = makeCtx();
    ctx.elements.push(te);
    new UndoRedoController(ctx).handleTextInput(te, { value: 'same' } as HTMLInputElement);
    vi.advanceTimersByTime(500);
    expect(ctx.historyManager.canUndo()).toBe(false);
    vi.useRealTimers();
  });

  it('calls autosave after the debounce fires', () => {
    vi.useFakeTimers();
    const te = new TextElement(0, 0, 'p1');
    te.text = 'a';
    const ctx = makeCtx();
    ctx.elements.push(te);
    const ctrl = new UndoRedoController(ctx);
    ctrl.handleTextInput(te, { value: 'b' } as HTMLInputElement);
    vi.advanceTimersByTime(500);
    expect(ctx.autosave).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('captures the original text on first call per element', () => {
    vi.useFakeTimers();
    const te = new TextElement(0, 0, 'p1');
    te.text = 'original';
    const ctx = makeCtx();
    ctx.elements.push(te);
    const ctrl = new UndoRedoController(ctx);
    ctrl.handleTextInput(te, { value: 'step1' } as HTMLInputElement);
    ctrl.handleTextInput(te, { value: 'step2' } as HTMLInputElement);
    vi.advanceTimersByTime(500);
    // Undo should restore to 'original', not 'step1'
    ctx.historyManager.undo();
    expect(te.text).toBe('original');
    vi.useRealTimers();
  });

  it('records a TextEditCmd for a CommentElement edit, and undo restores its text', () => {
    vi.useFakeTimers();
    const c = new CommentElement(0, 0, 'p1', { text: 'before' });
    const ctx = makeCtx();
    ctx.elements.push(c);
    const ctrl = new UndoRedoController(ctx);
    ctrl.handleTextInput(c, { value: 'after' } as HTMLTextAreaElement);
    expect(c.text).toBe('after');
    expect(ctx.historyManager.canUndo()).toBe(false);
    vi.advanceTimersByTime(500);
    expect(ctx.historyManager.canUndo()).toBe(true);
    ctx.historyManager.undo();
    expect(c.text).toBe('before');
    vi.useRealTimers();
  });

  it('resets pending state when switching to a different element', () => {
    vi.useFakeTimers();
    const te1 = new TextElement(0, 0, 'p1');
    te1.text = 'first';
    const te2 = new TextElement(10, 10, 'p1');
    te2.text = 'second';
    const ctx = makeCtx();
    ctx.elements.push(te1, te2);
    const ctrl = new UndoRedoController(ctx);
    ctrl.handleTextInput(te1, { value: 'first-edited' } as HTMLInputElement);
    ctrl.handleTextInput(te2, { value: 'second-edited' } as HTMLInputElement);
    vi.advanceTimersByTime(500);
    // Only te2's debounce fires (te1's timer was replaced)
    expect(ctx.historyManager.canUndo()).toBe(true);
    vi.useRealTimers();
  });
});

// ── undo ──────────────────────────────────────────────────────────────────

describe('UndoRedoController.undo', () => {
  it('is a no-op when history is empty', () => {
    const ctx = makeCtx();
    new UndoRedoController(ctx).undo();
    expect(ctx.setSelectedElement).not.toHaveBeenCalled();
    expect(ctx.renderCurrentPage).not.toHaveBeenCalled();
  });

  it('calls setSelectedElement(null) after undo', () => {
    const ctx = makeCtx();
    const te = new TextElement(0, 0, 'p1');
    ctx.elements.push(te);
    ctx.historyManager.record(new TextEditCmd(ctx.elements, te.id, 'a', 'b'));
    new UndoRedoController(ctx).undo();
    expect(ctx.setSelectedElement).toHaveBeenCalledWith(null);
  });

  it('calls renderCurrentPage after undo', () => {
    const ctx = makeCtx();
    const te = new TextElement(0, 0, 'p1');
    ctx.elements.push(te);
    ctx.historyManager.record(new TextEditCmd(ctx.elements, te.id, 'a', 'b'));
    new UndoRedoController(ctx).undo();
    expect(ctx.renderCurrentPage).toHaveBeenCalled();
  });

  it('calls updateFormattingToolbar after undo', () => {
    const ctx = makeCtx();
    const te = new TextElement(0, 0, 'p1');
    ctx.elements.push(te);
    ctx.historyManager.record(new TextEditCmd(ctx.elements, te.id, 'a', 'b'));
    new UndoRedoController(ctx).undo();
    expect(ctx.updateFormattingToolbar).toHaveBeenCalled();
  });

  it('calls autosave after undo', () => {
    const ctx = makeCtx();
    const te = new TextElement(0, 0, 'p1');
    ctx.elements.push(te);
    ctx.historyManager.record(new TextEditCmd(ctx.elements, te.id, 'a', 'b'));
    new UndoRedoController(ctx).undo();
    expect(ctx.autosave).toHaveBeenCalled();
  });

  it('cancels a pending text-edit debounce before executing undo', () => {
    vi.useFakeTimers();
    const ctx = makeCtx();
    const te = new TextElement(0, 0, 'p1');
    te.text = 'original';
    ctx.elements.push(te);
    ctx.historyManager.record(new TextEditCmd(ctx.elements, te.id, 'x', 'y'));
    const ctrl = new UndoRedoController(ctx);
    ctrl.handleTextInput(te, { value: 'typed' } as HTMLInputElement);
    ctrl.undo(); // must cancel the pending timer
    const autosaveCalls = (ctx.autosave as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.advanceTimersByTime(500);
    // No additional autosave call from the cancelled debounce
    expect(ctx.autosave).toHaveBeenCalledTimes(autosaveCalls);
    vi.useRealTimers();
  });
});

// ── redo ──────────────────────────────────────────────────────────────────

describe('UndoRedoController.redo', () => {
  it('is a no-op when nothing to redo', () => {
    const ctx = makeCtx();
    new UndoRedoController(ctx).redo();
    expect(ctx.setSelectedElement).not.toHaveBeenCalled();
    expect(ctx.renderCurrentPage).not.toHaveBeenCalled();
  });

  it('calls setSelectedElement(null) after redo', () => {
    const ctx = makeCtx();
    const te = new TextElement(0, 0, 'p1');
    ctx.elements.push(te);
    ctx.historyManager.record(new TextEditCmd(ctx.elements, te.id, 'a', 'b'));
    ctx.historyManager.undo();
    new UndoRedoController(ctx).redo();
    expect(ctx.setSelectedElement).toHaveBeenCalledWith(null);
  });

  it('calls updateFormattingToolbar and autosave after redo', () => {
    const ctx = makeCtx();
    const te = new TextElement(0, 0, 'p1');
    ctx.elements.push(te);
    ctx.historyManager.record(new TextEditCmd(ctx.elements, te.id, 'a', 'b'));
    ctx.historyManager.undo();
    new UndoRedoController(ctx).redo();
    expect(ctx.updateFormattingToolbar).toHaveBeenCalled();
    expect(ctx.autosave).toHaveBeenCalled();
  });

  it('cancels a pending text-edit debounce before executing redo', () => {
    vi.useFakeTimers();
    const ctx = makeCtx();
    const te = new TextElement(0, 0, 'p1');
    te.text = 'original';
    ctx.elements.push(te);
    ctx.historyManager.record(new TextEditCmd(ctx.elements, te.id, 'x', 'y'));
    ctx.historyManager.undo();
    const ctrl = new UndoRedoController(ctx);
    ctrl.handleTextInput(te, { value: 'typed' } as HTMLInputElement);
    ctrl.redo();
    const autosaveCalls = (ctx.autosave as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(ctx.autosave).toHaveBeenCalledTimes(autosaveCalls);
    vi.useRealTimers();
  });
});

// ── handleFormInput (QA-2026-06-23 P1: form fills must be undoable) ──────────

describe('UndoRedoController.handleFormInput', () => {
  it('sets the form value immediately (live), before the debounce', () => {
    vi.useFakeTimers();
    const ctx = makeCtx();
    new UndoRedoController(ctx).handleFormInput('s1', 'Name', 'Alice');
    expect(ctx.formValues.s1.Name).toBe('Alice');
    vi.useRealTimers();
  });

  it('records ONE command after the 500ms debounce and undo restores the original', () => {
    vi.useFakeTimers();
    const ctx = makeCtx();
    const ctrl = new UndoRedoController(ctx);
    // simulate typing keystrokes into the same field
    ctrl.handleFormInput('s1', 'Name', 'A');
    ctrl.handleFormInput('s1', 'Name', 'Al');
    ctrl.handleFormInput('s1', 'Name', 'Ali');
    expect(ctx.historyManager.canUndo()).toBe(false); // not yet recorded
    vi.advanceTimersByTime(500);
    expect(ctx.historyManager.canUndo()).toBe(true);
    ctx.historyManager.undo();
    expect(ctx.formValues.s1?.Name ?? '').toBe(''); // back to original (empty)
    ctx.historyManager.redo();
    expect(ctx.formValues.s1.Name).toBe('Ali');
    vi.useRealTimers();
  });

  it('does NOT record when the value is unchanged', () => {
    vi.useFakeTimers();
    const ctx = makeCtx();
    ctx.formValues.s1 = { Name: 'same' };
    new UndoRedoController(ctx).handleFormInput('s1', 'Name', 'same');
    vi.advanceTimersByTime(500);
    expect(ctx.historyManager.canUndo()).toBe(false);
    vi.useRealTimers();
  });

  it('undo() FLUSHES an in-flight form edit (not silently discarded) and then reverts it', () => {
    vi.useFakeTimers();
    const ctx = makeCtx();
    const ctrl = new UndoRedoController(ctx);
    ctrl.handleFormInput('s1', 'Name', 'typed'); // pending, timer not yet fired
    ctrl.undo(); // should flush (record) then undo → value reverts to original
    expect(ctx.formValues.s1?.Name ?? '').toBe('');
    vi.useRealTimers();
  });

  it('switching to a different field flushes the previous field as its own command', () => {
    vi.useFakeTimers();
    const ctx = makeCtx();
    const ctrl = new UndoRedoController(ctx);
    ctrl.handleFormInput('s1', 'First', 'Ann');
    ctrl.handleFormInput('s1', 'Last', 'Bee'); // different field → flush First
    vi.advanceTimersByTime(500); // flush Last
    // two independent undoable commands
    ctx.historyManager.undo();
    expect(ctx.formValues.s1.Last).toBe('');
    expect(ctx.formValues.s1.First).toBe('Ann');
    ctx.historyManager.undo();
    expect(ctx.formValues.s1.First).toBe('');
    vi.useRealTimers();
  });
});
