/**
 * #G23 v1c — crop-frame resize geometry. Pure, so every clamp and inversion case is pinned here rather
 * than discovered by dragging.
 */
import { describe, it, expect } from 'vitest';
import { resizeDisplayRect, handlePositions, handleCursor, CROP_HANDLES, MIN_CROP } from '../../src/utils/cropResize';

const R = { x: 100, y: 100, width: 200, height: 200 };
const PW = 600, PH = 800;

describe('resizeDisplayRect', () => {
  it('a corner moves BOTH its edges', () => {
    expect(resizeDisplayRect(R, 'nw', -20, -30, PW, PH))
      .toEqual({ x: 80, y: 70, width: 220, height: 230 });
    expect(resizeDisplayRect(R, 'se', 40, 50, PW, PH))
      .toEqual({ x: 100, y: 100, width: 240, height: 250 });
  });

  it('an edge moves ONLY that edge', () => {
    expect(resizeDisplayRect(R, 'n', 0, -25, PW, PH))
      .toEqual({ x: 100, y: 75, width: 200, height: 225 });
    expect(resizeDisplayRect(R, 'e', 15, 999, PW, PH))
      .toEqual({ x: 100, y: 100, width: 215, height: 200 });   // dy ignored for 'e'
    expect(resizeDisplayRect(R, 'w', 30, 0, PW, PH))
      .toEqual({ x: 130, y: 100, width: 170, height: 200 });
    expect(resizeDisplayRect(R, 's', 999, 10, PW, PH))
      .toEqual({ x: 100, y: 100, width: 200, height: 210 });   // dx ignored for 's'
  });

  it('clamps to the page box, never outside it', () => {
    const r = resizeDisplayRect(R, 'nw', -500, -500, PW, PH);
    expect(r).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    const r2 = resizeDisplayRect(R, 'se', 5000, 5000, PW, PH);
    expect(r2.x + r2.width).toBe(PW);
    expect(r2.y + r2.height).toBe(PH);
  });

  it('NEVER inverts: dragging an edge past its opposite stops at the minimum', () => {
    // The failure this prevents: arithmetic that allows width<0 still "works" and silently crops a
    // different region than the one under the pointer.
    const r = resizeDisplayRect(R, 'e', -5000, 0, PW, PH);
    expect(r.width).toBe(MIN_CROP);
    expect(r.x).toBe(100);
    const r2 = resizeDisplayRect(R, 'w', 5000, 0, PW, PH);
    expect(r2.width).toBe(MIN_CROP);
    expect(r2.x + r2.width).toBe(300);          // right edge held still
    const r3 = resizeDisplayRect(R, 'n', 0, 5000, PW, PH);
    expect(r3.height).toBe(MIN_CROP);
    const r4 = resizeDisplayRect(R, 's', 0, -5000, PW, PH);
    expect(r4.height).toBe(MIN_CROP);
    for (const h of CROP_HANDLES) {
      const out = resizeDisplayRect(R, h, -9999, -9999, PW, PH);
      expect(out.width, h).toBeGreaterThanOrEqual(MIN_CROP);
      expect(out.height, h).toBeGreaterThanOrEqual(MIN_CROP);
    }
  });

  it('a zero delta is the identity for every handle', () => {
    for (const h of CROP_HANDLES) expect(resizeDisplayRect(R, h, 0, 0, PW, PH), h).toEqual(R);
  });
});

describe('handlePositions / handleCursor', () => {
  it('places all 8 grips on the rect', () => {
    const p = handlePositions(R);
    expect(p.nw).toEqual({ x: 100, y: 100 });
    expect(p.se).toEqual({ x: 300, y: 300 });
    expect(p.n).toEqual({ x: 200, y: 100 });
    expect(p.w).toEqual({ x: 100, y: 200 });
    expect(Object.keys(p).sort()).toEqual([...CROP_HANDLES].sort());
  });

  it('gives every handle a direction-appropriate cursor', () => {
    expect(handleCursor('n')).toBe('ns-resize');
    expect(handleCursor('e')).toBe('ew-resize');
    expect(handleCursor('nw')).toBe('nwse-resize');
    expect(handleCursor('ne')).toBe('nesw-resize');
    for (const h of CROP_HANDLES) expect(handleCursor(h), h).toMatch(/-resize$/);
  });
});
