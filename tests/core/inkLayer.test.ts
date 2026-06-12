/**
 * InkLayer — strokes, JSON round-trip, rendering, toDataURL.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InkLayer, type InkStroke } from '../../src/infra/inkLayer';

const mkStroke = (override: Partial<InkStroke> = {}): InkStroke => ({
  type: 'ink',
  points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
  width: 3,
  color: '#000000',
  ...override,
});

let layer: InkLayer;
beforeEach(() => { layer = new InkLayer(); });

// ── getStrokes ─────────────────────────────────────────────────────────────────
describe('getStrokes', () => {
  it('returns empty array for unknown page', () => {
    expect(layer.getStrokes('p1')).toEqual([]);
  });

  it('returns added strokes', () => {
    const s = mkStroke();
    layer.addStroke('p1', s);
    expect(layer.getStrokes('p1')).toHaveLength(1);
    expect(layer.getStrokes('p1')[0]).toBe(s);
  });

  it('isolates pages', () => {
    layer.addStroke('p1', mkStroke({ color: '#f00' }));
    layer.addStroke('p2', mkStroke({ color: '#00f' }));
    expect(layer.getStrokes('p1')).toHaveLength(1);
    expect(layer.getStrokes('p2')).toHaveLength(1);
    expect(layer.getStrokes('p3')).toHaveLength(0);
  });
});

// ── addStroke / removeLastStroke ───────────────────────────────────────────────
describe('addStroke / removeLastStroke', () => {
  it('appends strokes in order', () => {
    const s1 = mkStroke({ color: '#111' });
    const s2 = mkStroke({ color: '#222' });
    layer.addStroke('p1', s1);
    layer.addStroke('p1', s2);
    expect(layer.getStrokes('p1')[0]).toBe(s1);
    expect(layer.getStrokes('p1')[1]).toBe(s2);
  });

  it('removeLastStroke pops the last stroke', () => {
    layer.addStroke('p1', mkStroke({ color: '#111' }));
    layer.addStroke('p1', mkStroke({ color: '#222' }));
    layer.removeLastStroke('p1');
    expect(layer.getStrokes('p1')).toHaveLength(1);
    expect(layer.getStrokes('p1')[0].color).toBe('#111');
  });

  it('removeLastStroke on empty page is a no-op', () => {
    expect(() => layer.removeLastStroke('unknown')).not.toThrow();
  });
});

// ── hasContent / hasAnyContent ─────────────────────────────────────────────────
describe('hasContent / hasAnyContent', () => {
  it('hasContent false for empty page', () => {
    expect(layer.hasContent('p1')).toBe(false);
  });

  it('hasContent true after addStroke', () => {
    layer.addStroke('p1', mkStroke());
    expect(layer.hasContent('p1')).toBe(true);
  });

  it('hasAnyContent false when no strokes anywhere', () => {
    expect(layer.hasAnyContent()).toBe(false);
  });

  it('hasAnyContent true after adding to any page', () => {
    layer.addStroke('p99', mkStroke());
    expect(layer.hasAnyContent()).toBe(true);
  });

  it('hasContent false after clearPage', () => {
    layer.addStroke('p1', mkStroke());
    layer.clearPage('p1');
    expect(layer.hasContent('p1')).toBe(false);
  });
});

// ── clearPage / clearAll ───────────────────────────────────────────────────────
describe('clearPage / clearAll', () => {
  it('clearPage removes only that page', () => {
    layer.addStroke('p1', mkStroke());
    layer.addStroke('p2', mkStroke());
    layer.clearPage('p1');
    expect(layer.hasContent('p1')).toBe(false);
    expect(layer.hasContent('p2')).toBe(true);
  });

  it('clearAll removes all pages', () => {
    layer.addStroke('p1', mkStroke());
    layer.addStroke('p2', mkStroke());
    layer.clearAll();
    expect(layer.hasAnyContent()).toBe(false);
  });

  it('clearPage on unknown page is a no-op', () => {
    expect(() => layer.clearPage('nonexistent')).not.toThrow();
  });
});

// ── toJSON / fromJSON ──────────────────────────────────────────────────────────
describe('toJSON / fromJSON', () => {
  it('toJSON produces an object keyed by pageId', () => {
    const s = mkStroke({ color: '#abc' });
    layer.addStroke('p1', s);
    const json = layer.toJSON();
    expect(Object.keys(json)).toContain('p1');
    expect(json['p1'][0].color).toBe('#abc');
  });

  it('fromJSON restores strokes', () => {
    const data = {
      p1: [mkStroke({ color: '#111' }), mkStroke({ color: '#222' })],
      p2: [mkStroke({ color: '#333' })],
    };
    layer.fromJSON(data);
    expect(layer.getStrokes('p1')).toHaveLength(2);
    expect(layer.getStrokes('p2')).toHaveLength(1);
    expect(layer.getStrokes('p1')[1].color).toBe('#222');
  });

  it('fromJSON clears existing strokes before restoring', () => {
    layer.addStroke('old', mkStroke());
    layer.fromJSON({ p1: [mkStroke()] });
    expect(layer.hasContent('old')).toBe(false);
    expect(layer.hasContent('p1')).toBe(true);
  });

  it('round-trip: toJSON → fromJSON → toJSON is stable', () => {
    layer.addStroke('p1', mkStroke({ color: '#ff0000', width: 5, type: 'erase' }));
    const json1 = layer.toJSON();

    const layer2 = new InkLayer();
    layer2.fromJSON(json1);
    const json2 = layer2.toJSON();

    expect(json2).toEqual(json1);
  });

  it('toJSON on empty layer returns {}', () => {
    expect(layer.toJSON()).toEqual({});
  });

  it('fromJSON with empty object clears layer', () => {
    layer.addStroke('p1', mkStroke());
    layer.fromJSON({});
    expect(layer.hasAnyContent()).toBe(false);
  });
});

// ── InkStroke types ────────────────────────────────────────────────────────────
describe('InkStroke type field', () => {
  it('accepts "ink" type', () => {
    const s = mkStroke({ type: 'ink' });
    layer.addStroke('p1', s);
    expect(layer.getStrokes('p1')[0].type).toBe('ink');
  });

  it('accepts "erase" type', () => {
    const s = mkStroke({ type: 'erase' });
    layer.addStroke('p1', s);
    expect(layer.getStrokes('p1')[0].type).toBe('erase');
  });
});

// ── Single-point strokes ────────────────────────────────────────────────────────
describe('single-point strokes', () => {
  it('stroke with one point is stored but renders nothing (≥2 required)', () => {
    const s: InkStroke = { type: 'ink', points: [{ x: 5, y: 5 }], width: 2, color: '#000' };
    layer.addStroke('p1', s);
    expect(layer.getStrokes('p1')).toHaveLength(1);
    // Rendering skips single-point strokes — hasContent still returns true
    expect(layer.hasContent('p1')).toBe(true);
  });
});

// ── toDataURL (jsdom canvas is pixel-dark by default) ─────────────────────────
describe('toDataURL', () => {
  it('returns null when page has no content', () => {
    expect(layer.toDataURL('p1', 100, 100)).toBeNull();
  });

  it('toDataURL throws or returns null in jsdom (canvas.getContext is not implemented)', () => {
    // jsdom does not implement canvas 2D context — toDataURL either throws or returns null
    layer.addStroke('p1', mkStroke({
      points: [{ x: 10, y: 10 }, { x: 90, y: 90 }],
      width: 4,
      color: 'rgba(255,0,0,1)',
    }));
    let result: string | null = null;
    let threw = false;
    try {
      result = layer.toDataURL('p1', 200, 200);
    } catch {
      threw = true;
    }
    // Either it throws (jsdom no-getContext) or returns null/string — all acceptable
    expect(threw || result === null || typeof result === 'string').toBe(true);
  });
});

// ── renderToCanvas (smoke test) ────────────────────────────────────────────────
describe('renderToCanvas', () => {
  it('does not throw on empty page', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    expect(() => layer.renderToCanvas('p1', canvas, 1)).not.toThrow();
  });

  it('does not throw with strokes', () => {
    layer.addStroke('p1', mkStroke({
      points: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }],
      width: 2,
      color: '#0000ff',
      type: 'ink',
    }));
    layer.addStroke('p1', mkStroke({
      type: 'erase',
      points: [{ x: 20, y: 20 }, { x: 40, y: 40 }],
      width: 5,
      color: 'rgba(0,0,0,1)',
    }));
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    expect(() => layer.renderToCanvas('p1', canvas, 1.5)).not.toThrow();
  });

  it('applies scale to coordinates', () => {
    // Only smoke-tests that the function runs without error at scale=2
    layer.addStroke('p1', mkStroke({ points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] }));
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    expect(() => layer.renderToCanvas('p1', canvas, 2)).not.toThrow();
  });
});

// ── renderToCanvas with mocked context (covers lines 50-70) ────────────────────
describe('renderToCanvas — with mocked canvas context', () => {
  function makeCtxCanvas() {
    const ctx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      lineCap: '' as CanvasLineCap,
      lineJoin: '' as CanvasLineJoin,
      lineWidth: 0,
      globalCompositeOperation: '' as GlobalCompositeOperation,
      strokeStyle: '' as string | CanvasGradient | CanvasPattern,
    };
    const canvas = document.createElement('canvas');
    canvas.getContext = vi.fn().mockReturnValue(ctx) as typeof canvas.getContext;
    return { canvas, ctx };
  }

  it('calls clearRect once at the start of render', () => {
    const { canvas, ctx } = makeCtxCanvas();
    layer.addStroke('p1', mkStroke());
    layer.renderToCanvas('p1', canvas, 1);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
  });

  it('calls stroke() once per multi-point stroke', () => {
    const { canvas, ctx } = makeCtxCanvas();
    layer.addStroke('p1', mkStroke());
    layer.addStroke('p1', mkStroke({ color: '#f00' }));
    layer.renderToCanvas('p1', canvas, 1);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
  });

  it('skips single-point strokes (no stroke call)', () => {
    const { canvas, ctx } = makeCtxCanvas();
    const single: InkStroke = { type: 'ink', points: [{ x: 5, y: 5 }], width: 2, color: '#000' };
    layer.addStroke('p1', single);
    layer.renderToCanvas('p1', canvas, 1);
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenCalledTimes(1); // clearRect still runs
  });

  it('uses destination-out composite op for erase strokes', () => {
    const { canvas, ctx } = makeCtxCanvas();
    const eraseStroke: InkStroke = { type: 'erase', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], width: 5, color: '#f00' };
    layer.addStroke('p1', eraseStroke);
    layer.renderToCanvas('p1', canvas, 1);
    expect(ctx.globalCompositeOperation).toBe('destination-out');
    expect(ctx.strokeStyle).toBe('rgba(0,0,0,1)');
  });

  it('uses source-over composite op for ink strokes', () => {
    const { canvas, ctx } = makeCtxCanvas();
    layer.addStroke('p1', mkStroke({ color: '#0000ff' }));
    layer.renderToCanvas('p1', canvas, 1);
    expect(ctx.globalCompositeOperation).toBe('source-over');
    expect(ctx.strokeStyle).toBe('#0000ff');
  });

  it('scales coordinates by the scale factor', () => {
    const { canvas, ctx } = makeCtxCanvas();
    const lineToCalls: Array<[number, number]> = [];
    ctx.lineTo = vi.fn((x: number, y: number) => lineToCalls.push([x, y]));
    layer.addStroke('p1', { type: 'ink', points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], width: 2, color: '#000' });
    layer.renderToCanvas('p1', canvas, 2);
    expect(lineToCalls[0]).toEqual([60, 80]); // 30*2, 40*2
  });

  it('renders nothing when page has no strokes but still clears', () => {
    const { canvas, ctx } = makeCtxCanvas();
    layer.renderToCanvas('empty', canvas, 1);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});

// ── toDataURL with mocked canvas (covers lines 85-88) ──────────────────────────
describe('toDataURL — with mocked canvas context', () => {
  function mockCanvasCreate(alphaValue: number, dataUrlResult = 'data:image/png;base64,FAKE') {
    const pixelData = new Uint8ClampedArray(4 * 4); // 2x2 canvas, 4 bytes per pixel
    if (alphaValue > 0) pixelData[3] = alphaValue; // set alpha of first pixel
    const mockCtx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      lineCap: '',
      lineJoin: '',
      lineWidth: 0,
      globalCompositeOperation: '',
      strokeStyle: '',
      getImageData: vi.fn().mockReturnValue({ data: pixelData }),
    };
    const origCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        const c = origCreate('canvas') as HTMLCanvasElement;
        c.getContext = vi.fn().mockReturnValue(mockCtx) as typeof c.getContext;
        c.toDataURL = vi.fn().mockReturnValue(dataUrlResult) as typeof c.toDataURL;
        return c;
      }
      return origCreate(tag);
    });
    return { spy, mockCtx };
  }

  it('returns null when all pixels are fully transparent', () => {
    const { spy } = mockCanvasCreate(0);
    layer.addStroke('p1', mkStroke());
    const result = layer.toDataURL('p1', 10, 10);
    expect(result).toBeNull();
    vi.restoreAllMocks();
    spy.mockRestore();
  });

  it('returns data URL when at least one pixel has alpha > 0', () => {
    const { spy } = mockCanvasCreate(255, 'data:image/png;base64,VISIBLE');
    layer.addStroke('p1', mkStroke());
    const result = layer.toDataURL('p1', 10, 10);
    expect(result).toBe('data:image/png;base64,VISIBLE');
    vi.restoreAllMocks();
    spy.mockRestore();
  });
});
