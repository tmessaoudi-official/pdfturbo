/**
 * F-C C2 — DrawingHandler 'signRect' branch: a drag in the e-sign "Pick on page"
 * mode hands the drawn DISPLAY-space rect to app.onSignRectPicked (which maps it to
 * PDF user space + reopens the modal — covered separately). A tiny drag passes null.
 *
 * jsdom's getBoundingClientRect is all-zero, so the canvas rect is stubbed to give
 * the pointer real in-bounds coordinates.
 */
import { describe, it, expect, vi } from 'vitest';
import { DrawingHandler } from '../../src/handlers/drawingHandler';
import type { IAppContext } from '../../src/core/appContext';

function makeCtx() {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  (canvas as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
  const container = document.createElement('div');
  const onSignRectPicked = vi.fn(() => Promise.resolve());
  const ctx = {
    documentModel: { currentPage: { id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 } },
    mode: 'signRect',
    zoomScale: 1,
    effectiveFillColor: '#ffffff',
    ui: {
      canvas, container,
      colorInput: { value: '#000000' } as HTMLInputElement,
      shapeWidth: { value: '2' } as HTMLInputElement,
    },
    onSignRectPicked,
  } as unknown as IAppContext;
  return { ctx, onSignRectPicked };
}

function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y });
}

describe("DrawingHandler 'signRect' (F-C C2)", () => {
  it('hands the drawn display rect to onSignRectPicked', async () => {
    const { ctx, onSignRectPicked } = makeCtx();
    const h = new DrawingHandler(ctx);
    h.handlePointerDown(pointer('pointerdown', 50, 60));
    h.handlePointerMove(pointer('pointermove', 250, 200));
    await h.handlePointerUp(pointer('pointerup', 250, 200));
    expect(onSignRectPicked).toHaveBeenCalledWith({ x: 50, y: 60, width: 200, height: 140 });
  });

  it('passes null for a degenerate (tiny) drag so the modal still reopens', async () => {
    const { ctx, onSignRectPicked } = makeCtx();
    const h = new DrawingHandler(ctx);
    h.handlePointerDown(pointer('pointerdown', 50, 60));
    await h.handlePointerUp(pointer('pointerup', 51, 61)); // 1×1 → below threshold
    expect(onSignRectPicked).toHaveBeenCalledWith(null);
  });
});
