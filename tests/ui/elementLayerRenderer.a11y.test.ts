import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock i18n: aria-label keys echo back so we can assert role/label wiring without
// depending on real translations. Real key resolution is covered by locale-sync.
vi.mock('../../src/utils/i18n', () => ({
  t: (key: string, opts?: Record<string, string | number>) =>
    opts ? `${key}:${JSON.stringify(opts)}` : key,
}));

import { ElementLayerRenderer, type IElementLayerContext } from '../../src/ui/elementLayerRenderer';
import type { PDFElement, ElementType } from '../../src/elements/annotationElement';

function makeElement(type: ElementType, id: number, pageId: string, extra: Record<string, unknown> = {}): PDFElement {
  const div = document.createElement('div');
  div.className = 'pdf-element';
  div.dataset.id = String(id);
  return {
    id,
    type,
    x: 0, y: 0, width: 10, height: 10,
    pageId,
    rotation: 0,
    render: () => div,
    ...extra,
  } as unknown as PDFElement;
}

function makeCtx(elements: PDFElement[]): IElementLayerContext {
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
    handleElementPointerDown: vi.fn(),
    handleElementClick: vi.fn(),
    handleCodeElementEdit: vi.fn(),
    handleTextInput: vi.fn(),
  };
}

describe('ElementLayerRenderer a11y (E1)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('rendered element exposes a role to assistive tech', () => {
    const el = makeElement('shape', 1, 'p1');
    const ctx = makeCtx([el]);
    new ElementLayerRenderer(ctx).rebuildElementLayer();
    const node = ctx.ui.container.querySelector('.pdf-element') as HTMLElement;
    expect(node).toBeTruthy();
    expect(node.getAttribute('role')).toBeTruthy();
  });

  it('rendered element is keyboard-focusable (tabindex=0)', () => {
    const el = makeElement('highlight', 2, 'p1');
    const ctx = makeCtx([el]);
    new ElementLayerRenderer(ctx).rebuildElementLayer();
    const node = ctx.ui.container.querySelector('.pdf-element') as HTMLElement;
    expect(node.getAttribute('tabindex')).toBe('0');
  });

  it('rendered element has a non-empty aria-label', () => {
    const el = makeElement('image', 3, 'p1');
    const ctx = makeCtx([el]);
    new ElementLayerRenderer(ctx).rebuildElementLayer();
    const node = ctx.ui.container.querySelector('.pdf-element') as HTMLElement;
    const label = node.getAttribute('aria-label') ?? '';
    expect(label).toBeTruthy();
    expect(label.length).toBeGreaterThan(0);
  });

  it('aria-label is derived from the element type via t()', () => {
    const el = makeElement('text', 4, 'p1');
    const ctx = makeCtx([el]);
    new ElementLayerRenderer(ctx).rebuildElementLayer();
    const node = ctx.ui.container.querySelector('.pdf-element') as HTMLElement;
    // mocked t() echoes the key; assert it routed through an element.aria.* key
    expect(node.getAttribute('aria-label')).toContain('element.aria');
  });
});
