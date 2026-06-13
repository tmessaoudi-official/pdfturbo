import { describe, it, expect, vi, afterEach } from 'vitest';
import { CleanupService, type ICleanupContext } from '../../src/core/cleanupService';
import { TextElement } from '../../src/elements/textElement';
import { ShapeElement } from '../../src/elements/shapeElement';
import type { PDFElement } from '../../src/elements/annotationElement';

vi.mock('../../src/utils/i18n', () => ({ t: (key: string) => key }));

afterEach(() => {
  document.body.innerHTML = '';
});

function makeCtx(elements: PDFElement[] = []): ICleanupContext & { elements: PDFElement[] } {
  const ctx = {
    elements,
    rebuildElementLayer: vi.fn(),
  } satisfies ICleanupContext;
  return Object.assign(ctx, { elements });
}

function mountInput(id: number): HTMLInputElement {
  const div = document.createElement('div');
  div.setAttribute('data-id', String(id));
  const input = document.createElement('input');
  div.appendChild(input);
  document.body.appendChild(div);
  return input;
}

describe('CleanupService.cleanEmptyTextElements', () => {
  it('removes an empty text element whose input is in the DOM but not focused', () => {
    const te = new TextElement(0, 0, 'p1');
    te.text = '';
    mountInput(te.id); // rendered but not focused
    const ctx = makeCtx([te]);
    new CleanupService(ctx).cleanEmptyTextElements();
    expect(ctx.elements.length).toBe(0);
  });

  it('calls rebuildElementLayer when elements are removed', () => {
    const te = new TextElement(0, 0, 'p1');
    te.text = '';
    mountInput(te.id);
    const ctx = makeCtx([te]);
    new CleanupService(ctx).cleanEmptyTextElements();
    expect(ctx.rebuildElementLayer).toHaveBeenCalledOnce();
  });

  it('keeps an empty text element whose input is focused (user still editing)', () => {
    const te = new TextElement(0, 0, 'p1');
    te.text = '';
    const input = mountInput(te.id);
    input.focus();
    const ctx = makeCtx([te]);
    new CleanupService(ctx).cleanEmptyTextElements();
    expect(ctx.elements.length).toBe(1);
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });

  it('keeps an empty text element that has no DOM input (not yet rendered — defensive)', () => {
    const te = new TextElement(0, 0, 'p1');
    te.text = '';
    // No DOM element created — element is not rendered
    const ctx = makeCtx([te]);
    new CleanupService(ctx).cleanEmptyTextElements();
    expect(ctx.elements.length).toBe(1);
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });

  it('keeps non-empty text elements', () => {
    const te = new TextElement(0, 0, 'p1');
    te.text = 'hello';
    mountInput(te.id);
    const ctx = makeCtx([te]);
    new CleanupService(ctx).cleanEmptyTextElements();
    expect(ctx.elements.length).toBe(1);
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });

  it('keeps non-text elements regardless of content', () => {
    const shape = new ShapeElement('rect', 0, 0, 100, 50, 'p1');
    const ctx = makeCtx([shape]);
    new CleanupService(ctx).cleanEmptyTextElements();
    expect(ctx.elements.length).toBe(1);
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });

  it('does not call rebuildElementLayer when nothing is removed', () => {
    const te = new TextElement(0, 0, 'p1');
    te.text = 'non-empty';
    const ctx = makeCtx([te]);
    new CleanupService(ctx).cleanEmptyTextElements();
    expect(ctx.rebuildElementLayer).not.toHaveBeenCalled();
  });
});
