import { describe, it, expect, vi } from 'vitest';
import { FormattingService, type IFormattingContext } from '../../src/core/formattingService';
import { HistoryManager } from '../../src/core/historyManager';
import { TextElement } from '../../src/elements/textElement';
import { ShapeElement } from '../../src/elements/shapeElement';
import { RedactionElement } from '../../src/elements/redactionElement';
import type { PDFElement } from '../../src/elements/annotationElement';
import type { AppDOMRefs } from '../../src/ui/uiController';

vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));

function makeBtn(): HTMLButtonElement {
  return {
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn(), contains: vi.fn().mockReturnValue(false) },
    setAttribute: vi.fn(),
    disabled: false,
  } as unknown as HTMLButtonElement;
}

function makeUI() {
  return {
    boldBtn:        makeBtn(),
    italicBtn:      makeBtn(),
    underlineBtn:   makeBtn(),
    strikeBtn:      makeBtn(),
    fontSizeInput:  { value: '14', disabled: false } as unknown as HTMLInputElement,
    fillNoneBtn:    makeBtn(),
    fillColorInput: { value: '#ff0000', style: { opacity: '1' } } as unknown as HTMLInputElement,
    redactColorInput: { value: '#000000' } as unknown as HTMLInputElement,
  };
}

function makeCtx(selectedElement: PDFElement | null = null): IFormattingContext & {
  elements: PDFElement[];
  historyManager: HistoryManager;
  ui: ReturnType<typeof makeUI>;
} {
  const elements: PDFElement[] = [];
  const historyManager = new HistoryManager(50, vi.fn());
  const ui = makeUI();
  const ctx = {
    elements,
    historyManager,
    ui: ui as unknown as AppDOMRefs,
    mode: 'select' as const,
    selectedElement,
    rebuildElementLayer: vi.fn(),
    autosave: vi.fn(),
    syncFormattingUIDisplay: vi.fn(),
  } satisfies IFormattingContext;
  return Object.assign(ctx, { elements, historyManager, ui });
}

function makeTextCtx(opts?: Record<string, unknown>): {
  svc: FormattingService;
  te: TextElement;
  history: HistoryManager;
} {
  const te = new TextElement(0, 0, 'p1', opts);
  const ctx = makeCtx(te);
  return { svc: new FormattingService(ctx), te, history: ctx.historyManager };
}

function makeSelectableCtx(elements: PDFElement[]): {
  svc: FormattingService;
  setSelected: (el: PDFElement | null) => void;
  record: ReturnType<typeof vi.fn>;
} {
  let selected: PDFElement | null = elements[0] ?? null;
  const recordMock = vi.fn();
  const historyManager = new HistoryManager(50, vi.fn());
  historyManager.record = recordMock;
  const ui = makeUI();
  const ctx = {
    elements,
    historyManager,
    ui: ui as unknown as AppDOMRefs,
    mode: 'select' as const,
    get selectedElement() { return selected; },
    rebuildElementLayer: vi.fn(),
    autosave: vi.fn(),
    syncFormattingUIDisplay: vi.fn(),
  } satisfies IFormattingContext;
  return { svc: new FormattingService(ctx), setSelected: (el) => { selected = el; }, record: recordMock };
}

function makeShapeCtx(): {
  svc: FormattingService;
} {
  const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
  const ctx = makeCtx(shape);
  return { svc: new FormattingService(ctx) };
}

// ── toggleBold ─────────────────────────────────────────────────────────────

