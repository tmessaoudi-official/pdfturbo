/**
 * #G23 v1b — numeric crop margins. Pure conversion, so every edge case is cheap to pin here rather
 * than discovered through the UI.
 */
import { describe, it, expect } from 'vitest';
import { marginsToContentCrop } from '../../src/utils/geometry';

const M = (top: number, right: number, bottom: number, left: number) => ({ top, right, bottom, left });

describe('marginsToContentCrop', () => {
  it('insets by each edge independently (content space is y-DOWN from the top-left)', () => {
    expect(marginsToContentCrop(M(10, 20, 30, 40), 600, 800))
      .toEqual({ x: 40, y: 10, width: 540, height: 760 });
  });

  it('zero margins are the whole page, not null', () => {
    expect(marginsToContentCrop(M(0, 0, 0, 0), 600, 800))
      .toEqual({ x: 0, y: 0, width: 600, height: 800 });
  });

  it('a uniform margin is symmetric', () => {
    expect(marginsToContentCrop(M(25, 25, 25, 25), 600, 800))
      .toEqual({ x: 25, y: 25, width: 550, height: 750 });
  });

  it('REFUSES when the margins leave nothing to show', () => {
    expect(marginsToContentCrop(M(400, 0, 401, 0), 600, 800)).toBeNull();   // over-tall
    expect(marginsToContentCrop(M(0, 300, 0, 300), 600, 800)).toBeNull();   // exactly zero width
    expect(marginsToContentCrop(M(0, 0, 799.5, 0), 600, 800)).toBeNull();   // < 1pt left
  });

  it('treats a negative margin as zero — a crop box cannot OUTSET the page', () => {
    expect(marginsToContentCrop(M(-50, 0, 0, -50), 600, 800))
      .toEqual({ x: 0, y: 0, width: 600, height: 800 });
  });

  it('is NaN-safe (an empty numeric input parses to NaN, not 0)', () => {
    expect(marginsToContentCrop(M(NaN, NaN, NaN, NaN), 600, 800))
      .toEqual({ x: 0, y: 0, width: 600, height: 800 });
    expect(marginsToContentCrop(M(10, NaN, 10, NaN), 600, 800))
      .toEqual({ x: 0, y: 10, width: 600, height: 780 });
  });

  it('stays inside the page box even with absurd input', () => {
    const r = marginsToContentCrop(M(1e9, 0, 0, 0), 600, 800);
    expect(r).toBeNull();
    const r2 = marginsToContentCrop(M(0, 0, 0, 1e9), 600, 800);
    expect(r2).toBeNull();
  });
});
