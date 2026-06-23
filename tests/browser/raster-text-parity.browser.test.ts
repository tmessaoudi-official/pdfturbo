/**
 * Raster-export text parity (2026-06-23 QA Theme-4).
 *
 * The redaction rasterizer's canvas text loop used to draw overlay TextElements
 * with a bare fillText — dropping alignment, stroke/outline, character spacing,
 * horizontal scale, sub/superscript and underline/strikethrough that the vector
 * bake honours. `drawTextElementToCanvas` restores parity. These real-Chrome
 * pixel checks catch a silent regression back to plain fillText. (jsdom canvas
 * has no real measureText / glyph rasterization.)
 */
import { describe, it, expect } from 'vitest';
import { drawTextElementToCanvas } from '../../src/export/rasterText';
import type { TextElement } from '../../src/elements/textElement';

const SCALE = 2;

function freshCtx(wPt: number, hPt: number): { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.width = wPt * SCALE; canvas.height = hPt * SCALE;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { ctx, canvas };
}

function te(partial: Partial<TextElement>): TextElement {
  return {
    type: 'text', id: 1, pageId: 'p1', x: 0, y: 0, width: 200, height: 30,
    text: 'Hi', fontSize: 20, fontFamily: 'Arial', color: '#000000',
    bold: false, italic: false,
    ...partial,
  } as unknown as TextElement;
}

/** Pixels whose channel sum is clearly non-white (ink). */
function inkPixels(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): number {
  const d = ctx.getImageData(x, y, w, h).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++;
  }
  return n;
}

/** Minimum x (canvas px) that contains any ink, or -1 if blank. */
function minInkX(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) return x;
    }
  }
  return -1;
}

describe('drawTextElementToCanvas — raster export parity', () => {
  it('right-aligns the line within the box', () => {
    const left = freshCtx(200, 30);
    drawTextElementToCanvas(left.ctx, te({ align: 'left' }), SCALE);
    const right = freshCtx(200, 30);
    drawTextElementToCanvas(right.ctx, te({ align: 'right' }), SCALE);

    const leftMin = minInkX(left.ctx, 400, 60);
    const rightMin = minInkX(right.ctx, 400, 60);
    expect(leftMin).toBeGreaterThanOrEqual(0);
    expect(rightMin).toBeGreaterThan(leftMin + 50); // shifted well to the right
  });

  it('centers the line within the box', () => {
    const left = freshCtx(200, 30);
    drawTextElementToCanvas(left.ctx, te({ align: 'left' }), SCALE);
    const center = freshCtx(200, 30);
    drawTextElementToCanvas(center.ctx, te({ align: 'center' }), SCALE);
    expect(minInkX(center.ctx, 400, 60)).toBeGreaterThan(minInkX(left.ctx, 400, 60) + 20);
  });

  it('draws an underline rule below the baseline', () => {
    const plain = freshCtx(200, 30);
    drawTextElementToCanvas(plain.ctx, te({}), SCALE);
    const underlined = freshCtx(200, 30);
    drawTextElementToCanvas(underlined.ctx, te({ underline: true }), SCALE);
    // band just below the baseline (baseY≈36px, underline≈40.8px): blank for plain "Hi"
    const band = (c: CanvasRenderingContext2D) => inkPixels(c, 0, 39, 120, 6);
    expect(band(plain.ctx)).toBe(0);
    expect(band(underlined.ctx)).toBeGreaterThan(10);
  });

  it('draws a strikethrough rule through the glyph body', () => {
    const plain = freshCtx(200, 30);
    drawTextElementToCanvas(plain.ctx, te({ text: 'oo' }), SCALE);
    const struck = freshCtx(200, 30);
    drawTextElementToCanvas(struck.ctx, te({ text: 'oo', strikethrough: true }), SCALE);
    expect(inkPixels(struck.ctx, 0, 0, 120, 60)).toBeGreaterThan(inkPixels(plain.ctx, 0, 0, 120, 60));
  });

  it('thickens glyphs when an outline stroke is applied', () => {
    const fill = freshCtx(200, 30);
    drawTextElementToCanvas(fill.ctx, te({}), SCALE);
    const stroked = freshCtx(200, 30);
    drawTextElementToCanvas(stroked.ctx, te({ strokeWidth: 2 }), SCALE);
    expect(inkPixels(stroked.ctx, 0, 0, 200, 60)).toBeGreaterThan(inkPixels(fill.ctx, 0, 0, 200, 60));
  });

  it('widens the line under positive horizontal scale (Tz)', () => {
    const normal = freshCtx(300, 30);
    drawTextElementToCanvas(normal.ctx, te({ width: 300, text: 'Width' }), SCALE);
    const wide = freshCtx(300, 30);
    drawTextElementToCanvas(wide.ctx, te({ width: 300, text: 'Width', horizontalScale: 180 }), SCALE);
    // rightmost ink extends further when scaled horizontally
    const maxX = (c: CanvasRenderingContext2D) => {
      const d = c.getImageData(0, 0, 600, 60).data;
      for (let x = 599; x >= 0; x--) for (let y = 0; y < 60; y++) {
        const i = (y * 600 + x) * 4;
        if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) return x;
      }
      return -1;
    };
    expect(maxX(wide.ctx)).toBeGreaterThan(maxX(normal.ctx) + 20);
  });
});
