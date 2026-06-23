import { describe, it, expect } from 'vitest';
import { logicalToVisual, visualToLogical, visualRuns, logicalItemOrder, baseDirection } from '../../src/utils/bidi';

describe('logicalToVisual', () => {
  it('LTR-only text is returned unchanged', () => {
    expect(logicalToVisual('Hello World')).toBe('Hello World');
  });
  it('reverses a pure-Arabic line to visual order', () => {
    const L = 'مرحبا'; // logical
    const V = logicalToVisual(L, 'rtl');
    expect(V).not.toBe(L); // reordered
    expect([...V].reverse().join('')).toBe(L); // single run → simple reverse
  });
  it('mirrors paired brackets in an RTL context', () => {
    const V = logicalToVisual('(مرحبا)', 'rtl');
    expect(V.includes('(') || V.includes(')')).toBe(true);
    expect(V).not.toBe('(مرحبا)');
  });
  it('keeps an embedded LTR word forward inside an RTL line', () => {
    const V = logicalToVisual('مرحبا World', 'rtl');
    expect(V).toContain('World'); // the Latin run is NOT internally reversed
  });
});

describe('visualToLogical', () => {
  it('LTR-base text is identity', () => {
    expect(visualToLogical('Hello World')).toBe('Hello World');
  });
  it('round-trips logicalToVisual for representative lines', () => {
    for (const L of ['مرحبا', 'مرحبا World', 'السعر 100 ريال', '(مرحبا)']) {
      expect(visualToLogical(logicalToVisual(L, 'rtl'), 'rtl')).toBe(L);
    }
  });
  it('recovers an embedded multi-char LTR run order', () => {
    const L = 'مرحبا Main';
    expect(visualToLogical(logicalToVisual(L, 'rtl'), 'rtl')).toBe(L);
  });
});

describe('visualRuns', () => {
  it('LTR-only → single forward run', () => {
    expect(visualRuns('Hello')).toEqual([{ text: 'Hello', rtl: false }]);
  });
  it('pure Arabic → single rtl run with LOGICAL text', () => {
    const runs = visualRuns('مرحبا', 'rtl');
    expect(runs).toHaveLength(1);
    expect(runs[0].rtl).toBe(true);
    expect(runs[0].text).toBe('مرحبا'); // logical, NOT reversed (fontkit will shape it)
  });
  it('mixed line → runs in visual L→R order, Latin run left of Arabic', () => {
    const runs = visualRuns('مرحبا World', 'rtl');
    const latinIdx = runs.findIndex((r) => !r.rtl && r.text.includes('World'));
    const arabicIdx = runs.findIndex((r) => r.rtl && r.text.includes('مرحبا'));
    expect(latinIdx).toBeGreaterThanOrEqual(0);
    expect(arabicIdx).toBeGreaterThanOrEqual(0);
    expect(latinIdx).toBeLessThan(arabicIdx); // Latin drawn first (leftmost)
  });
});

describe('baseDirection', () => {
  it('Arabic-first → rtl', () => expect(baseDirection('مرحبا World')).toBe('rtl'));
  it('Latin-first → ltr', () => expect(baseDirection('Hello مرحبا')).toBe('ltr'));
  it('leading digits are not strong → rtl when Arabic follows', () => expect(baseDirection('100 مرحبا')).toBe('rtl'));
  it('no strong char → rtl default', () => expect(baseDirection('123 ...')).toBe('rtl'));
});

describe('logicalItemOrder', () => {
  const item = (text: string) => ({ text });
  it('reverses a pure-RTL item sequence to logical order', () => {
    // visual L→R glyph items "ا ب ح ر م" → logical item order "م ر ح ب ا"
    const visual = [...'ابحرم'].map(item);
    const out = logicalItemOrder(visual, (s) => /[؀-ۿ]/.test(s.text)).map((s) => s.text);
    expect(out).toEqual([...'مرحبا']);
  });
  it('keeps an embedded LTR item run forward (no internal touch)', () => {
    // visual: M a i n  ا ب ح ر م → logical item order: م ر ح ب ا M a i n
    const visual = [...'Main', ...'ابحرم'].map(item);
    const out = logicalItemOrder(visual, (s) => /[؀-ۿ]/.test(s.text)).map((s) => s.text);
    expect(out).toEqual([...'مرحبا', ...'Main']);
  });
  it('preserves a multi-char token verbatim (does not reverse internals)', () => {
    const visual = [item('ب'), item('PDF'), item('ا')];
    const out = logicalItemOrder(visual, (s) => /[؀-ۿ]/.test(s.text)).map((s) => s.text);
    expect(out).toEqual(['ا', 'PDF', 'ب']);
  });
});
