/**
 * Architecture step 2b: `opStreamWalker` composed its CTM with a local `composeCtm(m, a…f)` and now calls the kernel's
 * `multiplyMatrix([a…f], m)`. Same algebra, and the same order of additions, so every component must be bit-identical —
 * `Object.is`, which also tells −0 from +0 and NaN from NaN. `oldComposeCtm` is the removed formula, copied verbatim;
 * it is the oracle, so its own correctness is pinned by the first case (a hand-computed `cm` composition).
 */
import { describe, it, expect } from 'vitest';
import { multiplyMatrix, type Matrix } from '../../../src/shared-kernel/geometry/matrix';

/** The `composeCtm` closure removed from `src/export/opStreamWalker.ts`, verbatim. */
const oldComposeCtm = (
  m: Matrix, a: number, b: number, c: number, d: number, e: number, f: number,
): Matrix => [
  m[0] * a + m[2] * b, m[1] * a + m[3] * b,
  m[0] * c + m[2] * d, m[1] * c + m[3] * d,
  m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5],
];

/** mulberry32 — seeded, so a failure names a reproducible case. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPECIAL = [0, -0, 1, -1, 0.1, 1e-300, -1e-300, 5e-324, 1e300, -1e300, 2 ** 53 + 1, 72 / 7, Math.PI];

function sameBits(a: Matrix, b: Matrix): boolean {
  return a.every((v, i) => Object.is(v, b[i]));
}

describe('kernel multiplyMatrix replaces opStreamWalker composeCtm', () => {
  it('the oracle is the PDF cm composition (M_cm applied first, then the CTM)', () => {
    // A translate-by-(10,20) CTM, then `2 0 0 3 5 7 cm`: the point (1,1) lands at (2+5, 3+7) + (10,20).
    expect(oldComposeCtm([1, 0, 0, 1, 10, 20], 2, 0, 0, 3, 5, 7)).toEqual([2, 0, 0, 3, 15, 27]);
  });

  it('is bit-identical on random, signed-zero, tiny and huge operands', () => {
    const rnd = prng(0x2b2b);
    const pick = (): number => {
      const r = rnd();
      if (r < 0.3) return SPECIAL[Math.floor(rnd() * SPECIAL.length)];
      const mag = 10 ** Math.floor(rnd() * 12 - 6);
      return (rnd() * 2 - 1) * mag;
    };
    let cases = 0;
    for (let n = 0; n < 5000; n++) {
      const m = [pick(), pick(), pick(), pick(), pick(), pick()] as Matrix;
      const a = [pick(), pick(), pick(), pick(), pick(), pick()] as Matrix;
      const before = oldComposeCtm(m, ...a);
      const after = multiplyMatrix(a, m);
      if (!sameBits(before, after)) {
        throw new Error(`case ${n}: m=${JSON.stringify(m)} a=${JSON.stringify(a)} → ${before} vs ${after}`);
      }
      cases++;
    }
    expect(cases).toBe(5000);
  });

  it('keeps a −0 component −0 (Object.is, not toEqual)', () => {
    const before = oldComposeCtm([-0, 0, 0, -0, -0, -0], -0, 0, 0, -0, -0, -0);
    const after = multiplyMatrix([-0, 0, 0, -0, -0, -0], [-0, 0, 0, -0, -0, -0]);
    expect(before.some((v) => Object.is(v, -0))).toBe(true);
    expect(sameBits(before, after)).toBe(true);
  });

  it('the argument order matters: the swapped call differs on a non-commuting pair', () => {
    const m: Matrix = [1, 0, 0, 1, 10, 20];
    const a: Matrix = [2, 0, 0, 3, 5, 7];
    expect(sameBits(oldComposeCtm(m, ...a), multiplyMatrix(m, a))).toBe(false);
  });
});
