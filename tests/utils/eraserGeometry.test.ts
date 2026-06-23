import { describe, it, expect } from 'vitest';
import {
  segmentsIntersect,
  bboxIntersectsPolyline,
  splitFreehandAtErase,
  pointToSegmentDistance,
  pointToPolylineDistance,
  type Point,
} from '../../src/utils/eraserGeometry';

describe('segmentsIntersect', () => {
  it('detects a simple crossing', () => {
    const r = segmentsIntersect({x:0,y:5},{x:10,y:5}, {x:5,y:0},{x:5,y:10});
    expect(r.intersects).toBe(true);
    expect((r.point as Point).x).toBeCloseTo(5);
    expect((r.point as Point).y).toBeCloseTo(5);
  });

  it('returns false for parallel segments', () => {
    const r = segmentsIntersect({x:0,y:0},{x:10,y:0}, {x:0,y:5},{x:10,y:5});
    expect(r.intersects).toBe(false);
  });

  it('returns false when segments are collinear but non-overlapping', () => {
    const r = segmentsIntersect({x:0,y:0},{x:3,y:0}, {x:5,y:0},{x:10,y:0});
    expect(r.intersects).toBe(false);
  });

  it('returns false when segments cross on extensions but not within bounds', () => {
    const r = segmentsIntersect({x:0,y:0},{x:2,y:0}, {x:5,y:-1},{x:5,y:1});
    expect(r.intersects).toBe(false);
  });
});

describe('bboxIntersectsPolyline', () => {
  const polyline = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];

  it('detects overlap when polyline passes through bbox', () => {
    const result = bboxIntersectsPolyline({x:4,y:-2,w:4,h:4}, polyline);
    expect(result).toBe(true);
  });

  it('returns false when bbox is entirely outside', () => {
    const result = bboxIntersectsPolyline({x:20,y:20,w:5,h:5}, polyline);
    expect(result).toBe(false);
  });
});

describe('splitFreehandAtErase', () => {
  it('returns original stroke when erase does not cross it', () => {
    const stroke = [{x:0,y:0},{x:10,y:0},{x:20,y:0}];
    const erase  = [{x:0,y:10},{x:20,y:10}];
    const result = splitFreehandAtErase(stroke, erase);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(3);
  });

  it('splits stroke at one crossing into two sub-strokes', () => {
    const stroke = [{x:0,y:0},{x:10,y:0},{x:20,y:0}];
    const erase  = [{x:10,y:-5},{x:10,y:5}];
    const result = splitFreehandAtErase(stroke, erase);
    expect(result).toHaveLength(2);
    expect(result[0].length).toBeGreaterThanOrEqual(2);
    expect(result[1].length).toBeGreaterThanOrEqual(2);
  });

  it('deletes the middle the eraser swept alongside, keeping clear tails', () => {
    // Eraser dips to y=3 and runs parallel from x=20..40 (within the default
    // radius of the stroke at y=0), entering/leaving via the verticals at x=20/40.
    // Tails (x<14, x>46) are clearly outside the radius and MUST survive.
    const stroke = Array.from({length:61}, (_,i) => ({x:i, y:0}));
    const erase = [{x:20,y:-3},{x:20,y:3},{x:40,y:3},{x:40,y:-3}];
    const result = splitFreehandAtErase(stroke, erase);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const allX = result.flatMap(s => s.map(p => p.x));
    // the swept band is gone …
    expect(allX.some(x => x > 21 && x < 39)).toBe(false);
    // … but both tails survive.
    expect(allX.some(x => x < 14)).toBe(true);
    expect(allX.some(x => x > 46)).toBe(true);
  });

  it('does NOT over-delete a segment that lies inside the erase AABB but far from its path', () => {
    // Regression for the centroid-in-AABB bug: a tall "tent" erase crosses the
    // stroke only near x=10 and x=90, but its AABB spans x∈[10,90], y∈[-2,80].
    // The stroke middle (x≈50) is ~80px from the actual eraser path → must survive.
    const stroke = Array.from({length:101}, (_,i) => ({x:i, y:0}));
    const erase = [{x:10,y:-2},{x:10,y:2},{x:50,y:80},{x:90,y:2},{x:90,y:-2}];
    const result = splitFreehandAtErase(stroke, erase);
    const allX = result.flatMap(s => s.map(p => p.x));
    // the far middle is preserved (old AABB model would have deleted it)
    expect(allX.some(x => x > 40 && x < 60)).toBe(true);
  });

  it('deletes the whole stroke when the eraser sweeps all of it', () => {
    const stroke = [{x:0,y:0},{x:5,y:0},{x:10,y:0}];
    const erase = [{x:-2,y:0},{x:12,y:0}]; // runs right along the stroke
    const result = splitFreehandAtErase(stroke, erase);
    expect(result).toHaveLength(0);
  });

  it('honours a custom radius', () => {
    const stroke = Array.from({length:41}, (_,i) => ({x:i, y:0}));
    const erase = [{x:20,y:-30},{x:20,y:30}]; // single transversal sweep at x=20
    const wide = splitFreehandAtErase(stroke, erase, 10);
    const narrow = splitFreehandAtErase(stroke, erase, 2);
    const gap = (segs: Point[][]) => {
      const xs = segs.flatMap(s => s.map(p => p.x)).filter(x => Math.abs(x - 20) < 20);
      const left = Math.max(...xs.filter(x => x < 20));
      const right = Math.min(...xs.filter(x => x > 20));
      return right - left;
    };
    expect(gap(wide)).toBeGreaterThan(gap(narrow));
  });
});

describe('pointToSegmentDistance', () => {
  it('measures perpendicular distance to the segment interior', () => {
    expect(pointToSegmentDistance({x:5,y:5}, {x:0,y:0}, {x:10,y:0})).toBeCloseTo(5);
  });
  it('clamps to the nearest endpoint past the segment', () => {
    expect(pointToSegmentDistance({x:15,y:0}, {x:0,y:0}, {x:10,y:0})).toBeCloseTo(5);
  });
  it('handles a degenerate zero-length segment', () => {
    expect(pointToSegmentDistance({x:3,y:4}, {x:0,y:0}, {x:0,y:0})).toBeCloseTo(5);
  });
});

describe('pointToPolylineDistance', () => {
  it('returns the minimum distance across all segments', () => {
    const poly = [{x:0,y:0},{x:10,y:0},{x:10,y:10}];
    expect(pointToPolylineDistance({x:11,y:5}, poly)).toBeCloseTo(1);
  });
});
