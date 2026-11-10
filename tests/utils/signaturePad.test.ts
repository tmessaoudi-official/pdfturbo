// @vitest-environment jsdom
// SignaturePad stroke recording and replay (phone-signature-pad plan step 3, Decisions Log 2026-11-10 21:10).
// jsdom pins the LOGIC: what is recorded, which pointer counts, the replay geometry and which canvas calls a tap makes.
// The pixels — a real tap, a real drag past the edge, the replayed signature — are pinned in real Chrome by
// tests/browser/signature-pad.browser.test.ts.
import { describe, it, expect, vi } from 'vitest';
import { SignaturePad } from '../../src/utils/signaturePad';
import { decodeSignatureFrames, encodeSignatureFrames, type DecodedSignature } from '../../src/utils/signatureStrokes';

const LEFT = 10;
const TOP = 20;

function makePad(opts: ConstructorParameters<typeof SignaturePad>[1] = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 500;
  canvas.height = 200;
  // jsdom has no layout and no pointer capture
  canvas.getBoundingClientRect = () => ({ left: LEFT, top: TOP, width: 500, height: 200, right: LEFT + 500, bottom: TOP + 200, x: LEFT, y: TOP, toJSON: () => ({}) });
  canvas.setPointerCapture = vi.fn();
  const pad = new SignaturePad(canvas, opts);
  const fire = (type: string, x: number, y: number, pointerId = 1, extra: PointerEventInit = {}) =>
    canvas.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', buttons: 1, clientX: LEFT + x, clientY: TOP + y, bubbles: true, cancelable: true, ...extra }));
  const stroke = (pts: Array<[number, number]>, pointerId = 1) => {
    const [[x0, y0], ...rest] = pts;
    fire('pointerdown', x0, y0, pointerId);
    for (const [x, y] of rest) fire('pointermove', x, y, pointerId);
    const [xl, yl] = pts[pts.length - 1];
    fire('pointerup', xl, yl, pointerId);
  };
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  return { canvas, pad, fire, stroke, ctx };
}

describe('SignaturePad — recording', () => {
  it('records each stroke in drawing coordinates (the values handed to moveTo/lineTo)', () => {
    const { pad, stroke, ctx } = makePad();
    const moveTo = vi.spyOn(ctx, 'moveTo');
    const lineTo = vi.spyOn(ctx, 'lineTo');
    stroke([[5, 6], [7.5, 8.25], [30, 40]]);
    expect(pad.getStrokes()).toEqual([[{ x: 5, y: 6 }, { x: 7.5, y: 8.25 }, { x: 30, y: 40 }]]);
    expect(moveTo).toHaveBeenCalledWith(5, 6);
    expect(lineTo.mock.calls).toEqual([[7.5, 8.25], [30, 40]]);
  });

  it('down → up is one stroke; a tap is a one-point stroke', () => {
    const { pad, stroke } = makePad();
    stroke([[1, 1], [2, 2]]);
    stroke([[50, 50]]);
    expect(pad.getStrokes()).toEqual([[{ x: 1, y: 1 }, { x: 2, y: 2 }], [{ x: 50, y: 50 }]]);
  });

  it('a stroke is one pointer: a second finger is ignored and cannot end or bend the first stroke', () => {
    const { pad, fire } = makePad();
    fire('pointerdown', 10, 10, 1);
    fire('pointerdown', 300, 150, 2); // palm or second finger
    fire('pointermove', 20, 20, 1);
    fire('pointermove', 310, 160, 2);
    fire('pointerup', 310, 160, 2);
    fire('pointermove', 30, 30, 1); // still drawing: pointer 2's up did not end it
    fire('pointerup', 30, 30, 1);
    expect(pad.getStrokes()).toEqual([[{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }]]);
  });

  it('pointerleave or pointercancel of the drawing pointer ends its stroke', () => {
    const { pad, fire } = makePad();
    fire('pointerdown', 1, 1);
    fire('pointerleave', 2, 2);
    fire('pointermove', 3, 3);
    fire('pointerdown', 4, 4);
    fire('pointercancel', 4, 4);
    fire('pointermove', 5, 5);
    expect(pad.getStrokes()).toEqual([[{ x: 1, y: 1 }], [{ x: 4, y: 4 }]]);
  });

  it('a mouse without the primary button pressed does not start a stroke (unchanged)', () => {
    const { pad, fire } = makePad();
    fire('pointerdown', 1, 1, 1, { pointerType: 'mouse', buttons: 2 });
    fire('pointermove', 2, 2, 1, { pointerType: 'mouse', buttons: 2 });
    expect(pad.getStrokes()).toEqual([]);
  });

  it('getStrokes returns a copy; clear() forgets every stroke', () => {
    const { pad, stroke } = makePad();
    stroke([[1, 1], [2, 2]]);
    const copy = pad.getStrokes();
    copy[0][0].x = 999;
    copy.push([]);
    expect(pad.getStrokes()).toEqual([[{ x: 1, y: 1 }, { x: 2, y: 2 }]]);
    pad.clear();
    expect(pad.getStrokes()).toEqual([]);
  });

  it('toSignatureInput: the canvas size, the CURRENT colour and width, the recorded strokes — and it encodes', () => {
    const { pad, stroke } = makePad({ color: '#112233', lineWidth: 3 });
    stroke([[10, 10], [100, 80], [200, 20]]);
    pad.setColor('#445566'); // a later change applies to the whole signature (PTSIG v1 has one colour)
    const input = pad.toSignatureInput();
    expect(input).toEqual({ width: 500, height: 200, color: '#445566', lineWidth: 3, strokes: pad.getStrokes() });
    const d = decodeSignatureFrames(encodeSignatureFrames(input).frames);
    expect(d.color).toBe('#445566');
    expect(d.strokes).toHaveLength(1);
  });
});

