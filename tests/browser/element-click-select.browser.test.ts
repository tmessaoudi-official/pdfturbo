/**
 * Click-to-select an annotation element — NATIVE mouse, in a real browser.
 *
 * WHY THIS FILE EXISTS: `c6bd71d` ("fix(mobile): element drag no longer scrolls the page
 * or lags") made `InteractionHandler.startDrag` engage on the very first `pointerdown`
 * with NO movement threshold for mouse, and made `_finish()` call
 * `rebuildElementLayer()` whenever `wasDragging` — which is true even for a
 * zero-movement click. `rebuildElementLayer()` destroys and recreates every
 * `.pdf-element` node (see ElementLayerRenderer), so the node that received `mousedown`
 * is DETACHED before `mouseup` lands.
 *
 * A mouse `click` is only dispatched when mousedown and mouseup share a live common
 * ancestor. Detaching the mousedown target therefore suppresses the click ENTIRELY —
 * measured in Chrome: zero click events on the element AND zero on the document. The
 * app's `div.addEventListener('click', … handleElementClick)` never runs, so
 * `selectElement` never runs, so an UNSELECTED element can never be selected, dragged
 * into focus, or edited with a mouse. A text box that had been deselected (Escape, page
 * navigation, or session restore) was permanently uneditable on desktop.
 *
 * TOUCH IS IMMUNE, which is why this shipped: a touch-derived click survives the same
 * node swap (measured: mouse 0 clicks, touch 1 click, identical DOM mutation), and the
 * touch path additionally defers drag start behind a 5px threshold. The bug was
 * desktop-only, and the guard therefore has to drive a REAL MOUSE.
 *
 * jsdom cannot reproduce any of this: it does not model the mousedown/mouseup common
 * ancestor rule, and a dispatched `click` runs regardless of what happened to the node.
 * `tests/handlers/interactionHandler.test.ts` guards the state machine that causes it
 * (a plain press must not engage a drag); this file guards the user-visible outcome.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { InteractionHandler } from '../../src/handlers/interactionHandler';
import type { IAppContext } from '../../src/core/appContext';
import type { PDFElement } from '../../src/elements/annotationElement';

interface Harness {
  handler: InteractionHandler;
  container: HTMLElement;
  element: PDFElement;
  selectSpy: ReturnType<typeof vi.fn>;
  rebuilds: () => number;
  node: () => HTMLDivElement;
  cleanup: () => void;
}

/**
 * Mirror the app's element-layer wiring closely enough to be faithful:
 * pointerdown → InteractionHandler, click → handleElementClick, and a
 * `rebuildElementLayer` that really does tear the node down and build a fresh one.
 */
function buildHarness(): Harness {
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed', top: '0', left: '0', width: '600px', height: '400px',
  });
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = 400;
  Object.assign(canvas.style, { position: 'absolute', top: '0', left: '0' });
  container.appendChild(canvas);
  document.body.appendChild(container);

  const element = {
    id: 1, type: 'text', x: 100, y: 100, width: 200, height: 60, rotation: 0, pageId: 'p1',
  } as unknown as PDFElement;

  const selectSpy = vi.fn();
  let rebuilds = 0;

  const wire = (div: HTMLDivElement): HTMLDivElement => {
    div.addEventListener('click', () => { selectSpy(); });
    div.addEventListener('pointerdown', (e) => { handler.handlePointerDown(e, element, div); });
    return div;
  };

  const build = (): HTMLDivElement => {
    const div = document.createElement('div');
    div.className = 'pdf-element text-element';
    div.dataset.elementId = '1';
    Object.assign(div.style, {
      position: 'absolute', left: `${element.x}px`, top: `${element.y}px`,
      width: `${element.width}px`, height: `${element.height}px`,
      background: 'rgba(37,99,235,0.1)', border: '2px dashed #2563eb', touchAction: 'none',
    });
    return wire(div);
  };

  container.appendChild(build());

  const app = {
    renderer: { canvas },
    zoomScale: 1,
    elements: [element],
    // The real thing: every node is removed and rebuilt (ElementLayerRenderer.rebuildElementLayer).
    rebuildElementLayer: () => {
      rebuilds++;
      container.querySelectorAll('.pdf-element').forEach(n => n.remove());
      container.appendChild(build());
    },
    rerenderElement: (el: PDFElement) => {
      const old = container.querySelector('.pdf-element') as HTMLElement | null;
      if (!old) return null;
      const fresh = build();
      Object.assign(fresh.style, { left: `${el.x}px`, top: `${el.y}px` });
      old.replaceWith(fresh);
      return fresh;
    },
    historyManager: { record: vi.fn() },
    autosave: vi.fn(),
  } as unknown as IAppContext;

  const handler = new InteractionHandler(app);

  const onUp = (e: PointerEvent): void => { handler.handlePointerUp(e); };
  const onMove = (e: PointerEvent): void => { handler.handlePointerMove(e); };
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointermove', onMove);

  return {
    handler, container, element, selectSpy,
    rebuilds: () => rebuilds,
    node: () => container.querySelector('.pdf-element') as HTMLDivElement,
    cleanup: () => {
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointermove', onMove);
      container.remove();
    },
  };
}

let h: Harness;
beforeEach(() => { h = buildHarness(); });
afterEach(() => { h.cleanup(); });

describe('click-to-select an element with a real mouse', () => {
  it('a plain click on an element dispatches click, so the app can select it', async () => {
    await userEvent.click(h.node());

    // The regression: the node was destroyed on pointerup, so Chrome dispatched no click
    // at all and selectElement never ran.
    expect(h.selectSpy).toHaveBeenCalledTimes(1);
  });

  it('a zero-movement press does not engage a drag, so the layer is not rebuilt', async () => {
    await userEvent.click(h.node());

    expect(h.handler.isDragging).toBe(false);
    expect(h.rebuilds()).toBe(0);
  });

  it('clicking twice in a row still selects both times (the node survives)', async () => {
    await userEvent.click(h.node());
    await userEvent.click(h.node());

    expect(h.selectSpy).toHaveBeenCalledTimes(2);
  });

  // `userEvent` has no pointer-drag primitive (`dragAndDrop` drives HTML5 drag events,
  // a different mechanism entirely), so the gesture is dispatched directly. This still
  // runs in real Chrome against real layout — which is the part jsdom cannot provide,
  // since its getBoundingClientRect is all-zero and setPointerCapture is a no-op.
  it('a real pointer DRAG still moves the element (the mobile fix is preserved)', () => {
    const node = h.node();
    const r = node.getBoundingClientRect();
    const startX = Math.round(r.left + r.width / 2);
    const startY = Math.round(r.top + r.height / 2);
    const move = (x: number, y: number): void => {
      document.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, bubbles: true,
      }));
    };

    node.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, pointerType: 'mouse', clientX: startX, clientY: startY, bubbles: true,
    }));
    for (let i = 1; i <= 6; i++) move(startX + (90 * i) / 6, startY + (40 * i) / 6);
    document.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, pointerType: 'mouse', clientX: startX + 90, clientY: startY + 40, bubbles: true,
    }));

    expect(h.element.x).not.toBe(100);
    expect(h.rebuilds()).toBeGreaterThan(0); // the post-gesture reconcile still happens
  });
});
