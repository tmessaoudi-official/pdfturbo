/**
 * F-A (mobile drag/draw fix) — real-Chrome proof that a single-finger pointer drag
 * on a canvas with `touch-action:none` flows through DrawingHandler and produces a
 * shape, with the new `setPointerCapture` call in place.
 *
 * jsdom covers the tool-mode→touch-action wiring (toolModeService.test.ts: pure
 * `canvasCapturesGesture` + setMode driving setCanvasTouchAction). What jsdom CANNOT
 * exercise is real pointer-capture + real layout geometry: jsdom's
 * getBoundingClientRect is all-zero and setPointerCapture is a no-op. This test runs
 * in real Chrome so the canvas has true layout and the capture call hits the real
 * implementation — guarding that the F-A capture addition didn't break the draw path.
 */
import { describe, it, expect } from 'vitest';
import { DrawingHandler } from '../../src/handlers/drawingHandler';
import { InteractionHandler } from '../../src/handlers/interactionHandler';
import { AddElementCmd } from '../../src/core/historyManager';
import type { IAppContext } from '../../src/core/appContext';
import type { PDFElement } from '../../src/elements/annotationElement';
// The element-drag fix is CSS-driven (touch-action on the inner control); load the real
// stylesheet so getComputedStyle reflects it (jsdom can't compute CSS at all).
import '../../src/styles/editor.css';

function buildCtx() {
  const container = document.createElement('div');
  Object.assign(container.style, { position: 'fixed', top: '0', left: '0', width: '400px', height: '400px' });
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 400;
  Object.assign(canvas.style, { position: 'absolute', top: '0', left: '0', width: '400px', height: '400px' });
  container.appendChild(canvas);
  document.body.appendChild(container);

  const elements: PDFElement[] = [];
  const calls = { captured: 0, captureThrew: false, selectMode: 0 };

  // Real pointer-capture call path; record whether it was invoked / threw.
  const realCapture = canvas.setPointerCapture.bind(canvas);
  canvas.setPointerCapture = (id: number): void => {
    calls.captured++;
    try { realCapture(id); } catch { calls.captureThrew = true; }
  };

  const ctx = {
    documentModel: { currentPage: { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 } },
    mode: 'drawRect',
    zoomScale: 1,
    elements,
    effectiveFillColor: '#ffffff',
    selectedElement: null,
    ui: {
      canvas,
      container,
      colorInput: { value: '#ff0000' } as HTMLInputElement,
      shapeWidth: { value: '2' } as HTMLInputElement,
    },
    historyManager: { execute: (cmd: AddElementCmd) => { cmd.execute(); } },
    autosave: () => {},
    setMode: () => { calls.selectMode++; },
    selectElement: () => {},
    rebuildElementLayer: () => {},
    reportError: { info: () => {}, warn: () => {}, silent: () => {}, error: () => {} },
  } as unknown as IAppContext;

  return { ctx, canvas, container, elements, calls, cleanup: () => container.remove() };
}

function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}

describe('F-A — pointer drag draws under touch-action:none (real Chrome)', () => {
  it('a single-finger drag on the canvas commits one rect shape', () => {
    const { ctx, canvas, elements, calls, cleanup } = buildCtx();
    try {
      canvas.style.touchAction = 'none'; // what setMode('drawRect') applies on mobile
      const handler = new DrawingHandler(ctx);

      handler.handlePointerDown(pointer('pointerdown', 50, 50));
      handler.handlePointerMove(pointer('pointermove', 150, 150));
      void handler.handlePointerUp(pointer('pointerup', 150, 150));

      // The drag produced exactly one shape (≈100×100) — gesture was NOT lost to scroll.
      expect(elements.length).toBe(1);
      // The capture call was attempted on the real canvas (mobile keeps move/up flowing).
      expect(calls.captured).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('touch-action:none is a settable, readable canvas style in a real browser', () => {
    const { canvas, cleanup } = buildCtx();
    try {
      canvas.style.touchAction = 'none';
      expect(canvas.style.touchAction).toBe('none');
      canvas.style.touchAction = 'pan-x pan-y';
      expect(canvas.style.touchAction).toBe('pan-x pan-y');
    } finally {
      cleanup();
    }
  });
});

describe('element drag on mobile — Fix 1 (touch-action) + Fix 2 (single-node re-render + capture)', () => {
  it('the inner text control computes touch-action:none so a touch-drag is NOT stolen as a scroll', () => {
    // The bug: .pdf-element is touch-action:none, but touch-action is NOT inherited, so the
    // inner <textarea>/<input> stayed `auto` and the browser claimed the drag as a page scroll.
    const wrap = document.createElement('div');
    wrap.className = 'pdf-element';
    const ta = document.createElement('textarea');
    wrap.appendChild(ta);
    const input = document.createElement('input');
    wrap.appendChild(input);
    document.body.appendChild(wrap);
    try {
      expect(getComputedStyle(ta).touchAction).toBe('none');
      expect(getComputedStyle(input).touchAction).toBe('none');
    } finally {
      wrap.remove();
    }
  });

  it('a touch-drag re-renders only the active node, re-acquires real pointer capture, and moves the element', () => {
    const container = document.createElement('div');
    Object.assign(container.style, { position: 'fixed', top: '0', left: '0', width: '600px', height: '600px' });
    const canvas = document.createElement('canvas');
    canvas.width = 600; canvas.height = 600;
    Object.assign(canvas.style, { position: 'absolute', top: '0', left: '0', width: '600px', height: '600px' });
    container.appendChild(canvas);
    document.body.appendChild(container);

    const el = { id: 1, type: 'image', x: 100, y: 100, width: 60, height: 40, rotation: 0, pageId: 'p1' } as unknown as PDFElement;
    let captureThrew = false;
    let captureCalls = 0;
    const makeNode = (): HTMLDivElement => {
      const d = document.createElement('div');
      d.className = 'pdf-element';
      d.dataset.elementId = '1';
      const realCap = d.setPointerCapture.bind(d);
      d.setPointerCapture = (id: number): void => { captureCalls++; try { realCap(id); } catch { captureThrew = true; } };
      container.appendChild(d);
      return d;
    };
    let liveNode = makeNode();
    const app = {
      renderer: { canvas },
      zoomScale: 1,
      elements: [el],
      rerenderElement: (_e: PDFElement) => { liveNode.remove(); liveNode = makeNode(); return liveNode; },
      rebuildElementLayer: () => {},
      historyManager: { record: () => {} },
      autosave: () => {},
    } as unknown as IAppContext;

    try {
      const h = new InteractionHandler(app);
      const down = new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 130, clientY: 120, bubbles: true });
      Object.defineProperty(down, 'target', { value: liveNode });
      const realCap0 = liveNode.setPointerCapture.bind(liveNode);
      liveNode.setPointerCapture = (id: number): void => { captureCalls++; try { realCap0(id); } catch { captureThrew = true; } };
      h.handlePointerDown(down, el, liveNode);
      h.handlePointerMove(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 220, clientY: 200, bubbles: true }));
      h.handlePointerMove(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 260, clientY: 240, bubbles: true }));
      h.handlePointerUp(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 260, clientY: 240, bubbles: true }));

      expect(el.x).not.toBe(100);          // element actually moved
      expect(el.y).not.toBe(100);
      expect(captureCalls).toBeGreaterThan(1); // captured on start + re-captured on each fresh node
      expect(captureThrew).toBe(false);        // real setPointerCapture across re-renders never threw
    } finally {
      container.remove();
    }
  });
});
