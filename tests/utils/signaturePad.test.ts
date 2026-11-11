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

  it('a lost pointer capture ends the stroke, so the next finger can draw (the modal closed mid-stroke)', () => {
    const { pad, fire } = makePad();
    fire('pointerdown', 1, 1, 7);
    fire('lostpointercapture', 1, 1, 7); // the canvas was hidden; its pointerup lands elsewhere
    fire('pointerdown', 9, 9, 8);
    fire('pointerup', 9, 9, 8);
    expect(pad.getStrokes()).toEqual([[{ x: 1, y: 1 }], [{ x: 9, y: 9 }]]);
  });

  it('clear() mid-stroke ends the drawing state too, so a new pointer is not locked out', () => {
    const { pad, fire } = makePad();
    fire('pointerdown', 1, 1, 7); // never released
    pad.clear(); // openModal() calls this
    fire('pointerdown', 9, 9, 8);
    fire('pointermove', 10, 10, 8);
    fire('pointermove', 11, 11, 7); // the old pointer cannot draw any more
    expect(pad.getStrokes()).toEqual([[{ x: 9, y: 9 }, { x: 10, y: 10 }]]);
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

describe('SignaturePad — logical size (setSize, phone-signature-pad step 4)', () => {
  // the developer's phone: dpr 2.8125, a 368x147 CSS-px pad (step-3 W4)
  it('sizes the buffer by dpr, fixes the CSS box in px, and encodes in the LOGICAL size', () => {
    const { pad, canvas, stroke } = makePad();
    pad.setSize(368, 147, 2.8125);
    expect([canvas.width, canvas.height]).toEqual([1035, 413]);
    expect([canvas.style.width, canvas.style.height]).toEqual(['368px', '147px']);
    stroke([[10, 10], [300, 120]]);
    const input = pad.toSignatureInput();
    expect([input.width, input.height]).toEqual([368, 147]);
    expect(input.strokes).toEqual([[{ x: 10, y: 10 }, { x: 300, y: 120 }]]);
  });

  it('scales the context by dpr, so a CSS-px point is drawn at its buffer pixel', () => {
    const { pad, ctx } = makePad();
    pad.setSize(250, 100, 2);
    const m = ctx.getTransform();
    expect([m.a, m.b, m.c, m.d, m.e, m.f]).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('replay fits into the logical size, not the buffer', () => {
    const { pad } = makePad();
    pad.setSize(500, 200, 2);
    pad.replay({ gridWidth: 1023, gridHeight: 341, color: '#000000', lineWidth: 4, strokes: [[{ x: 1023, y: 341 }]] });
    const s = Math.min(500 / 1023, 200 / 341);
    const [[p]] = pad.getStrokes();
    expect(p.x).toBeCloseTo(500, 6);
    expect(p.y).toBeCloseTo((200 - 341 * s) / 2 + 341 * s, 6);
  });

  it('clear() wipes the WHOLE buffer, even at a dpr below 1', () => {
    const { pad, ctx } = makePad();
    pad.setSize(100, 40, 0.9); // buffer 90x36
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(88, 34, 2, 2); // the buffer's last pixels: outside a scaled clearRect(0,0,90,36)
    ctx.restore();
    expect(pad.isEmpty()).toBe(false);
    pad.clear();
    expect(pad.isEmpty()).toBe(true);
  });

  it('a resize of a drawn pad rescales its strokes (contain, centred) instead of losing or misplacing them', () => {
    const { pad, stroke } = makePad();
    pad.setSize(300, 120, 1);
    stroke([[0, 0], [300, 120]]);
    pad.setSize(600, 240, 1);
    expect(pad.getStrokes()).toEqual([[{ x: 0, y: 0 }, { x: 600, y: 240 }]]);
    pad.setSize(400, 400, 1); // portrait: width-bound, centred vertically
    const s = 400 / 600;
    const oy = (400 - 240 * s) / 2;
    const [[a, b]] = pad.getStrokes();
    expect([a.x, a.y]).toEqual([0, oy]);
    expect(b.x).toBeCloseTo(400, 9);
    expect(b.y).toBeCloseTo(oy + 240 * s, 9);
    expect(pad.toSignatureInput().width).toBe(400);
  });

  it('a resize mid-stroke ends that stroke, so the next finger is not locked out (a rotation while touching)', () => {
    const { pad, fire } = makePad();
    pad.setSize(300, 120, 1);
    fire('pointerdown', 1, 1, 7); // pointer 7 is never released
    pad.setSize(300, 120, 1);
    fire('pointerdown', 9, 9, 8);
    fire('pointermove', 10, 10, 8);
    expect(pad.getStrokes()).toEqual([[{ x: 1, y: 1 }], [{ x: 9, y: 9 }, { x: 10, y: 10 }]]);
  });
});

describe('SignaturePad — drawImage (Import image, phone-signature-pad step 5a)', () => {
  it('clears the pad, then fits the image inside the logical size (contain, centred) and drops the strokes', () => {
    const { pad, stroke, ctx } = makePad();
    stroke([[5, 5], [50, 50]]);
    const img = document.createElement('canvas');
    img.width = 100;
    img.height = 100; // square into 500x200 → 200x200 at x 150
    const clearRect = vi.spyOn(ctx, 'clearRect');
    const drawImage = vi.spyOn(ctx, 'drawImage');
    pad.drawImage(img);
    expect(clearRect).toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledWith(img, 150, 0, 200, 200);
    expect(pad.getStrokes()).toEqual([]);
    expect(pad.isEmpty()).toBe(true); // a blank source draws nothing
  });

  it('uses the LOGICAL size after setSize, not the dpr-scaled buffer', () => {
    const { pad, ctx } = makePad();
    pad.setSize(300, 120, 2);
    const img = document.createElement('canvas');
    img.width = 600;
    img.height = 60; // wide: 300x30 at y 45
    const drawImage = vi.spyOn(ctx, 'drawImage');
    pad.drawImage(img);
    expect(drawImage).toHaveBeenCalledWith(img, 0, 45, 300, 30);
  });

  it('the drawn image is what isEmpty and getDataURL see', () => {
    const { pad } = makePad();
    const img = document.createElement('canvas');
    img.width = 10;
    img.height = 4;
    const ictx = img.getContext('2d') as CanvasRenderingContext2D;
    ictx.fillStyle = '#000';
    ictx.fillRect(0, 0, 10, 4);
    pad.drawImage(img);
    expect(pad.isEmpty()).toBe(false);
  });
});
