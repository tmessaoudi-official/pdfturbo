/**
 * WS4-B — `rotatedElementFootprint`, the upright box guaranteed to contain everything a rotated
 * element covers.
 *
 * The UNION cases are the ones with teeth. Replacing the stored box with the rotated-corner AABB
 * looks like the obvious "true footprint" implementation and is WRONG for a leak filter: at 90°
 * a 120×20 box becomes 20×120, i.e. narrower on x, so the filter would stop dropping things it
 * drops today. The plan's direction rule says the tested footprint may only ever GROW, and these
 * cases are what enforce it.
 */
import { describe, it, expect } from 'vitest';
import { rotatedElementFootprint, redactionRectToContent } from '../../src/utils/geometry';

const BOX = { x: 100, y: 120, width: 120, height: 20 };

describe('rotatedElementFootprint', () => {
  it('is exact identity with no rotation', () => {
    expect(rotatedElementFootprint(BOX)).toEqual(BOX);
    expect(rotatedElementFootprint({ ...BOX, rotation: 0 })).toEqual(BOX);
    expect(rotatedElementFootprint({ ...BOX, rotation: 360 })).toEqual(BOX);
  });

  it('at 90° it is the UNION, not the rotated box', () => {
    // Rotated about the centre (160,130) the box occupies x 150..170, y 70..190 — taller, and
    // 100pt NARROWER on x. The union keeps the full 120 width.
    expect(rotatedElementFootprint({ ...BOX, rotation: 90 }))
      .toEqual({ x: 100, y: 70, width: 120, height: 120 });
  });

  it('never shrinks on either axis, at any angle', () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const f = rotatedElementFootprint({ ...BOX, rotation: deg });
      expect(f.x).toBeLessThanOrEqual(BOX.x);
      expect(f.y).toBeLessThanOrEqual(BOX.y);
      expect(f.x + f.width).toBeGreaterThanOrEqual(BOX.x + BOX.width);
      expect(f.y + f.height).toBeGreaterThanOrEqual(BOX.y + BOX.height);
    }
  });

  it('at 45° the short axis grows and the long one is held by the union', () => {
    // A 120×20 box at 45° has a 99×99 rotated AABB — WIDER than 20 but NARROWER than 120. So the
    // height grows to 99 and the width stays 120 because the union refuses to give it up. Asserting
    // "both axes grow" here would be asserting the replacement semantics this fix rejects.
    const f = rotatedElementFootprint({ ...BOX, rotation: 45 });
    expect(f.width).toBe(BOX.width);
    expect(f.height).toBeCloseTo(99, 0);
  });

  it('normalises a negative extent, which would otherwise fail OPEN', () => {
    // `interactionHandler.resize` can produce one when an element is dragged past the canvas edge.
    expect(rotatedElementFootprint({ x: 220, y: 140, width: -120, height: -20 })).toEqual(BOX);
  });

  it('a non-finite rotation degrades to the upright box rather than to NaN', () => {
    expect(rotatedElementFootprint({ ...BOX, rotation: Number.NaN })).toEqual(BOX);
  });
});

describe('redactionRectToContent honours the element rotation', () => {
  it('is byte-identical for a rect that carries no rotation', () => {
    // Every crop rect and every unrotated redaction takes this path, so it must not move.
    expect(redactionRectToContent(BOX, 300, 260, 0)).toEqual(BOX);
    expect(redactionRectToContent({ ...BOX, rotation: 0 }, 300, 260, 90))
      .toEqual(redactionRectToContent(BOX, 300, 260, 90));
  });

  it('widens the content rect when the element itself is rotated', () => {
    const plain = redactionRectToContent(BOX, 300, 260, 0);
    const spun = redactionRectToContent({ ...BOX, rotation: 90 }, 300, 260, 0);
    expect(spun.height).toBeGreaterThan(plain.height);
    // The page rotation and the element rotation compose rather than cancelling: the element's
    // own footprint is taken FIRST, in display space, then the page's rotation is applied.
    expect(spun).toEqual({ x: 100, y: 70, width: 120, height: 120 });
  });
});
