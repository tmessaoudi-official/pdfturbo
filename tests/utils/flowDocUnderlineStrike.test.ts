/**
 * classifyRuleAsUnderline — pure geometry test for underline/strike detection (b).
 *
 * A thin horizontal rule (filled/stroked path) is classified relative to a text
 * run's baseline, all in PDF user space (y-up), the space both Word positions and
 * CTM-transformed path bboxes live in. Thick blocks (shading), vertical bars, and
 * rules far from / not overlapping the run must NOT classify (table borders, hr).
 */
import { describe, it, expect } from 'vitest';
import { classifyRuleAsUnderline } from '../../src/utils/flowDoc';

// Baseline at y=500 (y-up), 80pt-wide run starting at x=100, 20pt font.
const run = { x: 100, y: 500, width: 80, size: 20 };

describe('classifyRuleAsUnderline', () => {
  it('thin rule just below the baseline → underline', () => {
    expect(classifyRuleAsUnderline({ x: 100, y: 496, width: 80, height: 1.5 }, run)).toBe('underline');
  });

  it('thin rule around mid x-height → strikethrough', () => {
    expect(classifyRuleAsUnderline({ x: 100, y: 506, width: 80, height: 1.5 }, run)).toBe('strikethrough');
  });

  it('zero-height stroked line below baseline → underline', () => {
    expect(classifyRuleAsUnderline({ x: 100, y: 497, width: 80, height: 0 }, run)).toBe('underline');
  });

  it('rule far above cap height → null (separator, not decoration)', () => {
    expect(classifyRuleAsUnderline({ x: 100, y: 526, width: 80, height: 1.5 }, run)).toBeNull();
  });

  it('thick block (shading/highlight) → null', () => {
    expect(classifyRuleAsUnderline({ x: 100, y: 495, width: 80, height: 20 }, run)).toBeNull();
  });

  it('vertical bar (taller than wide) → null', () => {
    expect(classifyRuleAsUnderline({ x: 100, y: 490, width: 1.2, height: 30 }, run)).toBeNull();
  });

  it('no x-overlap with the run → null', () => {
    expect(classifyRuleAsUnderline({ x: 220, y: 496, width: 80, height: 1.5 }, run)).toBeNull();
  });

  it('tiny x-overlap (< half the run) → null', () => {
    // run 100..180; rule 170..190 overlaps only 10pt (< 40 = half of 80).
    expect(classifyRuleAsUnderline({ x: 170, y: 496, width: 20, height: 1.5 }, run)).toBeNull();
  });

  it('full-width line under a whole text line still flags an inner word', () => {
    // A line-spanning underline (x 50..400) covers this 80pt word fully.
    expect(classifyRuleAsUnderline({ x: 50, y: 496, width: 350, height: 1 }, run)).toBe('underline');
  });
});
