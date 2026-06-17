/**
 * Bidi run segmentation for mixed Arabic + Latin/digit overlay lines (#3b).
 * Pure helpers, jsdom-testable; the rendered glyph output (Latin no longer tofu,
 * RTL order) is guarded by tests/browser/arabic-overlay.browser.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { segmentBidiRuns, baseIsRtl } from '../../src/export/arabicOverlay';

describe('segmentBidiRuns', () => {
  it('splits Arabic + embedded Western digits, peeling boundary spaces', () => {
    const runs = segmentBidiRuns('السعر 100 دولار');
    expect(runs.map((r) => r.arabic)).toEqual([true, false, false, false, true]);
    // boundary spaces are isolated neutral runs; the digit core stands alone
    expect(runs.filter((r) => r.text.trim()).map((r) => r.text)).toEqual(['السعر', '100', 'دولار']);
  });

  it('splits Arabic + a Latin word, peeling the boundary space', () => {
    const runs = segmentBidiRuns('مرحبا World');
    expect(runs.map((r) => r.arabic)).toEqual([true, false, false]); // مرحبا | space | World
    expect(runs[2].text).toBe('World');
  });

  it('treats Arabic-Indic digits as Arabic (in-font), Western digits as non-Arabic', () => {
    expect(segmentBidiRuns('٢٠٢٦').map((r) => r.arabic)).toEqual([true]); // ٠-٩ are U+0660..
    expect(segmentBidiRuns('2026').map((r) => r.arabic)).toEqual([false]);
  });

  it('pure Arabic / pure Latin → single run', () => {
    expect(segmentBidiRuns('مرحبا').map((r) => r.arabic)).toEqual([true]);
    expect(segmentBidiRuns('Hello').map((r) => r.arabic)).toEqual([false]);
  });
});

describe('baseIsRtl (first strong char)', () => {
  it('Arabic-first → RTL', () => expect(baseIsRtl('السعر 100')).toBe(true));
  it('Latin-first → LTR', () => expect(baseIsRtl('Hello مرحبا')).toBe(false));
  it('leading Western digits are not strong → RTL when Arabic follows', () =>
    expect(baseIsRtl('100 مرحبا')).toBe(true));
});
