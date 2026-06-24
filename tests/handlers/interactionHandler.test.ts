import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteractionHandler } from '../../src/handlers/interactionHandler';
import type { IAppContext } from '../../src/core/appContext';
import type { PDFElement } from '../../src/elements/annotationElement';

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1000; c.height = 1000;
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0, toJSON() {} });
  return c;
}

function makeElement(): PDFElement {
  return { id: 1, type: 'image', x: 100, y: 100, width: 50, height: 50, rotation: 0, pageId: 'p1' } as unknown as PDFElement;
}

function makeApp(canvas: HTMLCanvasElement) {
  const rerenderElement = vi.fn((_el: PDFElement) => {
    const d = document.createElement('div');
    d.className = 'pdf-element';
    d.setPointerCapture = vi.fn();
    return d as HTMLDivElement;
  });
  const rebuildElementLayer = vi.fn();
  const app = {
    renderer: { canvas },
    zoomScale: 1,
    elements: [makeElement()],
    rerenderElement,
    rebuildElementLayer,
    historyManager: { record: vi.fn() },
    autosave: vi.fn(),
  } as unknown as IAppContext;
  return { app, rerenderElement, rebuildElementLayer };
}

function pointer(type: string, x: number, y: number, id = 1): PointerEvent {
  return new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true });
}

describe('InteractionHandler — single-node re-render during drag (Fix 2)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('drag uses rerenderElement per move (NOT a full rebuild) and rebuilds once on finish', () => {
    const canvas = makeCanvas();
    const { app, rerenderElement, rebuildElementLayer } = makeApp(canvas);
    const h = new InteractionHandler(app);
    const el = app.elements[0];
    const div = document.createElement('div');
    div.setPointerCapture = vi.fn();

    const down = pointer('pointerdown', 120, 120);
    Object.defineProperty(down, 'target', { value: div });
    h.handlePointerDown(down, el, div);
    expect(h.isDragging).toBe(true);

    h.handlePointerMove(pointer('pointermove', 140, 130));
    h.handlePointerMove(pointer('pointermove', 160, 150));
    h.handlePointerMove(pointer('pointermove', 180, 170));

    expect(rerenderElement).toHaveBeenCalledTimes(3);   // one per move
    expect(rebuildElementLayer).not.toHaveBeenCalled();  // no full teardown mid-drag

    h.handlePointerUp(pointer('pointerup', 180, 170));
    expect(rebuildElementLayer).toHaveBeenCalledTimes(1); // single reconcile on finish
    expect(el.x).not.toBe(100);                           // element actually moved
  });

  it('re-acquires pointer capture on the freshly rendered node each move', () => {
    const canvas = makeCanvas();
    const { app, rerenderElement } = makeApp(canvas);
    const h = new InteractionHandler(app);
    const el = app.elements[0];
    const div = document.createElement('div');
    div.setPointerCapture = vi.fn();

    const down = pointer('pointerdown', 120, 120);
    Object.defineProperty(down, 'target', { value: div });
    h.handlePointerDown(down, el, div);
    h.handlePointerMove(pointer('pointermove', 150, 150));

    const freshNode = rerenderElement.mock.results[0].value as HTMLDivElement;
    expect(freshNode.setPointerCapture).toHaveBeenCalledWith(1);
  });
});
