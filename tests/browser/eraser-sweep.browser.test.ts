/**
 * Eraser swept-region regression (2026-06-23 QA P2).
 *
 * The old `splitFreehandAtErase` deleted any sub-stroke whose centroid fell
 * inside the eraser's full AABB — so a tall/diagonal erase wiped freehand
 * ShapeElements it never physically swept. The fix models the eraser as its
 * polyline dilated by a radius and removes only what falls inside that region.
 *
 * This drives the REAL `EraserHandler` with real PointerEvents + the real
 * command stack (jsdom has no PointerEvent), covering the handler→geometry→
 * radius integration. Pure geometry is unit-tested in tests/utils/eraserGeometry.
 */
import { describe, it, expect } from 'vitest';
import { EraserHandler } from '../../src/handlers/eraserHandler';
import { HistoryManager } from '../../src/core/historyManager';
import { ShapeElement } from '../../src/elements/shapeElement';
import type { IAppContext } from '../../src/core/appContext';
import type { PDFElement } from '../../src/elements/annotationElement';

function makeHorizontalStroke(
  pageId: string, x0: number, x1: number, y: number, color: string,
): ShapeElement {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 40; i++) pts.push({ x: x0 + ((x1 - x0) * i) / 40, y });
  return new ShapeElement('freehand', x0, y - 2, x1 - x0, 4, pageId,
    { strokeColor: color, strokeWidth: 2, points: pts });
}

function buildApp(elements: PDFElement[]) {
  // Isolate each test's canvas at the viewport origin so getBoundingClientRect
  // is a known {0,0,600,800} and clientX/Y map 1:1 to element space. (Appending
  // multiple containers would stack them and shift later rects off-screen, which
  // makes the handler's in-bounds check silently reject every sweep.)
  document.body.innerHTML = '';
  document.body.style.margin = '0';
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = 800;
  Object.assign(canvas.style, { position: 'fixed', left: '0', top: '0', width: '600px', height: '800px' });
  const container = document.createElement('div');
  container.appendChild(canvas);
  document.body.appendChild(container);
  const history = new HistoryManager(50, () => {});
  const ctx = {
    mode: 'drawErase',
    elements,
    documentModel: { currentPage: { id: 'p1' } },
    ui: { canvas, container },
    zoomScale: 1,
    historyManager: history,
    autosave: () => {},
    rebuildElementLayer: () => {},
  } as unknown as IAppContext;
  return { ctx, canvas };
}

/** Drive the handler through a polyline of pointer positions (CSS px). */
function eraseAlong(handler: EraserHandler, path: Array<[number, number]>): void {
  const opts = (x: number, y: number) =>
    ({ pointerId: 1, clientX: x, clientY: y, bubbles: true });
  handler.handlePointerDown(new PointerEvent('pointerdown', opts(path[0][0], path[0][1])));
  for (let i = 1; i < path.length; i++) {
    handler.handlePointerMove(new PointerEvent('pointermove', opts(path[i][0], path[i][1])));
  }
  const last = path[path.length - 1];
  handler.handlePointerUp(new PointerEvent('pointerup', opts(last[0], last[1])));
}

const freehands = (els: PDFElement[]) =>
  els.filter((e) => (e as ShapeElement).shapeType === 'freehand') as ShapeElement[];

describe('EraserHandler — swept-region erase', () => {
  it('splits a stroke transversally into two when crossed once', () => {
    const elements: PDFElement[] = [makeHorizontalStroke('p1', 50, 550, 300, '#1d4ed8')];
    const { ctx } = buildApp(elements);
    const handler = new EraserHandler(ctx);
    // a short vertical sweep straight across the stroke at x≈300
    eraseAlong(handler, [[300, 280], [300, 290], [300, 300], [300, 310], [300, 320]]);

    const segs = freehands(elements);
    expect(segs.length).toBe(2);
    const spans = segs.map((s) => [s.x, s.x + s.width]).sort((a, b) => a[0] - b[0]);
    expect(spans[0][0]).toBeLessThan(290);          // left tail starts near the origin
    expect(spans[1][1]).toBeGreaterThan(540);        // right tail reaches the end
    expect(spans[0][1]).toBeLessThan(spans[1][0]);   // a real gap between them
  });

  it('does NOT over-delete the middle a tall ∏ erase never swept', () => {
    const elements: PDFElement[] = [makeHorizontalStroke('p1', 50, 550, 400, '#dc2626')];
    const { ctx } = buildApp(elements);
    const handler = new EraserHandler(ctx);
    // ∏ tent: down→up at x=120, far above the stroke, down at x=480.
    // AABB spans x[120,480], y[150,430] — covers the whole stroke — but the
    // path only passes near the two ends. Old AABB model deleted everything.
    const path: Array<[number, number]> = [];
    path.push([120, 430]);
    for (let y = 425; y >= 150; y -= 10) path.push([120, y]);   // up through stroke at x=120
    for (let x = 120; x <= 480; x += 12) path.push([x, 150]);    // across, far above
    for (let y = 150; y <= 430; y += 10) path.push([480, y]);    // down through stroke at x=480
    eraseAlong(handler, path);

    const segs = freehands(elements);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    // the big middle (x≈200..380) survives — the headline fix
    const middleSurvives = segs.some((s) => s.x < 380 && s.x + s.width > 200);
    expect(middleSurvives).toBe(true);
  });

  it('deletes the whole stroke when the eraser sweeps right along it', () => {
    const elements: PDFElement[] = [makeHorizontalStroke('p1', 50, 250, 300, '#16a34a')];
    const { ctx } = buildApp(elements);
    const handler = new EraserHandler(ctx);
    // sweep directly along the stroke, end to end
    const path: Array<[number, number]> = [];
    for (let x = 40; x <= 260; x += 8) path.push([x, 300]);
    eraseAlong(handler, path);

    expect(freehands(elements).length).toBe(0);
  });
});
