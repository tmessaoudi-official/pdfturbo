import { describe, it, expect } from 'vitest';
import { effectiveLineWidth, hasAdvancedText } from '../../src/export/styledText';

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
});
