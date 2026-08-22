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
    // A press alone no longer engages the drag — it is deferred until the pointer moves
    // past _DRAG_THRESHOLD, for EVERY pointer type. See the click-suppression tests below.
    expect(h.isDragging).toBe(false);

    h.handlePointerMove(pointer('pointermove', 140, 130));
    expect(h.isDragging).toBe(true);
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

/**
 * The state machine behind the desktop click-to-select regression (c6bd71d).
 *
 * Engaging the drag on the bare pointerdown made `_finish()` rebuild the whole element
 * layer on pointerup even for a zero-movement click. That destroys the node which
 * received `mousedown`, and Chrome then dispatches NO click at all — so `selectElement`
 * never ran and an unselected element could not be selected or edited with a mouse.
 *
 * jsdom cannot show the click suppression itself (it does not model the
 * mousedown/mouseup common-ancestor rule) — that is
 * tests/browser/element-click-select.browser.test.ts. What jsdom CAN pin is the cause:
 * a press with no movement must leave the handler idle and must not rebuild the layer.
 */
describe('InteractionHandler — a press is not a drag until the pointer moves', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  const press = (pointerType: 'mouse' | 'touch') => {
    const canvas = makeCanvas();
    const { app, rebuildElementLayer, rerenderElement } = makeApp(canvas);
    const h = new InteractionHandler(app);
    const el = app.elements[0];
    const div = document.createElement('div');
    div.setPointerCapture = vi.fn();
    const down = new PointerEvent('pointerdown', { pointerId: 1, pointerType, clientX: 120, clientY: 120, bubbles: true });
    Object.defineProperty(down, 'target', { value: div });
    h.handlePointerDown(down, el, div);
    return { h, el, div, rebuildElementLayer, rerenderElement };
  };

  for (const pointerType of ['mouse', 'touch'] as const) {
    it(`${pointerType}: a press then release with no movement never engages a drag`, () => {
      const { h, el, rebuildElementLayer } = press(pointerType);

      expect(h.isDragging).toBe(false);

      h.handlePointerUp(new PointerEvent('pointerup', { pointerId: 1, pointerType, clientX: 120, clientY: 120 }));

      // The whole point: no teardown, so the mousedown target is still alive when
      // mouseup lands and the browser can dispatch the click.
      expect(rebuildElementLayer).not.toHaveBeenCalled();
      expect(h.isDragging).toBe(false);
      expect(el.x).toBe(100); // untouched
    });

    it(`${pointerType}: a sub-threshold wobble is still a click, not a drag`, () => {
      const { h, el, rebuildElementLayer } = press(pointerType);

      h.handlePointerMove(new PointerEvent('pointermove', { pointerId: 1, pointerType, clientX: 123, clientY: 122 }));
      expect(h.isDragging).toBe(false);

      h.handlePointerUp(new PointerEvent('pointerup', { pointerId: 1, pointerType, clientX: 123, clientY: 122 }));
      expect(rebuildElementLayer).not.toHaveBeenCalled();
      expect(el.x).toBe(100);
    });

    it(`${pointerType}: movement past the threshold does engage the drag and move the element`, () => {
      const { h, el, rebuildElementLayer } = press(pointerType);

      h.handlePointerMove(new PointerEvent('pointermove', { pointerId: 1, pointerType, clientX: 200, clientY: 180 }));
      expect(h.isDragging).toBe(true);

      h.handlePointerUp(new PointerEvent('pointerup', { pointerId: 1, pointerType, clientX: 200, clientY: 180 }));
      expect(el.x).not.toBe(100);
      expect(rebuildElementLayer).toHaveBeenCalledTimes(1);
    });
  }

  it('a MOUSE press on the text control is left to the browser (caret + text selection)', () => {
    const canvas = makeCanvas();
    const { app, rebuildElementLayer } = makeApp(canvas);
    const h = new InteractionHandler(app);
    const el = app.elements[0];
    const div = document.createElement('div');
    div.setPointerCapture = vi.fn();
    const input = document.createElement('textarea');
    div.appendChild(input);

    const down = new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 120, clientY: 120, bubbles: true });
    Object.defineProperty(down, 'target', { value: input });
    h.handlePointerDown(down, el, div);

    // Not even a pending drag: dragging the mouse inside a focused textarea must select
    // text, never move the box.
    h.handlePointerMove(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 220, clientY: 200 }));
    expect(h.isDragging).toBe(false);
    expect(el.x).toBe(100);
    expect(rebuildElementLayer).not.toHaveBeenCalled();
  });

  it('a TOUCH press on the text control still defers to the drag threshold', () => {
    const canvas = makeCanvas();
    const { app } = makeApp(canvas);
    const h = new InteractionHandler(app);
    const el = app.elements[0];
    const div = document.createElement('div');
    div.setPointerCapture = vi.fn();
    const input = document.createElement('textarea');
    div.appendChild(input);

    const down = new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 120, bubbles: true });
    Object.defineProperty(down, 'target', { value: input });
    h.handlePointerDown(down, el, div);
    expect(h.isDragging).toBe(false);

    h.handlePointerMove(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 180 }));
    expect(h.isDragging).toBe(true);   // c6bd71d's mobile drag-from-the-textbox behaviour
    expect(el.x).not.toBe(100);
  });
});