describe('FormattingService.toggleBold', () => {
  it('flips bold from false to true on a TextElement', () => {
    const te = new TextElement(0, 0, 'p1');
    expect(te.bold).toBe(false);
    const ctx = makeCtx(te);
    new FormattingService(ctx).toggleBold();
    expect(te.bold).toBe(true);
  });

  it('flips bold back to false on second call', () => {
    const te = new TextElement(0, 0, 'p1', { bold: true });
    const ctx = makeCtx(te);
    new FormattingService(ctx).toggleBold();
    expect(te.bold).toBe(false);
  });

  it('records a command so undo becomes available', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    expect(ctx.historyManager.canUndo()).toBe(false);
    new FormattingService(ctx).toggleBold();
    expect(ctx.historyManager.canUndo()).toBe(true);
  });

  it('calls rebuildElementLayer and autosave', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).toggleBold();
    expect(ctx.rebuildElementLayer).toHaveBeenCalledOnce();
    expect(ctx.autosave).toHaveBeenCalledOnce();
  });

  it('is a no-op when no element is selected', () => {
    const ctx = makeCtx(null);
    new FormattingService(ctx).toggleBold();
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });

  it('is a no-op when selected element is not text', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const ctx = makeCtx(shape);
    new FormattingService(ctx).toggleBold();
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });
});

// ── underline / strikethrough / alignment (Workstream C) ─────────────────────

describe('FormattingService.toggleUnderline / toggleStrikethrough / cycleAlign', () => {
  it('flips underline and records an undoable command', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).toggleUnderline();
    expect(te.underline).toBe(true);
    expect(ctx.historyManager.canUndo()).toBe(true);
    expect(ctx.rebuildElementLayer).toHaveBeenCalledOnce();
  });

  it('flips strikethrough on a TextElement', () => {
    const te = new TextElement(0, 0, 'p1', { strikethrough: true });
    new FormattingService(makeCtx(te)).toggleStrikethrough();
    expect(te.strikethrough).toBe(false);
  });

  it('cycles alignment left → center → right → left', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    const svc = new FormattingService(ctx);
    svc.cycleAlign(); expect(te.align).toBe('center');
    svc.cycleAlign(); expect(te.align).toBe('right');
    svc.cycleAlign(); expect(te.align).toBe('left');
  });

  it('underline/strike/align are no-ops without a text element', () => {
    const ctx = makeCtx(null);
    const svc = new FormattingService(ctx);
    svc.toggleUnderline(); svc.toggleStrikethrough(); svc.cycleAlign();
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });
});

// ── toggleItalic ───────────────────────────────────────────────────────────

describe('FormattingService.toggleItalic', () => {
  it('flips italic from false to true', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).toggleItalic();
    expect(te.italic).toBe(true);
  });

  it('is a no-op when no element is selected', () => {
    const ctx = makeCtx(null);
    new FormattingService(ctx).toggleItalic();
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });
});

// ── setFontSize ────────────────────────────────────────────────────────────

describe('FormattingService.setFontSize', () => {
  it('sets fontSize on a TextElement and rebuilds', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).setFontSize(24);
    expect(te.fontSize).toBe(24);
    expect(ctx.rebuildElementLayer).toHaveBeenCalled();
  });

  it('is a no-op for non-text elements', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const ctx = makeCtx(shape);
    new FormattingService(ctx).setFontSize(24);
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });
});

// ── adjustFontSize ─────────────────────────────────────────────────────────

describe('FormattingService.adjustFontSize', () => {
  it('increases fontSize by delta', () => {
    const te = new TextElement(0, 0, 'p1', { fontSize: 14 });
    const ctx = makeCtx(te);
    new FormattingService(ctx).adjustFontSize(2);
    expect(te.fontSize).toBe(16);
  });

  it('clamps to 72 max', () => {
    const te = new TextElement(0, 0, 'p1', { fontSize: 71 });
    const ctx = makeCtx(te);
    new FormattingService(ctx).adjustFontSize(10);
    expect(te.fontSize).toBe(72);
  });

  it('clamps to 8 min', () => {
    const te = new TextElement(0, 0, 'p1', { fontSize: 9 });
    const ctx = makeCtx(te);
    new FormattingService(ctx).adjustFontSize(-10);
    expect(te.fontSize).toBe(8);
  });

  it('updates fontSizeInput.value', () => {
    const te = new TextElement(0, 0, 'p1', { fontSize: 14 });
    const ctx = makeCtx(te);
    new FormattingService(ctx).adjustFontSize(4);
    expect(ctx.ui.fontSizeInput.value).toBe('18');
  });
});

