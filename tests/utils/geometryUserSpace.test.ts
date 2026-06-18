/**
 * F-C C2 — displayRectToUserSpaceRect: drawn-on-page rect (display space, y-down)
 * → e-signature appearance rect in PDF user space (y-up, bottom-left), clamped.
 */
import { describe, it, expect } from 'vitest';
import { displayRectToUserSpaceRect } from '../../src/utils/geometry';

const W = 600, H = 800;

describe('displayRectToUserSpaceRect (F-C C2)', () => {
  it('rotation 0 — flips Y to bottom-left origin, keeps X/size', () => {
    const r = displayRectToUserSpaceRect({ x: 100, y: 100, width: 200, height: 50 }, W, H, 0);
    expect(r).toEqual({ x: 100, y: H - (100 + 50), width: 200, height: 50 }); // y = 650
  });

  it('a box at the display top-left maps near the page top (high Y)', () => {
    const r = displayRectToUserSpaceRect({ x: 0, y: 0, width: 80, height: 40 }, W, H, 0);
    expect(r.x).toBe(0);
    expect(r.y).toBe(H - 40); // 760 — top of page in user space
    expect(r.width).toBe(80);
    expect(r.height).toBe(40);
  });

  it('a box at the display bottom maps near Y=0', () => {
    const r = displayRectToUserSpaceRect({ x: 10, y: H - 40, width: 50, height: 40 }, W, H, 0);
    expect(r.y).toBe(0);
  });

  it('clamps an over-page drag into the page box', () => {
    const r = displayRectToUserSpaceRect({ x: -20, y: -20, width: W + 100, height: H + 100 }, W, H, 0);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(W);
    expect(r.height).toBe(H);
  });

  it('rotation 180 — mirrors X, and the display top-left lands in the user-space bottom', () => {
    const r = displayRectToUserSpaceRect({ x: 100, y: 100, width: 200, height: 50 }, W, H, 180);
    // 180°: content x = W-(x+w) = 300; content y-down (top) = H-(y+h)... corners →
    // y-down band [650,700] → user y = H-(650+50) = 100 (low Y = bottom of page).
    expect(r.x).toBe(300);
    expect(r.y).toBe(100);
    expect(r.width).toBe(200);
    expect(r.height).toBe(50);
  });
});
