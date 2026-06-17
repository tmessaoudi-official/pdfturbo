import { describe, it, expect } from 'vitest';
import {
  redactionRectToContent,
  contentRectToDisplay,
  contentCropToPdfCropBox,
  clampContentRect,
} from '../../src/utils/geometry';

// A crop is stored in unrotated CONTENT space (y-down, top-left). These pure
// helpers convert it to/from the editor DISPLAY space (rotated) and to a pdf-lib
// CropBox (y-up, bottom-left). The rotation correctness is shared with
// redactionRectToContent (display → content), so the round-trip is the guarantee.

describe('contentRectToDisplay', () => {
  it('is the identity at rotation 0', () => {
    const r = { x: 30, y: 40, width: 100, height: 200 };
    const d = contentRectToDisplay(r, 600, 800, 0);
    expect(d.x).toBeCloseTo(30);
    expect(d.y).toBeCloseTo(40);
    expect(d.width).toBeCloseTo(100);
    expect(d.height).toBeCloseTo(200);
  });

  it('round-trips with redactionRectToContent at every rotation', () => {
    const W = 600, H = 800;
    // A rect drawn on the ROTATED display (dims swap at 90/270 — use values that fit both).
    const displayRect = { x: 50, y: 60, width: 120, height: 90 };
    for (const rot of [0, 90, 180, 270]) {
      const content = redactionRectToContent(displayRect, W, H, rot);
      const back = contentRectToDisplay(content, W, H, rot);
      expect(back.x).toBeCloseTo(displayRect.x);
      expect(back.y).toBeCloseTo(displayRect.y);
      expect(back.width).toBeCloseTo(displayRect.width);
      expect(back.height).toBeCloseTo(displayRect.height);
    }
  });
});

describe('contentCropToPdfCropBox', () => {
  it('flips y-down top-left content into a y-up bottom-left cropbox', () => {
    const crop = { x: 50, y: 100, width: 400, height: 500 };
    const src = { x: 0, y: 0, width: 600, height: 800 };
    const box = contentCropToPdfCropBox(crop, src);
    expect(box.x).toBeCloseTo(50);
    expect(box.y).toBeCloseTo(200); // 800 - (100 + 500)
    expect(box.width).toBeCloseTo(400);
    expect(box.height).toBeCloseTo(500);
  });

  it('adds the source CropBox origin (PDF with a non-zero /CropBox)', () => {
    const crop = { x: 10, y: 20, width: 100, height: 100 };
    const src = { x: 15, y: 25, width: 300, height: 400 };
    const box = contentCropToPdfCropBox(crop, src);
    expect(box.x).toBeCloseTo(25);  // 15 + 10
    expect(box.y).toBeCloseTo(305); // 25 + (400 - (20 + 100))
    expect(box.width).toBeCloseTo(100);
    expect(box.height).toBeCloseTo(100);
  });
});

describe('clampContentRect', () => {
  it('leaves an in-bounds rect unchanged', () => {
    const r = clampContentRect({ x: 10, y: 10, width: 100, height: 100 }, 600, 800);
    expect(r).toEqual({ x: 10, y: 10, width: 100, height: 100 });
  });

  it('clamps a rect that overflows the content box', () => {
    const r = clampContentRect({ x: 550, y: 700, width: 200, height: 300 }, 600, 800);
    expect(r.x).toBe(550);
    expect(r.y).toBe(700);
    expect(r.width).toBe(50);   // 600 - 550
    expect(r.height).toBe(100); // 800 - 700
  });

  it('clamps a negative origin to zero', () => {
    const r = clampContentRect({ x: -20, y: -30, width: 100, height: 100 }, 600, 800);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(100);
    expect(r.height).toBe(100);
  });
});
