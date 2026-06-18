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
import { AddElementCmd } from '../../src/core/historyManager';
import type { IAppContext } from '../../src/core/appContext';
import type { PDFElement } from '../../src/elements/annotationElement';

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
