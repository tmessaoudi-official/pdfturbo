/**
 * #G23 v1d — aspect-ratio-aware crop apply-to-all.
 *
 * The property that makes this safe to ship is the IDENTITY case: a uniform document must be
 * completely unaffected, because that is nearly every document. The rest is about what "the same
 * crop" means on a page of a different size — a proportion, not a measurement.
 */
import { describe, it, expect } from 'vitest';
import { scaleCropToPageBox } from '../../src/utils/geometry';

const A4 = { W: 595, H: 842 };

describe('scaleCropToPageBox', () => {
  it('is the IDENTITY when the two page boxes are the same', () => {
    // Byte-identical apply-to-all on a uniform document — the common case, asserted rather than
    // reasoned about.
    const crop = { x: 50, y: 60, width: 200, height: 100 };
    expect(scaleCropToPageBox(crop, A4, { ...A4 })).toEqual(crop);
  });

  it('halves the crop on a page half the size, keeping it in the same relative place', () => {
    const crop = { x: 100, y: 200, width: 200, height: 100 };
    const out = scaleCropToPageBox(crop, { W: 400, H: 400 }, { W: 200, H: 200 });
    expect(out).toEqual({ x: 50, y: 100, width: 100, height: 50 });
  });

  it('preserves the crop SHAPE across a different aspect ratio, rather than stretching it', () => {
    // 400x400 → 800x400. Independent per-axis scaling would double the width and leave the height,
    // turning a square selection into a 2:1 one. A uniform factor keeps it square.
    const crop = { x: 100, y: 100, width: 100, height: 100 };
    const out = scaleCropToPageBox(crop, { W: 400, H: 400 }, { W: 800, H: 400 });
    expect(out.width).toBe(out.height);
    expect(out.width).toBe(100);
    // …and CENTRE-anchored, not corner-anchored. These two agree exactly whenever the aspect ratios
    // match — which is why every other case here cannot tell them apart, and why a sabotage that
    // anchored the corner passed the whole file until this assertion existed. They diverge only when
    // the uniform scale differs from the per-axis fraction, i.e. precisely this geometry: the crop's
    // centre sits at 0.375 of the width, so 0.375 x 800 - 50 = 250, where corner-anchoring gives 200.
    expect({ x: out.x, y: out.y }).toEqual({ x: 250, y: 100 });
  });

  it('keeps the CENTRE at the same fractional position, not the top-left corner', () => {
    // Centre of the source crop is at (0.5, 0.5) of the box, so it stays centred.
    const crop = { x: 100, y: 100, width: 200, height: 200 };
    const out = scaleCropToPageBox(crop, { W: 400, H: 400 }, { W: 200, H: 200 });
    expect(out).toEqual({ x: 50, y: 50, width: 100, height: 100 });
  });

  it('keeps a top-left crop in the top-left, and a bottom-right one bottom-right', () => {
    const topLeft = scaleCropToPageBox({ x: 0, y: 0, width: 100, height: 100 }, { W: 400, H: 400 }, { W: 200, H: 200 });
    expect(topLeft).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    const bottomRight = scaleCropToPageBox({ x: 300, y: 300, width: 100, height: 100 }, { W: 400, H: 400 }, { W: 200, H: 200 });
    expect(bottomRight).toEqual({ x: 150, y: 150, width: 50, height: 50 });
  });

  it('never returns a box that leaves the target page', () => {
    // Swept, because the clamp and the centre maths interact: a crop near an edge on a page of a
    // very different ratio is where an off-by-a-half-width would show.
    for (const [w, h] of [[100, 400], [400, 100], [50, 50], [1000, 300]]) {
      for (const cx of [0, 150, 300, 380]) {
        const out = scaleCropToPageBox({ x: cx, y: cx, width: 120, height: 60 }, { W: 400, H: 400 }, { W: w, H: h });
        expect(out.x).toBeGreaterThanOrEqual(0);
        expect(out.y).toBeGreaterThanOrEqual(0);
        expect(out.x + out.width).toBeLessThanOrEqual(w + 1e-9);
        expect(out.y + out.height).toBeLessThanOrEqual(h + 1e-9);
      }
    }
  });

  it('falls back to a plain clamp on a degenerate source box rather than dividing by zero', () => {
    const out = scaleCropToPageBox({ x: 10, y: 10, width: 50, height: 50 }, { W: 0, H: 0 }, { W: 200, H: 200 });
    expect(Number.isFinite(out.x) && Number.isFinite(out.width)).toBe(true);
    expect(out).toEqual({ x: 10, y: 10, width: 50, height: 50 });
  });

  it('shrinks a crop larger than the target page to fit it', () => {
    const out = scaleCropToPageBox({ x: 0, y: 0, width: 400, height: 400 }, { W: 400, H: 400 }, { W: 100, H: 200 });
    expect(out.width).toBeLessThanOrEqual(100);
    expect(out.height).toBeLessThanOrEqual(200);
  });
});
