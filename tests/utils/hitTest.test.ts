import { describe, it, expect } from 'vitest';
import { ptSegDist, ptInPolygon, hitTestShape } from '../../src/utils/hitTest';
import type { ShapeElement } from '../../src/elements/shapeElement';

const shape = <T extends object>(o: T): ShapeElement => o as unknown as ShapeElement;

describe('ptSegDist', () => {
  it('is 0 for a point on the segment', () => {
    expect(ptSegDist(5, 0, 0, 0, 10, 0)).toBe(0);
  });
  it('returns perpendicular distance to the segment interior', () => {
    expect(ptSegDist(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });
  it('clamps to the nearest endpoint when the projection falls outside', () => {
    // Projection of (-4, 0) onto [0,0]-[10,0] is behind A → distance to A.
    expect(ptSegDist(-4, 0, 0, 0, 10, 0)).toBeCloseTo(4);
    expect(ptSegDist(14, 0, 0, 0, 10, 0)).toBeCloseTo(4);
  });
  it('handles a degenerate (zero-length) segment as point distance', () => {
    expect(ptSegDist(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });
});

describe('ptInPolygon', () => {
  const square = [ { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 } ];
  it('is true for an interior point', () => {
    expect(ptInPolygon(5, 5, square)).toBe(true);
  });
  it('is false for an exterior point', () => {
    expect(ptInPolygon(15, 5, square)).toBe(false);
    expect(ptInPolygon(-1, 5, square)).toBe(false);
  });
  it('handles a concave polygon (point in the notch is outside)', () => {
    // An arrow/chevron-ish concave shape; (5,5) sits in the concavity → outside.
    const concave = [ { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 4 }, { x: 10, y: 10 }, { x: 0, y: 10 } ];
    expect(ptInPolygon(8, 5, concave)).toBe(false);
    expect(ptInPolygon(2, 5, concave)).toBe(true);
  });
});

describe('hitTestShape', () => {
  it('rect: inside hits, outside misses, boundary hits', () => {
    const rect = shape({ shapeType: 'rect', x: 10, y: 10, width: 100, height: 50, strokeWidth: 2 });
    expect(hitTestShape(rect, 50, 30)).toBe(true);
    expect(hitTestShape(rect, 200, 30)).toBe(false);
    expect(hitTestShape(rect, 10, 10)).toBe(true); // corner (boundary inclusive)
  });

  it('freehand: hits near a stroke segment within the width-scaled threshold, misses far away', () => {
    const fh = shape({ shapeType: 'freehand', strokeWidth: 4, points: [ { x: 0, y: 0 }, { x: 100, y: 0 } ] });
    // threshold = 4/2 + 4 = 6.
    expect(hitTestShape(fh, 50, 5)).toBe(true);   // 5 ≤ 6
    expect(hitTestShape(fh, 50, 20)).toBe(false); // 20 > 6
  });

  it('freehand: a thicker stroke widens the hit threshold', () => {
    const thin = shape({ shapeType: 'freehand', strokeWidth: 2, points: [ { x: 0, y: 0 }, { x: 100, y: 0 } ] });
    const thick = shape({ shapeType: 'freehand', strokeWidth: 40, points: [ { x: 0, y: 0 }, { x: 100, y: 0 } ] });
    expect(hitTestShape(thin, 50, 18)).toBe(false);  // thresh 5
    expect(hitTestShape(thick, 50, 18)).toBe(true);  // thresh 24
  });
});