// ── setFontFamily ──────────────────────────────────────────────────────────

describe('FormattingService.setFontFamily', () => {
  it('sets fontFamily on a TextElement', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).setFontFamily('Courier New');
    expect(te.fontFamily).toBe('Courier New');
  });

  it('records a command', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).setFontFamily('Courier New');
    expect(ctx.historyManager.canUndo()).toBe(true);
  });
});

// ── setElementColor ────────────────────────────────────────────────────────

describe('FormattingService.setElementColor', () => {
  it('sets color on a TextElement and records a command', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).setElementColor('#ff0000');
    expect(te.color).toBe('#ff0000');
    expect(ctx.historyManager.canUndo()).toBe(true);
  });

  it('sets strokeColor on a ShapeElement, records a command, and undo restores it', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const original = shape.strokeColor;
    const ctx = makeCtx(shape);
    ctx.elements.push(shape);
    new FormattingService(ctx).setElementColor('#00ff00');
    expect(shape.strokeColor).toBe('#00ff00');
    expect(ctx.historyManager.canUndo()).toBe(true);
    ctx.historyManager.undo();
    expect(shape.strokeColor).toBe(original);
  });

  it('sets color on a RedactionElement and records a command', () => {
    const re = new RedactionElement(0, 0, 100, 50, 'p1', '#000000');
    const ctx = makeCtx(re);
    new FormattingService(ctx).setElementColor('#ff0000');
    expect(re.color).toBe('#ff0000');
    expect(ctx.historyManager.canUndo()).toBe(true);
  });

  it('is a no-op when no element selected', () => {
    const ctx = makeCtx(null);
    new FormattingService(ctx).setElementColor('#ff0000');
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });
});

// ── fill controls ──────────────────────────────────────────────────────────

describe('FormattingService fill controls', () => {
  it('effectiveFillColor returns undefined when _noFill is true (default)', () => {
    const ctx = makeCtx(null);
    const svc = new FormattingService(ctx);
    expect(svc.effectiveFillColor).toBeUndefined();
  });

  it('effectiveFillColor returns fillColorInput.value after startFillColor()', () => {
    const ctx = makeCtx(null);
    ctx.ui.fillColorInput.value = '#abcdef';
    const svc = new FormattingService(ctx);
    svc.startFillColor();
    expect(svc.effectiveFillColor).toBe('#abcdef');
  });

  it('setFillNone() clears fillColor on a selected shape and records cmd', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1', { fillColor: '#ff0000' });
    const ctx = makeCtx(shape);
    const svc = new FormattingService(ctx);
    svc.setFillNone();
    expect(shape.fillColor).toBeUndefined();
    expect(ctx.historyManager.canUndo()).toBe(true);
  });

  it('setFillColor() sets fillColor on a selected shape and records cmd', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const ctx = makeCtx(shape);
    const svc = new FormattingService(ctx);
    svc.setFillColor('#aabbcc');
    expect(shape.fillColor).toBe('#aabbcc');
    expect(ctx.historyManager.canUndo()).toBe(true);
  });
});

// ── setRedactColor ─────────────────────────────────────────────────────────

describe('FormattingService.setRedactColor', () => {
  it('sets color on a RedactionElement and records cmd', () => {
    const re = new RedactionElement(0, 0, 100, 50, 'p1', '#000000');
    const ctx = makeCtx(re);
    new FormattingService(ctx).setRedactColor('#ff0000');
    expect(re.color).toBe('#ff0000');
    expect(ctx.historyManager.canUndo()).toBe(true);
  });

  it('is a no-op for non-redaction elements', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).setRedactColor('#ff0000');
    expect(ctx.historyManager.canUndo()).toBe(false);
  });
});

// ── setShapeStrokeWidth ────────────────────────────────────────────────────

