import { describe, it, expect } from 'vitest';
import { effectiveLineWidth, hasAdvancedText, justifyWordSpacing } from '../../src/export/styledText';

const fakeFont = { widthOfTextAtSize: (t: string, s: number) => t.length * s * 0.5 } as never;

describe('styledText pure helpers', () => {
  it('effectiveLineWidth scales by horizontalScale and adds char spacing', () => {
    const base = effectiveLineWidth(fakeFont, 'abcd', 10, 0, 100);   // 4*10*0.5 = 20
    expect(base).toBeCloseTo(20, 5);
    const tracked = effectiveLineWidth(fakeFont, 'abcd', 10, 2, 100); // +2*(4-1)=6 → 26
    expect(tracked).toBeCloseTo(26, 5);
    const condensed = effectiveLineWidth(fakeFont, 'abcd', 10, 0, 50); // 20*0.5 = 10
    expect(condensed).toBeCloseTo(10, 5);
  });

  it('hasAdvancedText is true only when a Tier-2 attr is set', () => {
    expect(hasAdvancedText({ } as never)).toBe(false);
    expect(hasAdvancedText({ align: 'left' } as never)).toBe(false);
    expect(hasAdvancedText({ strokeWidth: 1 } as never)).toBe(true);
    expect(hasAdvancedText({ charSpacing: 2 } as never)).toBe(true);
    expect(hasAdvancedText({ horizontalScale: 80 } as never)).toBe(true);
    expect(hasAdvancedText({ baselineShift: 'sub' } as never)).toBe(true);
    expect(hasAdvancedText({ align: 'justify' } as never)).toBe(true);
  });

  describe('justifyWordSpacing', () => {
    it('returns (boxW-lineW)/spaces/scale at Tz=100', () => {
      // gap=100, spaces=2, scale=1 → 50
      expect(justifyWordSpacing(200, 100, 2, 100)).toBeCloseTo(50, 10);
    });

    it('doubles Tw when Tz=50 (half scale → double Tw to fill the same on-page gap)', () => {
      // gap=100, spaces=2, scale=0.5 → 100
      expect(justifyWordSpacing(200, 100, 2, 50)).toBeCloseTo(100, 10);
    });

    it('returns 0 when there is no gap (lineW >= boxW)', () => {
      expect(justifyWordSpacing(100, 100, 2, 100)).toBe(0);
      expect(justifyWordSpacing(80, 100, 2, 100)).toBe(0);
    });

    it('returns 0 when spaces <= 0', () => {
      expect(justifyWordSpacing(200, 100, 0, 100)).toBe(0);
      expect(justifyWordSpacing(200, 100, -1, 100)).toBe(0);
    });

    it('defaults to Tz=100 when horizontalScale is omitted', () => {
      expect(justifyWordSpacing(200, 100, 2)).toBeCloseTo(50, 10);
    });
  });
});
