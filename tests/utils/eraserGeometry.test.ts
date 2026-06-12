import { describe, it, expect } from 'vitest';
import {
  segmentsIntersect,
  bboxIntersectsPolyline,
  splitFreehandAtErase,
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

  it('deletes a segment fully enclosed between two crossings', () => {
    const stroke = Array.from({length:31}, (_,i) => ({x:i, y:0}));
    const erase = [{x:5,y:-5},{x:5,y:5},{x:25,y:5},{x:25,y:-5}];
    const result = splitFreehandAtErase(stroke, erase);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const allX = result.flatMap(s => s.map(p => p.x));
    const hasMiddle = allX.some(x => x > 5.5 && x < 24.5);
    expect(hasMiddle).toBe(false);
  });
});