describe('FormattingService.setShapeStrokeWidth', () => {
  it('sets strokeWidth on a ShapeElement and rebuilds', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const ctx = makeCtx(shape);
    new FormattingService(ctx).setShapeStrokeWidth(4);
    expect(shape.strokeWidth).toBe(4);
    expect(ctx.rebuildElementLayer).toHaveBeenCalled();
  });

  it('records a command so undo restores the previous strokeWidth', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const original = shape.strokeWidth;
    const ctx = makeCtx(shape);
    ctx.elements.push(shape);
    new FormattingService(ctx).setShapeStrokeWidth(8);
    expect(shape.strokeWidth).toBe(8);
    expect(ctx.historyManager.canUndo()).toBe(true);
    ctx.historyManager.undo();
    expect(shape.strokeWidth).toBe(original);
  });

  it('is a no-op for non-shape elements', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).setShapeStrokeWidth(4);
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });
});

// ── updateFormattingToolbar ────────────────────────────────────────────────

describe('FormattingService.updateFormattingToolbar', () => {
  it('calls syncFormattingUIDisplay', () => {
    const ctx = makeCtx(null);
    new FormattingService(ctx).updateFormattingToolbar();
    expect(ctx.syncFormattingUIDisplay).toHaveBeenCalledOnce();
  });

  it('syncs _noFill from selected fillable shape', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    shape.fillColor = '#ff0000';
    const ctx = makeCtx(shape);
    const svc = new FormattingService(ctx);
    svc.updateFormattingToolbar();
    expect(svc.effectiveFillColor).toBe(ctx.ui.fillColorInput.value);
  });

  it('sets _noFill=true when selected shape has no fillColor', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    shape.fillColor = undefined;
    const ctx = makeCtx(shape);
    ctx.ui.fillColorInput.value = '#ff0000';
    const svc = new FormattingService(ctx);
    svc.startFillColor();
    svc.updateFormattingToolbar();
    expect(svc.effectiveFillColor).toBeUndefined();
  });
});

// ── setAlign / setLineHeight / setTextOpacity / setTextBackground ──────────

describe('FormattingService.setAlign', () => {
  it('sets align on a TextElement and records a command', () => {
    const te = new TextElement(0, 0, 'p1', { align: 'left' });
    const ctx = makeCtx(te);
    new FormattingService(ctx).setAlign('right');
    expect(te.align).toBe('right');
    expect(ctx.historyManager.canUndo()).toBe(true);
  });

  it('is a no-op when no element is selected', () => {
    const ctx = makeCtx(null);
    new FormattingService(ctx).setAlign('center');
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });

  it('is a no-op when selected element is not text', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const ctx = makeCtx(shape);
    new FormattingService(ctx).setAlign('right');
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });
});

describe('FormattingService.setLineHeight', () => {
  it('sets lineHeight on a TextElement and records a command', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).setLineHeight(1.5);
    expect(te.lineHeight).toBe(1.5);
    expect(ctx.historyManager.canUndo()).toBe(true);
  });

  it('clamps to 3.0 max', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).setLineHeight(5);
    expect(te.lineHeight).toBe(3);
  });

  it('clamps to 1.0 min', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).setLineHeight(0.2);
    expect(te.lineHeight).toBe(1);
  });

  it('is a no-op for non-text elements', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const ctx = makeCtx(shape);
    new FormattingService(ctx).setLineHeight(2);
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });
});

describe('FormattingService.setTextOpacity', () => {
  it('sets opacity on a TextElement and records a command', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).setTextOpacity(0.5);
    expect(te.opacity).toBe(0.5);
    expect(ctx.historyManager.canUndo()).toBe(true);
  });

  it('clamps to 1 max', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).setTextOpacity(2);
    expect(te.opacity).toBe(1);
  });

  it('clamps to 0 min', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).setTextOpacity(-1);
    expect(te.opacity).toBe(0);
  });

  it('is a no-op for non-text elements', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const ctx = makeCtx(shape);
    new FormattingService(ctx).setTextOpacity(0.5);
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });
});

