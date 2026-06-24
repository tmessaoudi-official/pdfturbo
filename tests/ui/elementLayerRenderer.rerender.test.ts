import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/i18n', () => ({
  t: (key: string, opts?: Record<string, string | number>) =>
    opts ? `${key}:${JSON.stringify(opts)}` : key,
}));

import { ElementLayerRenderer, type IElementLayerContext } from '../../src/ui/elementLayerRenderer';
import type { PDFElement, ElementType } from '../../src/elements/annotationElement';

// Each element's render() returns a FRESH node every call (mirrors the real
// elements, whose render() builds a new DOM node) so we can detect replacement.
function makeElement(type: ElementType, id: number, pageId: string): PDFElement {
  return {
    id,
    type,
    x: 0, y: 0, width: 10, height: 10,
    pageId,
    rotation: 0,
    render: () => {
      const div = document.createElement('div');
      div.className = 'pdf-element';
      return div as HTMLDivElement;
    },
  } as unknown as PDFElement;
}

function makeCtx(elements: PDFElement[], handlePointerDown = vi.fn()): IElementLayerContext {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  document.body.appendChild(container);
  return {
    elements,
    documentModel: { currentPage: { id: 'p1' } } as never,
    ui: { container, canvas } as never,
    inkLayer: {} as never,
    inkCanvas: document.createElement('canvas'),
    zoomScale: 1,
    mode: 'select',
    selectedElement: null,
    handleElementPointerDown: handlePointerDown,
    handleElementClick: vi.fn(),
    handleCodeElementEdit: vi.fn(),
    handleTextInput: vi.fn(),
  };
}

describe('ElementLayerRenderer.rerenderElement (Fix 2 — single-node re-render)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('replaces ONLY the target node and preserves the others as the SAME node instances', () => {
    const els = [makeElement('shape', 1, 'p1'), makeElement('text', 2, 'p1'), makeElement('image', 3, 'p1')];
    const renderer = new ElementLayerRenderer(makeCtx(els));
    renderer.rebuildElementLayer();
    const ctx = (renderer as unknown as { _ctx: IElementLayerContext })._ctx;
    const before = [...ctx.ui.container.querySelectorAll('.pdf-element')] as HTMLElement[];
    expect(before).toHaveLength(3);

    const newNode = renderer.rerenderElement(els[1]);
    const after = [...ctx.ui.container.querySelectorAll('.pdf-element')] as HTMLElement[];

    expect(after).toHaveLength(3);
    expect(after[0]).toBe(before[0]);            // untouched
    expect(after[2]).toBe(before[2]);            // untouched
    expect(after[1]).not.toBe(before[1]);        // replaced
    expect(after[1]).toBe(newNode);              // returns the fresh node
    expect(after[1].dataset.elementId).toBe('2'); // index/position preserved
  });

  it('the re-rendered node is fully wired (pointerdown reaches the handler)', () => {
    const onDown = vi.fn();
    const els = [makeElement('text', 7, 'p1')];
    const renderer = new ElementLayerRenderer(makeCtx(els, onDown));
    renderer.rebuildElementLayer();
    const newNode = renderer.rerenderElement(els[0]);
    expect(newNode).not.toBeNull();
    newNode?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onDown).toHaveBeenCalled();
  });

  it('returns null when the element has no current node', () => {
    const els = [makeElement('shape', 1, 'p1')];
    const renderer = new ElementLayerRenderer(makeCtx(els));
    renderer.rebuildElementLayer();
    const absent = makeElement('shape', 99, 'p1');
    expect(renderer.rerenderElement(absent)).toBeNull();
  });
});
