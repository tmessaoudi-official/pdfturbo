/**
 * SignaturePad in REAL Chrome (phone-signature-pad plan step 3): what jsdom cannot show — the pixels of a tap and of a
 * replayed signature, and what a real mouse drag that leaves the canvas records while the pad holds pointer capture.
 * The recording logic itself is pinned in jsdom (tests/utils/signaturePad.test.ts).
 *
 * Screenshots (evidence, not assertions) go to var/claude/ptsig/shots/ (gitignored).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { SignaturePad } from '../../src/utils/signaturePad';
import { decodeSignatureFrames, encodeSignatureFrames } from '../../src/utils/signatureStrokes';

const W = 400; // under the 414 px iframe, so a screenshot is not clipped
const H = 160;
const shot = (name: string, element: Element) =>
  page.screenshot({ path: `../../var/claude/ptsig/shots/${name}.png`, element }).catch(() => {});

let host: HTMLDivElement | null = null;
afterEach(() => { host?.remove(); host = null; });

function mount(opts: ConstructorParameters<typeof SignaturePad>[1] = {}) {
  host = document.createElement('div');
  host.style.cssText = `position:relative;width:${W}px;padding:0;margin:0;background:#fff`;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  // CSS size == buffer size and no border, so a CSS offset is a buffer pixel
  canvas.style.cssText = `display:block;width:${W}px;height:${H}px;touch-action:none;background:#fff`;
  const below = document.createElement('div'); // a drop target OUTSIDE the canvas
  below.style.cssText = `width:${W}px;height:60px;background:#eef`;
  host.append(canvas, below);
  document.body.append(host);
  const pad = new SignaturePad(canvas, opts);
  const alphaAt = (x: number, y: number) =>
    (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(Math.round(x), Math.round(y), 1, 1).data[3];
  return { canvas, below, pad, alphaAt };
}

describe('SignaturePad (real Chrome)', () => {
  it('a real tap on the ✍ pad draws nothing, and since 7b records nothing (a repaint would make it a dot)', async () => {
    const { canvas, pad, alphaAt } = mount({ lineWidth: 6 });
    await userEvent.click(canvas, { position: { x: 100, y: 80 } });
    expect(pad.getStrokes()).toEqual([]); // not recorded (7b, 3C round 2 #4)…
    expect(alphaAt(100, 80)).toBe(0); // …and not painted
    expect(pad.isEmpty()).toBe(true);
  });

  it('a real tap on a dotOnTap pad (the phone pad) paints a dot of the line width', async () => {
    const { canvas, pad, alphaAt } = mount({ lineWidth: 6, color: '#1a237e', dotOnTap: true });
    await shot('tap-before', canvas);
    await userEvent.click(canvas, { position: { x: 100, y: 80 } });
    await shot('tap-after', canvas);
    expect(alphaAt(100, 80)).toBe(255);
    expect(alphaAt(100 + 6, 80)).toBe(0); // radius 3: nothing 6 px away
    expect(pad.isEmpty()).toBe(false);
  });

  it('a real drag that ends off the canvas keeps drawing under pointer capture and records points past the edge', async () => {
    const { canvas, below, pad, alphaAt } = mount({ lineWidth: 4 });
    await userEvent.dragAndDrop(canvas, below, { sourcePosition: { x: 50, y: 40 }, targetPosition: { x: 300, y: 40 } });
    const pts = pad.getStrokes().flat();
    // the drop point is 40 px into the box under the canvas: y = H + 40 in canvas coordinates
    expect(pts.some((p) => p.y > H)).toBe(true);
    expect(pts[0]).toEqual({ x: 50, y: 40 });
    // the visible part of the line was painted: just inside the bottom edge on the segment (50,40) → (300,200)
    const t = (H - 3 - 40) / 160;
    expect(alphaAt(50 + 250 * t, H - 3)).toBeGreaterThan(0);
  });

  it('replays a decoded signature: lines in the decoded colour, a one-point stroke as a dot', async () => {
    // a real-ish signature on a 500x200 surface: a loop, a long flourish, an i-dot
    const loop = Array.from({ length: 60 }, (_, i) => ({ x: 120 + 60 * Math.cos(i / 9.5), y: 100 + 50 * Math.sin(i / 9.5) }));
    const flourish = Array.from({ length: 80 }, (_, i) => ({ x: 60 + i * 5, y: 150 - 40 * Math.sin(i / 12) }));
    const frames = encodeSignatureFrames({ width: 500, height: 200, color: '#1a237e', lineWidth: 5, strokes: [loop, flourish, [{ x: 420, y: 40 }]] }).frames;
    const { canvas, pad, alphaAt } = mount({ color: '#000000', lineWidth: 2 });
    await shot('replay-before', canvas);
    pad.replay(decodeSignatureFrames(frames));
    await shot('replay-after', canvas);
    const s = Math.min(W / 1023, H / 409); // the 500x200 surface becomes a 1023x409 grid
    const ox = (W - 1023 * s) / 2;
    const oy = (H - 409 * s) / 2;
    const at = (x: number, y: number) => [ox + Math.round(x * 1023 / 500) * s, oy + Math.round(y * 1023 / 500) * s] as const;
    // the dot
    const [dx, dy] = at(420, 40);
    expect(alphaAt(dx, dy)).toBe(255);
    const px = (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(Math.round(dx), Math.round(dy), 1, 1).data;
    expect([px[0], px[1], px[2]]).toEqual([0x1a, 0x23, 0x7e]);
    // a point on the flourish
    const [fx, fy] = at(60 + 40 * 5, 150 - 40 * Math.sin(40 / 12));
    expect(alphaAt(fx, fy)).toBeGreaterThan(0);
    // empty space stays empty
    expect(alphaAt(W - 2, H - 2)).toBe(0);
    // 7b: the pad takes the replayed ink — the decoded colour and the EXACT scaled width (5 phone px, quantised to
    // quarter grid units, × s) — and follows it until Clear.
    expect(pad.color).toBe('#1a237e');
    expect(pad.lineWidth).toBeCloseTo(5 * s * 1023 / 500, 1);
    expect(pad.inkFollows).toBe(true);
  });
});