describe('FormattingService.setTextBackground / clearTextBackground', () => {
  it('sets backgroundColor on a TextElement and records a command', () => {
    const te = new TextElement(0, 0, 'p1');
    const ctx = makeCtx(te);
    new FormattingService(ctx).setTextBackground('#00ff00');
    expect(te.backgroundColor).toBe('#00ff00');
    expect(ctx.historyManager.canUndo()).toBe(true);
  });

  it('clears backgroundColor via clearTextBackground', () => {
    const te = new TextElement(0, 0, 'p1', { backgroundColor: '#ff0000' });
    const ctx = makeCtx(te);
    new FormattingService(ctx).clearTextBackground();
    expect(te.backgroundColor).toBeUndefined();
  });

  it('clearTextBackground is a no-op for non-text elements', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const ctx = makeCtx(shape);
    new FormattingService(ctx).clearTextBackground();
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });

  it('setTextBackground is a no-op for non-text elements', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const ctx = makeCtx(shape);
    new FormattingService(ctx).setTextBackground('#fff');
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });
});

// ── clearFormatting ────────────────────────────────────────────────────────

describe('FormattingService.clearFormatting', () => {
  it('clearFormatting resets fmt fields but keeps text, in one command', () => {
    const { svc, te, history } = makeTextCtx({
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      align: 'right',
      fontFamily: 'Times',
      fontSize: 30,
      color: '#ff0000',
    });
    te.text = 'keep me';
    te.lineHeight = 2;
    te.opacity = 0.5;
    te.backgroundColor = '#ff0';
    svc.clearFormatting();
    expect(te.text).toBe('keep me');
    expect(te.bold).toBe(false);
    expect(te.italic).toBe(false);
    expect(te.underline).toBe(false);
    expect(te.strikethrough).toBe(false);
    expect(te.align).toBe('left');
    expect(te.fontFamily).toBe('Arial');
    expect(te.fontSize).toBe(14);
    expect(te.color).toBe('#000000');
    expect(te.lineHeight).toBeUndefined();
    expect(te.opacity).toBeUndefined();
    expect(te.backgroundColor).toBeUndefined();
    expect(history.canUndo()).toBe(true);
  });

  it('is a no-op when no element is selected', () => {
    const ctx = makeCtx(null);
    const svc = new FormattingService(ctx);
    svc.clearFormatting();
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });

  it('is a no-op when selected element is not text', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const ctx = makeCtx(shape);
    const svc = new FormattingService(ctx);
    svc.clearFormatting();
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });
});

// ── transformCase ──────────────────────────────────────────────────────────

describe('FormattingService.transformCase', () => {
  it('rewrites the element text via one command', () => {
    const te = new TextElement(0, 0, 'p1');
    te.text = 'hello world';
    const ctx = makeCtx(te);
    ctx.elements.push(te);
    new FormattingService(ctx).transformCase('title');
    expect(te.text).toBe('Hello World');
    expect(ctx.historyManager.canUndo()).toBe(true);
  });

  it('applies uppercase', () => {
    const te = new TextElement(0, 0, 'p1');
    te.text = 'hello world';
    const ctx = makeCtx(te);
    new FormattingService(ctx).transformCase('upper');
    expect(te.text).toBe('HELLO WORLD');
  });

  it('applies lowercase', () => {
    const te = new TextElement(0, 0, 'p1');
    te.text = 'HELLO WORLD';
    const ctx = makeCtx(te);
    new FormattingService(ctx).transformCase('lower');
    expect(te.text).toBe('hello world');
  });

  it('is a no-op when text does not change', () => {
    const te = new TextElement(0, 0, 'p1');
    te.text = 'hello world';
    const ctx = makeCtx(te);
    new FormattingService(ctx).transformCase('lower');
    expect(ctx.historyManager.canUndo()).toBe(false);
  });

  it('is a no-op when no element is selected', () => {
    const ctx = makeCtx(null);
    new FormattingService(ctx).transformCase('title');
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });

  it('is a no-op when selected element is not text', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const ctx = makeCtx(shape);
    new FormattingService(ctx).transformCase('upper');
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });

  it('can undo/redo the case transformation', () => {
    const te = new TextElement(0, 0, 'p1');
    te.text = 'hello';
    const ctx = makeCtx(te);
    ctx.elements.push(te);
    const svc = new FormattingService(ctx);
    svc.transformCase('upper');
    expect(te.text).toBe('HELLO');
    ctx.historyManager.undo();
    expect(te.text).toBe('hello');
    ctx.historyManager.redo();
    expect(te.text).toBe('HELLO');
  });
});

