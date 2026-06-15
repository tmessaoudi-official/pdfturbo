/**
 * decomposeImageCtm — pure 2D affine decomposition for rotated-image fidelity (d).
 *
 * pdf.js delivers an image's placement as the CTM at paintImageXObject time:
 * [a,b,c,d,e,f] where [a,b,c,d] folds scale + rotation and [e,f] is translation.
 * The old extractor read width=|a|, height=|d| — correct only for axis-aligned
 * images; a rotated image lost both its rotation AND its true on-page size.
 */
import { describe, it, expect } from 'vitest';
import { decomposeImageCtm } from '../../src/utils/flowDoc';

describe('decomposeImageCtm', () => {
  it('identity-scale matrix → unit scale, no rotation', () => {
    const r = decomposeImageCtm([1, 0, 0, 1, 100, 200]);
    expect(r.scaleX).toBeCloseTo(1);
    expect(r.scaleY).toBeCloseTo(1);
    expect(r.rotation).toBeCloseTo(0);
  });

  it('pure scale (no rotation) → scaleX/scaleY = the diagonal magnitudes', () => {
    const r = decomposeImageCtm([200, 0, 0, 80, 50, 60]);
    expect(r.scaleX).toBeCloseTo(200);
    expect(r.scaleY).toBeCloseTo(80);
    expect(r.rotation).toBeCloseTo(0);
  });

  it('90° rotation → rotation 90, scales preserved', () => {
    const s = 120;
    // R(90)·S = [0, s, -s, 0]
    const r = decomposeImageCtm([0, s, -s, 0, 10, 20]);
    expect(r.rotation).toBeCloseTo(90);
    expect(r.scaleX).toBeCloseTo(s);
    expect(r.scaleY).toBeCloseTo(s);
  });

  it('45° rotation with scale → captures both', () => {
    const a = Math.PI / 4;
    const s = 50;
    const r = decomposeImageCtm([s * Math.cos(a), s * Math.sin(a), -s * Math.sin(a), s * Math.cos(a), 0, 0]);
    expect(r.rotation).toBeCloseTo(45, 1);
    expect(r.scaleX).toBeCloseTo(s, 1);
    expect(r.scaleY).toBeCloseTo(s, 1);
  });

  it('normalizes rotation into [0,360) for negative angles', () => {
    const s = 100;
    // R(-90)·S = [0, -s, s, 0] → 270°
    const r = decomposeImageCtm([0, -s, s, 0, 0, 0]);
    expect(r.rotation).toBeCloseTo(270);
  });

  it('translation does not affect scale or rotation', () => {
    const a = decomposeImageCtm([1, 0, 0, 2, 0, 0]);
    const b = decomposeImageCtm([1, 0, 0, 2, 999, -42]);
    expect(b.scaleX).toBeCloseTo(a.scaleX);
    expect(b.scaleY).toBeCloseTo(a.scaleY);
    expect(b.rotation).toBeCloseTo(a.rotation);
  });

  it('reports always-positive scales (magnitudes)', () => {
    const r = decomposeImageCtm([-30, 0, 0, -40, 0, 0]);
    expect(r.scaleX).toBeGreaterThan(0);
    expect(r.scaleY).toBeGreaterThan(0);
  });
});
