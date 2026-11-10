// @vitest-environment jsdom
// The phone pad's Download (phone-signature-pad plan step 4, ruled 2026-11-10 22:41): the signature as a transparent
// PNG, trimmed to its strokes plus a margin, at device resolution — the file step 5's Import image reads.
import { describe, it, expect } from 'vitest';
import { strokesToCanvas } from '../../src/utils/signaturePng';

function alpha(canvas: HTMLCanvasElement, x: number, y: number): number {
  return (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(x, y, 1, 1).data[3];
}

describe('strokesToCanvas', () => {
  it('trims to the strokes plus a margin of one line width, at the given scale', () => {
    const c = strokesToCanvas([[{ x: 10, y: 20 }, { x: 110, y: 70 }]], { color: '#000000', lineWidth: 2.5, scale: 2 });
    expect(c).not.toBeNull();
    if (!c) return;
    expect([c.width, c.height]).toEqual([Math.ceil(105 * 2), Math.ceil(55 * 2)]);
    expect(alpha(c, Math.round(c.width / 2), Math.round(c.height / 2))).toBe(255); // on the line
    expect(alpha(c, 1, c.height - 2)).toBe(0); // transparent background
  });

  it('never clips a round cap: every edge row and column stays transparent', () => {
    const c = strokesToCanvas([[{ x: 0, y: 0 }, { x: 40, y: 0 }], [{ x: 20, y: 30 }]], { color: '#000000', lineWidth: 6, scale: 1 });
    if (!c) throw new Error('null');
    const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, c.width, c.height).data;
    const a = (x: number, y: number) => d[(y * c.width + x) * 4 + 3];
    for (let x = 0; x < c.width; x++) expect([a(x, 0), a(x, c.height - 1)]).toEqual([0, 0]);
    for (let y = 0; y < c.height; y++) expect([a(0, y), a(c.width - 1, y)]).toEqual([0, 0]);
    expect(a(6 - 3 + 1, 6)).toBeGreaterThan(0); // the left cap reaches half a line width past the end point
  });

  it('a lone tap is a visible dot, not an empty image', () => {
    const c = strokesToCanvas([[{ x: 5, y: 5 }]], { color: '#000000', lineWidth: 4, scale: 1 });
    if (!c) throw new Error('null');
    expect([c.width, c.height]).toEqual([8, 8]);
    expect(alpha(c, 4, 4)).toBe(255);
  });

  it('nothing drawn → null', () => {
    expect(strokesToCanvas([], { color: '#000000', lineWidth: 2, scale: 1 })).toBeNull();
  });
});
