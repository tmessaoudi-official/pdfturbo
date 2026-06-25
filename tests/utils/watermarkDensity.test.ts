import { describe, it, expect } from 'vitest';
import { densitySpacingFactor, MIN_WM_DENSITY, MAX_WM_DENSITY } from '../../src/utils/watermarkDensity';

describe('densitySpacingFactor', () => {
  it('preserves the original 1–5 integer factors exactly (byte-stable export)', () => {
    expect(densitySpacingFactor(1)).toBeCloseTo(2.0, 6);
    expect(densitySpacingFactor(2)).toBeCloseTo(1.5, 6);
    expect(densitySpacingFactor(3)).toBeCloseTo(1.0, 6);
    expect(densitySpacingFactor(4)).toBeCloseTo(0.7, 6);
    expect(densitySpacingFactor(5)).toBeCloseTo(0.5, 6);
  });

  it('extends past 5 (denser = smaller spacing factor) up to 10', () => {
    expect(densitySpacingFactor(10)).toBeLessThan(densitySpacingFactor(5));
    expect(densitySpacingFactor(10)).toBeGreaterThan(0);
  });

  it('is monotonically decreasing across the whole range', () => {
    let prev = Infinity;
    for (let d = MIN_WM_DENSITY; d <= MAX_WM_DENSITY; d += 0.5) {
      const f = densitySpacingFactor(d);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it('interpolates half-steps between table entries', () => {
    const f = densitySpacingFactor(1.5);
    // strictly between the density-1 (2.0) and density-2 (1.5) factors
    expect(f).toBeLessThan(2.0);
    expect(f).toBeGreaterThan(1.5);
  });

  it('clamps out-of-range input to [MIN, MAX]', () => {
    expect(densitySpacingFactor(0)).toBeCloseTo(densitySpacingFactor(MIN_WM_DENSITY), 6);
    expect(densitySpacingFactor(99)).toBeCloseTo(densitySpacingFactor(MAX_WM_DENSITY), 6);
    expect(densitySpacingFactor(NaN)).toBeCloseTo(densitySpacingFactor(3), 6); // NaN → safe default 3
  });
});