// ── copyTextStyle / pasteTextStyle ─────────────────────────────────────────

describe('FormattingService.copyTextStyle / pasteTextStyle', () => {
  it('copyTextStyle then pasteTextStyle transfers formatting to another element', () => {
    const src = new TextElement(0, 0, 'p', { bold: true, fontSize: 22, color: '#ff0000', align: 'center' });
    const dst = new TextElement(0, 0, 'p');
    const { svc, setSelected, record } = makeSelectableCtx([src, dst]);
    setSelected(src);
    expect(svc.copyTextStyle()).toBe(true);
    expect(svc.painterArmed).toBe(true);
    setSelected(dst);
    svc.pasteTextStyle();
    expect(dst.bold).toBe(true);
    expect(dst.fontSize).toBe(22);
    expect(dst.color).toBe('#ff0000');
    expect(dst.align).toBe('center');
    expect(svc.painterArmed).toBe(false); // disarmed after paste
    expect(record).toHaveBeenCalledTimes(1); // copy is not a command, paste is
  });

  it('copyTextStyle returns false when selection is not text', () => {
    const { svc } = makeShapeCtx();
    expect(svc.copyTextStyle()).toBe(false);
    expect(svc.painterArmed).toBe(false);
  });

  it('cancelPainter disarms the painter', () => {
    const te = new TextElement(0, 0, 'p', { bold: true });
    const { svc, setSelected } = makeSelectableCtx([te]);
    setSelected(te);
    expect(svc.copyTextStyle()).toBe(true);
    expect(svc.painterArmed).toBe(true);
    svc.cancelPainter();
    expect(svc.painterArmed).toBe(false);
  });

  it('pasteTextStyle is a no-op when painter not armed', () => {
    const te = new TextElement(0, 0, 'p');
    const { svc, setSelected, record } = makeSelectableCtx([te]);
    setSelected(te);
    svc.pasteTextStyle();
    expect(record).not.toHaveBeenCalled();
  });

  it('pasteTextStyle is a no-op when target is not text', () => {
    const src = new TextElement(0, 0, 'p', { bold: true });
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const { svc, setSelected, record } = makeSelectableCtx([src, shape]);
    setSelected(src);
    svc.copyTextStyle();
    setSelected(shape);
    svc.pasteTextStyle();
    expect(record).toHaveBeenCalledTimes(0); // only copy is no-op here, paste is also no-op
    expect(svc.painterArmed).toBe(false); // disarmed even on no-op
  });

  it('pasteTextStyle copies all formatting attributes', () => {
    const src = new TextElement(0, 0, 'p', {
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      align: 'right',
      fontFamily: 'Courier New',
      fontSize: 18,
      color: '#00ff00',
      lineHeight: 1.5,
      opacity: 0.7,
      backgroundColor: '#ffff00',
    });
    const dst = new TextElement(0, 0, 'p');
    const { svc, setSelected } = makeSelectableCtx([src, dst]);
    setSelected(src);
    svc.copyTextStyle();
    setSelected(dst);
    svc.pasteTextStyle();
    expect(dst.bold).toBe(true);
    expect(dst.italic).toBe(true);
    expect(dst.underline).toBe(true);
    expect(dst.strikethrough).toBe(true);
    expect(dst.align).toBe('right');
    expect(dst.fontFamily).toBe('Courier New');
    expect(dst.fontSize).toBe(18);
    expect(dst.color).toBe('#00ff00');
    expect(dst.lineHeight).toBe(1.5);
    expect(dst.opacity).toBe(0.7);
    expect(dst.backgroundColor).toBe('#ffff00');
  });
});
