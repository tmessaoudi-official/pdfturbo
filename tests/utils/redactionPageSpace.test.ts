/**
 * Pure geometry of the two functions that bridge the redaction filter's two coordinate frames:
 * `redactionRectToPageSpace` (rects) and `imagePlacementRedacted` (image XObjects).
 *
 * These run in the fast jsdom gate. The end-to-end behaviour is pinned in real Chrome by
 * `tests/browser/redaction-crop-origin.browser.test.ts`; this file pins the arithmetic, which is
 * where the defect actually lived and where a regression is cheapest to catch.
 */
import { describe, it, expect } from 'vitest';
import { redactionRectToPageSpace, redactionRectToContent } from '../../src/utils/geometry';
import { imagePlacementRedacted } from '../../src/export/exportService';

describe('redactionRectToPageSpace', () => {
  const rect = { x: 50, y: 20, width: 200, height: 50 };

  /**
   * The compatibility guarantee that makes this fix safe to ship: for the near-universal
   * `/CropBox [0 0 w h]` page it must agree EXACTLY with the mapping it replaced, at every
   * rotation. If this drifts, ordinary documents change behaviour.
   */
  it.each([0, 90, 180, 270])('is identical to redactionRectToContent at origin (0,0) — rot %i', (rot) => {
    expect(redactionRectToPageSpace(rect, [0, 0, 300, 240], rot))
      .toEqual(redactionRectToContent(rect, 300, 240, rot));
  });

  it('shifts x by the CropBox origin and leaves y measured from the crop top', () => {
    // Origin asymmetric on purpose: (30, 70) catches an x/y transposition that (50, 50) hides.
    const out = redactionRectToPageSpace(rect, [30, 70, 330, 310], 0);
    expect(out).toEqual({ x: 80, y: 20, width: 200, height: 50 });
  });

  it('un-rotates within the CROP dimensions, not the shifted ones', () => {
    // At 90° the un-rotation must use 300×240 (from x1-x0, y1-y0), NOT the absolute corner
    // coordinates. Composing the translation first would rotate the origin offset too, which
    // is the mistake this ordering exists to prevent — so the result must be the rot-0-origin
    // answer plus a pure +30 on x, with y untouched.
    const shifted = redactionRectToPageSpace(rect, [30, 70, 330, 310], 90);
    const unshifted = redactionRectToContent(rect, 300, 240, 90);
    expect(shifted.y).toBeCloseTo(unshifted.y, 6);
    expect(shifted.width).toBeCloseTo(unshifted.width, 6);
    expect(shifted.height).toBeCloseTo(unshifted.height, 6);
    expect(shifted.x - unshifted.x).toBeCloseTo(30, 6);
  });
});

describe('imagePlacementRedacted', () => {
  const pageTopY = 240;
  /** An axis-aligned image drawn at absolute (60, 172) sized 180×46 — i.e. y-down 22..68. */
  const axisAligned = [180, 0, 0, 46, 60, 172];

  it('returns false when there are no redactions', () => {
    expect(imagePlacementRedacted(axisAligned, [], pageTopY)).toBe(false);
  });

  it('detects an image under a redaction', () => {
    expect(imagePlacementRedacted(axisAligned, [{ x: 50, y: 20, width: 200, height: 50 }], pageTopY)).toBe(true);
  });

  it('leaves an image elsewhere on the page alone', () => {
    // A filter that drops every image would satisfy the positive case above and be useless.
    expect(imagePlacementRedacted(axisAligned, [{ x: 50, y: 150, width: 200, height: 50 }], pageTopY)).toBe(false);
  });

  it('treats a touching edge as no overlap', () => {
    // Strict inequality: the redaction's bottom edge is exactly the image's top edge.
    expect(imagePlacementRedacted(axisAligned, [{ x: 50, y: 0, width: 200, height: 22 }], pageTopY)).toBe(false);
  });

  /**
   * The reason the footprint is computed from all four transformed corners rather than |a|/|d|.
   * For a 45°-rotated placement the |a|/|d| box is SMALLER than the true footprint, so an image
   * whose rotated corner reaches under the redaction would be kept — under-dropping, the one
   * direction a leak filter must never err in. The control below shows the test is not simply
   * asserting "rotated images are always dropped".
   */
  it('covers the true footprint of a ROTATED placement, not the |a|/|d| box', () => {
    const c = Math.SQRT1_2 * 100;
    const rotated45 = [c, c, -c, c, 150, 120];   // a 100×100 image rotated 45° about (150,120)
    // Its corners reach x 79.3..220.7, y-up 120..261.4 → y-down -21.4..120.
    expect(imagePlacementRedacted(rotated45, [{ x: 0, y: 0, width: 90, height: 130 }], pageTopY)).toBe(true);
    // CONTROL: a redaction genuinely clear of that footprint is still not a match.
    expect(imagePlacementRedacted(rotated45, [{ x: 0, y: 0, width: 70, height: 130 }], pageTopY)).toBe(false);
  });

  it('handles a flipped placement (negative scale), where e/f is not the min corner', () => {
    // PDF permits a negative scale; reading e/f as the bottom-left would give a bogus box.
    const flipped = [-180, 0, 0, -46, 240, 218];   // spans x 60..240, y-up 172..218
    expect(imagePlacementRedacted(flipped, [{ x: 50, y: 20, width: 200, height: 50 }], pageTopY)).toBe(true);
  });
});
