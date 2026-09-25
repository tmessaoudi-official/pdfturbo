/**
 * A5 — the pure edges of `textDrawnFootprint` (src/export/textExtent.ts). The rendered-pixel pin and
 * the keep/drop decisions live in `tests/browser/text-extent-ink.browser.test.ts`; these are the
 * cases that need no browser.
 */
import { describe, it, expect } from 'vitest';
import { TextElement } from '../../src/elements/textElement';
import { textDrawnFootprint } from '../../src/export/textExtent';
import { rotatedElementFootprint } from '../../src/utils/geometry';

const text = (t: string, o: Partial<TextElement> = {}) =>
  Object.assign(new TextElement(40, 40, 'p1', { width: 120, height: 20, fontSize: 14 }), { text: t }, o);
const never = (): Promise<number> => Promise.reject(new Error('the Arabic measurer must not be called'));
const failing = (): Promise<number> => Promise.reject(new Error('font failed to load'));

describe('textDrawnFootprint', () => {
  it('an empty text box is its stored footprint (fixtures without text keep their old meaning)', async () => {
    const te = text('');
    expect(await textDrawnFootprint(te, never)).toEqual(rotatedElementFootprint(te));
  });

  it('grows to cover a second line drawn below the box — the reachable overflow', async () => {
    // Default-sized box, Enter pressed once: line 2 baseline at 40 + 12.6 + 16.8 = 69.4 > 60.
    const f = await textDrawnFootprint(text('one\ntwo'), never);
    expect(f.y + f.height).toBeGreaterThan(69.4);
  });

  it('never shrinks below the stored footprint, even for a tiny line', async () => {
    const te = text('.', { height: 200, width: 300 });
    const f = await textDrawnFootprint(te, never);
    const s = rotatedElementFootprint(te);
    expect(f.x).toBeLessThanOrEqual(s.x);
    expect(f.y).toBeLessThanOrEqual(s.y);
    expect(f.x + f.width).toBeGreaterThanOrEqual(s.x + s.width);
    expect(f.y + f.height).toBeGreaterThanOrEqual(s.y + s.height);
  });

  it('does not call the Arabic measurer for Latin text', async () => {
    await expect(textDrawnFootprint(text('Latin only\nsecond'), never)).resolves.toBeDefined();
  });

  it('an Arabic line whose font cannot load reaches the page edge on its row (fail closed)', async () => {
    const f = await textDrawnFootprint(text('نص عربي'), failing);
    expect(f.x + f.width).toBe(Infinity);
    // …but not beyond its own rows: the band stays finite vertically.
    expect(Number.isFinite(f.y + f.height)).toBe(true);
  });

  it('an Arabic line is placed by its MEASURED width, right-aligned inside the box', async () => {
    const f = await textDrawnFootprint(text('نص', { width: 120 }), () => Promise.resolve(20));
    // Ink ends at the box edge (160) plus the measured Noto bbox margin, 0.25 em = 3.5pt.
    expect(f.x + f.width).toBeCloseTo(163.5, 5);
  });
});
