/**
 * Batch-3 (a) — true-edit Path-3 Separation/spot "redraw black" fix.
 *
 * In the raw content stream a Separation/spot fill is `<tint> scn`; the actual
 * RGB needs the color-space's tint-transform function, which the stream parser
 * cannot evaluate — so `parseFillColorToRgb` returns null and the Path-3 redraw
 * previously fell back to BLACK, recoloring spot-colored text. The rendered page
 * already shows the true (pdf.js-evaluated) color, so the handler can sample a
 * pixel and pass it as `fallbackColor`. `resolveRedrawColor` is the pure decision:
 *   explicit style color  >  parseable in-stream color (rg/g/k)  >  sampled fallback  >  black.
 */
import { describe, it, expect } from 'vitest';
import { resolveRedrawColor } from '../../src/utils/contentStreamEditor';

describe('resolveRedrawColor — Path-3 fill color precedence', () => {
  it('explicit style color wins over everything', () => {
    expect(
      resolveRedrawColor({ r: 0.1, g: 0.2, b: 0.3 }, '1 0 0 rg', { r: 1, g: 1, b: 1 })
    ).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
  });

  it('parses an in-stream rg color when no style override', () => {
    expect(resolveRedrawColor(undefined, '1 0 0 rg', { r: 0.5, g: 0.5, b: 0.5 }))
      .toEqual({ r: 1, g: 0, b: 0 });
  });

  it('parses an in-stream gray color', () => {
    expect(resolveRedrawColor(undefined, '0.5 g', undefined))
      .toEqual({ r: 0.5, g: 0.5, b: 0.5 });
  });

  it('uses the sampled fallback for an UNPARSEABLE scn/Separation color (the bug)', () => {
    // "0.5 scn" has no resolvable RGB in-stream → must use the sampled color,
    // NOT collapse to black.
    expect(resolveRedrawColor(undefined, '0.5 scn', { r: 0.91, g: 0.31, b: 0.22 }))
      .toEqual({ r: 0.91, g: 0.31, b: 0.22 });
  });

  it('falls back to black when scn is unparseable AND no sample is available', () => {
    expect(resolveRedrawColor(undefined, '0.5 scn', undefined))
      .toEqual({ r: 0, g: 0, b: 0 });
  });

  it('falls back to black when there is no color info at all', () => {
    expect(resolveRedrawColor(undefined, undefined, undefined))
      .toEqual({ r: 0, g: 0, b: 0 });
  });
});
