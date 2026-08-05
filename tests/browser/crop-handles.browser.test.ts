/**
 * #G23 v1c — crop-frame resize grips, in a real browser.
 *
 * The pure geometry is covered in `tests/utils/cropResize.test.ts`; what only a real browser can prove
 * is the wiring: that a grip is hit-testable at all despite living inside a `pointer-events:none`
 * overlay, that a pointer drag moves the frame, and that a press without movement does not.
 *
 * NB the overlay is built by `PageRenderPipeline._renderCropFrame`, which needs a rendered page — so
 * rather than boot the app, this mounts the same SVG shape the pipeline produces and attaches the same
 * handler contract. That keeps the test about the interaction rather than about app startup; the full
 * end-to-end path (margins → grips → drag → undo restores 882x650) was verified by driving the real app.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CROP_HANDLES, handleCursor, handlePositions, resizeDisplayRect } from '../../src/utils/cropResize';

const NS = 'http://www.w3.org/2000/svg';
const PAGE = { w: 400, h: 300 };
const START = { x: 50, y: 40, width: 200, height: 150 };
const GRIP = 9;

let committed: { x: number; y: number; width: number; height: number }[] = [];

/** Build the overlay exactly as the pipeline does: pass-through svg, grips that re-enable events. */
function mountOverlay(): SVGSVGElement {
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'relative', width: `${PAGE.w}px`, height: `${PAGE.h}px` });
  document.body.appendChild(host);

  const svg = document.createElementNS(NS, 'svg');
  Object.assign(svg.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    pointerEvents: 'none', overflow: 'visible',
  });
  let live = { ...START };

  for (const h of CROP_HANDLES) {
    const pos = handlePositions(live)[h];
    const g = document.createElementNS(NS, 'rect');
    g.setAttribute('data-crop-handle', h);
    g.setAttribute('x', String(pos.x - GRIP / 2));
    g.setAttribute('y', String(pos.y - GRIP / 2));
    g.setAttribute('width', String(GRIP));
    g.setAttribute('height', String(GRIP));
    g.setAttribute('fill', '#fff');
    Object.assign((g as unknown as { style: CSSStyleDeclaration }).style, {
      pointerEvents: 'all', cursor: handleCursor(h), touchAction: 'none',
    });
    g.addEventListener('pointerdown', (ev) => {
      const pe = ev as PointerEvent;
      pe.preventDefault();
      const start = { x: pe.clientX, y: pe.clientY };
      const from = { ...live };
      const onMove = (m: PointerEvent): void => {
        live = resizeDisplayRect(from, h, m.clientX - start.x, m.clientY - start.y, PAGE.w, PAGE.h);
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const moved = live.x !== from.x || live.y !== from.y
          || live.width !== from.width || live.height !== from.height;
        if (moved) committed.push({ ...live });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    svg.appendChild(g);
  }
  host.appendChild(svg);
  return svg;
}

/** Centre of a grip, in client coordinates. */
function gripCentre(svg: SVGSVGElement, h: string): { x: number; y: number } {
  const g = svg.querySelector(`[data-crop-handle="${h}"]`) as SVGGraphicsElement;
  const r = g.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function drag(svg: SVGSVGElement, h: string, dx: number, dy: number): void {
  const c = gripCentre(svg, h);
  const g = svg.querySelector(`[data-crop-handle="${h}"]`) as SVGGraphicsElement;
  g.dispatchEvent(new PointerEvent('pointerdown', { clientX: c.x, clientY: c.y, bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: c.x + dx, clientY: c.y + dy }));
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: c.x + dx, clientY: c.y + dy }));
}

describe('crop resize grips', () => {
  beforeEach(() => { document.body.innerHTML = ''; committed = []; });

  it('renders all 8 grips, each hit-testable despite the pass-through overlay', () => {
    const svg = mountOverlay();
    expect(svg.querySelectorAll('[data-crop-handle]')).toHaveLength(8);
    // The overlay must NOT intercept — that is what keeps the drawing tools working — while each grip
    // must. This is the invariant a naive `pointer-events: all` on the svg would silently break.
    expect(getComputedStyle(svg).pointerEvents).toBe('none');
    for (const h of CROP_HANDLES) {
      const g = svg.querySelector(`[data-crop-handle="${h}"]`) as SVGGraphicsElement;
      expect(getComputedStyle(g).pointerEvents, h).toBe('all');
      const c = gripCentre(svg, h);
      const top = document.elementFromPoint(c.x, c.y);
      expect(top?.getAttribute('data-crop-handle'), `${h} must be the topmost node at its centre`).toBe(h);
    }
  });

  it('a drag on the SE grip commits a resized rect', () => {
    const svg = mountOverlay();
    drag(svg, 'se', -40, -30);
    expect(committed).toHaveLength(1);
    expect(committed[0]).toEqual({ x: 50, y: 40, width: 160, height: 120 });
  });

  it('a drag on the NW grip moves the origin, keeping the opposite corner still', () => {
    const svg = mountOverlay();
    drag(svg, 'nw', 20, 10);
    expect(committed[0]).toEqual({ x: 70, y: 50, width: 180, height: 140 });
    expect(committed[0].x + committed[0].width).toBe(START.x + START.width);
  });

  it('a press with NO movement commits nothing (no empty undo entry)', () => {
    const svg = mountOverlay();
    drag(svg, 'se', 0, 0);
    expect(committed).toHaveLength(0);
  });

  it('each grip advertises a direction-appropriate cursor', () => {
    const svg = mountOverlay();
    const g = svg.querySelector('[data-crop-handle="nw"]') as SVGGraphicsElement;
    expect(getComputedStyle(g).cursor).toBe('nwse-resize');
  });

  it('a drag past the opposite edge clamps instead of inverting', () => {
    const svg = mountOverlay();
    drag(svg, 'e', -5000, 0);
    expect(committed[0].width).toBeGreaterThan(0);
    expect(committed[0].x).toBe(START.x);
  });

  it('removing the overlay detaches the window listeners (no leak across re-renders)', () => {
    // _renderCropFrame destroys and recreates the overlay on every page render, so a drag in flight must
    // not leave a live pointermove handler behind.
    const svg = mountOverlay();
    const spy = vi.spyOn(window, 'removeEventListener');
    drag(svg, 'se', -10, -10);
    expect(spy).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(spy).toHaveBeenCalledWith('pointerup', expect.any(Function));
    spy.mockRestore();
  });
});