describe('SignaturePad — a tap', () => {
  it('draws nothing on the default (✍ modal) pad, exactly as before', () => {
    const { stroke, ctx } = makePad();
    const arc = vi.spyOn(ctx, 'arc');
    const fill = vi.spyOn(ctx, 'fill');
    const strokeCall = vi.spyOn(ctx, 'stroke');
    stroke([[50, 50]]);
    expect(arc).not.toHaveBeenCalled();
    expect(fill).not.toHaveBeenCalled();
    expect(strokeCall).not.toHaveBeenCalled();
  });

  it('draws a dot of the line width at the tap on a dotOnTap pad (the phone pad)', () => {
    const { stroke, ctx } = makePad({ dotOnTap: true, lineWidth: 4, color: '#ff0000' });
    const arc = vi.spyOn(ctx, 'arc');
    const fill = vi.spyOn(ctx, 'fill');
    stroke([[50, 60]]);
    expect(arc).toHaveBeenCalledTimes(1);
    expect(arc.mock.calls[0].slice(0, 3)).toEqual([50, 60, 2]);
    expect(fill).toHaveBeenCalledTimes(1);
  });
});

describe('SignaturePad — replay', () => {
  const sig: DecodedSignature = {
    gridWidth: 1023,
    gridHeight: 341,
    color: '#1a237e',
    lineWidth: 4,
    strokes: [[{ x: 0, y: 0 }, { x: 1023, y: 341 }], [{ x: 500, y: 100 }]],
  };

  it('fits the grid inside the canvas (contain), centred, and records what it drew', () => {
    const { pad, stroke } = makePad();
    stroke([[1, 1], [2, 2]]); // replaced, not appended
    pad.replay(sig);
    const s = Math.min(500 / 1023, 200 / 341); // width-bound: 0.4888
    const oy = (200 - 341 * s) / 2;
    const got = pad.getStrokes();
    expect(got).toHaveLength(2);
    expect(got[0][0].x).toBeCloseTo(0, 6);
    expect(got[0][0].y).toBeCloseTo(oy, 6);
    expect(got[0][1].x).toBeCloseTo(500, 6);
    expect(got[0][1].y).toBeCloseTo(200 - oy, 6);
    expect(got[1][0].x).toBeCloseTo(500 * s, 6);
  });

  it('a portrait grid is height-bound and centred horizontally', () => {
    const { pad } = makePad();
    pad.replay({ ...sig, gridWidth: 341, gridHeight: 1023, strokes: [[{ x: 341, y: 1023 }]] });
    const s = 200 / 1023;
    const [[p]] = pad.getStrokes();
    expect(p.y).toBeCloseTo(200, 6);
    expect(p.x).toBeCloseTo((500 - 341 * s) / 2 + 341 * s, 6);
  });

  it('draws in the decoded colour at the scaled width, a one-point stroke as a dot, and keeps the pad style', () => {
    const { pad, ctx } = makePad({ color: '#000000', lineWidth: 2 });
    const arc = vi.spyOn(ctx, 'arc');
    const strokeCall = vi.spyOn(ctx, 'stroke');
    const styles: Array<[string | CanvasGradient | CanvasPattern, number]> = [];
    strokeCall.mockImplementation(function (this: CanvasRenderingContext2D) { styles.push([ctx.strokeStyle, ctx.lineWidth]); });
    pad.replay(sig);
    const s = 500 / 1023;
    expect(strokeCall).toHaveBeenCalledTimes(1); // the two-point stroke
    expect(styles[0][0]).toBe('#1a237e');
    expect(styles[0][1]).toBeCloseTo(4 * s, 6);
    expect(arc).toHaveBeenCalledTimes(1); // the one-point stroke
    expect(arc.mock.calls[0][2]).toBeCloseTo((4 * s) / 2, 6);
    expect([pad.color, pad.lineWidth]).toEqual(['#000000', 2]);
  });

  it('round-trips: encode on one pad, decode, replay on another — the same shape at the new size', () => {
    const a = makePad();
    a.stroke([[10, 10], [250, 190], [490, 10]]);
    a.stroke([[250, 100]]);
    const b = makePad();
    b.pad.replay(decodeSignatureFrames(encodeSignatureFrames(a.pad.toSignatureInput()).frames));
    const got = b.pad.getStrokes();
    expect(got.map((s) => s.length)).toEqual([3, 1]);
    // same 500x200 surface: within half a grid unit of the original
    for (const [i, s] of a.pad.getStrokes().entries())
      for (const [j, p] of s.entries()) {
        expect(Math.abs(got[i][j].x - p.x)).toBeLessThan(0.5);
        expect(Math.abs(got[i][j].y - p.y)).toBeLessThan(0.5);
      }
  });
});
