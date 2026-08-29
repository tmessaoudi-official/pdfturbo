/**
 * The signature rect's frame — a 4th instance of this repo's CropBox/MediaBox mismatch.
 *
 * The sign modal's X/Y/W/H are written verbatim into the signature annotation's `/Rect`, which
 * PDF defines in ABSOLUTE user space. But the drag-to-place prefill mapped the drawn rect
 * through the pdf.js viewport's dimensions alone, i.e. relative to the CROP box, and the signer
 * validates against pdf-lib's `getSize()`, i.e. the MEDIA box. On any page whose CropBox origin
 * is not (0,0) the visible signature therefore landed displaced by exactly that origin — and if
 * the crop is inset far enough, outside the visible area altogether.
 *
 * Same root cause as the redaction CropBox-origin leak, and the fix is its sibling:
 * `displayRectToPageUserSpaceRect` is to `displayRectToUserSpaceRect` what
 * `redactionRectToPageSpace` is to `redactionRectToContent`.
 */
import { describe, it, expect } from 'vitest';
import { displayRectToPageUserSpaceRect, displayRectToUserSpaceRect } from '../../src/utils/geometry';

// Non-square crop (200×300) with an ASYMMETRIC origin on BOTH axes — a square box hides a
// width/height swap and a symmetric origin hides an x/y transposition.
const VIEW_BOX = [50, 120, 250, 420];
const DISPLAY = { x: 40, y: 60, width: 100, height: 60 };

describe('displayRectToPageUserSpaceRect', () => {
  it('adds the CropBox origin, giving absolute user-space coordinates', () => {
    // Crop spans x 50..250, y 120..420. Display x=40 → absolute 90. Display y=60 measured down
    // from the crop TOP (absolute y-up 420) → the rect's lower edge sits at 420-60-60 = 300.
    expect(displayRectToPageUserSpaceRect(DISPLAY, VIEW_BOX, 0))
      .toEqual({ x: 90, y: 300, width: 100, height: 60 });
  });

  it('DIFFERS from the crop-relative mapping the prefill used to emit', () => {
    // The defect, stated as a test: the old mapping is short by exactly the origin.
    const old = displayRectToUserSpaceRect(DISPLAY, 200, 300, 0);
    const fixed = displayRectToPageUserSpaceRect(DISPLAY, VIEW_BOX, 0);
    expect(fixed.x - old.x).toBe(VIEW_BOX[0]);
    expect(fixed.y - old.y).toBe(VIEW_BOX[1]);
    expect(fixed.width).toBe(old.width);
    expect(fixed.height).toBe(old.height);
  });

  it('is identity-equivalent to the old mapping at a zero origin', () => {
    // Which is why this shipped undetected: almost every page has a (0,0) CropBox origin.
    const zero = [0, 0, 200, 300];
    expect(displayRectToPageUserSpaceRect(DISPLAY, zero, 0))
      .toEqual(displayRectToUserSpaceRect(DISPLAY, 200, 300, 0));
  });

  it('keeps the rect inside the crop at every rotation', () => {
    for (const rot of [0, 90, 180, 270]) {
      const r = displayRectToPageUserSpaceRect(DISPLAY, VIEW_BOX, rot);
      expect(r.x).toBeGreaterThanOrEqual(VIEW_BOX[0]);
      expect(r.y).toBeGreaterThanOrEqual(VIEW_BOX[1]);
      expect(r.x + r.width).toBeLessThanOrEqual(VIEW_BOX[2]);
      expect(r.y + r.height).toBeLessThanOrEqual(VIEW_BOX[3]);
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    }
  });

  it('swaps the box dimensions at 90/270, not just the coordinates', () => {
    // The crop is 200×300, so a quarter turn makes the DISPLAYED box 300×200. A rect drawn at
    // display x=40 with width 100 must still land inside the crop's absolute x range.
    const r = displayRectToPageUserSpaceRect({ x: 250, y: 40, width: 40, height: 100 }, VIEW_BOX, 90);
    expect(r.x).toBeGreaterThanOrEqual(VIEW_BOX[0]);
    expect(r.x + r.width).toBeLessThanOrEqual(VIEW_BOX[2]);
  });
});
