/**
 * The phone pad page in REAL Chrome (phone-signature-pad plan step 4): what jsdom cannot show.
 *  - the dpr transform by pixels: a real pointer at CSS (x, y) on a `setSize(w, h, 2)` pad paints buffer (2x, 2y), and
 *    the canvas box stays at the logical size (recorded points are CSS px relative to it);
 *  - the QR budget read back: a full 909-character frame starting and ending with a space, drawn by `drawQr`, is read
 *    by zxing-wasm (the PC's decoder, self-hosted wasm) as the IDENTICAL text;
 *  - the page end to end: a real drag on the mounted page, Done, the QR on screen → zxing → the frame the pad encoded
 *    → `decodeSignatureFrames`.
 * The built page under its CSP is checked against `vite preview` (plan step-4 acceptance (a)).
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { userEvent } from 'vitest/browser';
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { SignaturePad } from '../../src/utils/signaturePad';
import { drawQr } from '../../src/utils/qrCanvas';
import { mountPadPage } from '../../src/pad/padPage';
import { decodeSignatureFrames, encodeSignatureFrames, PTSIG_LIMITS } from '../../src/utils/signatureStrokes';

const READ: ReaderOptions = { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 };
const FULL_FRAME = ' ' + 'PT0Z$%*+-./:9'.repeat(70).slice(0, PTSIG_LIMITS.maxFrameChars - 2) + ' ';

beforeAll(() => {
  prepareZXingModule({ overrides: { locateFile: (p: string, prefix: string) => (p.endsWith('.wasm') ? wasmUrl : prefix + p) } });
});
afterEach(() => { document.body.replaceChildren(); });

async function readQr(canvas: HTMLCanvasElement): Promise<string[]> {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const r = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), READ);
  return r.filter((b) => b.isValid).map((b) => b.text);
}

describe('SignaturePad.setSize — dpr 2 by pixels', () => {
  it('a real tap at CSS (50, 30) paints buffer (100, 60), and the box stays 200x80 CSS px', async () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const pad = new SignaturePad(canvas, { dotOnTap: true, lineWidth: 6 });
    pad.setSize(200, 80, 2);
    const rect = canvas.getBoundingClientRect();
    expect([rect.width, rect.height]).toEqual([200, 80]);
    await userEvent.click(canvas, { position: { x: 50, y: 30 } });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const a = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3];
    expect(a(100, 60)).toBe(255);
    expect(a(50, 30)).toBe(0);
    expect(pad.getStrokes()).toEqual([[{ x: 50, y: 30 }]]);
  });
});

describe('the QR budget, read back by the PC decoder', () => {
  it('a full 909-character frame with edge spaces is read back as the identical text', async () => {
    const canvas = document.createElement('canvas');
    const { modules } = drawQr(canvas, FULL_FRAME, 400, 1);
    expect(modules).toBe(93);
    expect(await readQr(canvas)).toEqual([FULL_FRAME]);
  });
});

describe('the pad page end to end', () => {
  it('a real drag, Done: the QR on screen decodes to the signature the pad encoded', async () => {
    const root = document.createElement('main');
    root.style.width = '380px';
    document.body.appendChild(root);
    const page = mountPadPage(root, { dpr: () => window.devicePixelRatio, t: (k) => k });
    const canvas = root.querySelector('[data-pad="canvas"]') as HTMLCanvasElement;
    expect(canvas.getBoundingClientRect().width).toBe(page.pad.toSignatureInput().width);
    await userEvent.dragAndDrop(canvas, canvas, { sourcePosition: { x: 20, y: 30 }, targetPosition: { x: 330, y: 120 } });
    await userEvent.click(canvas, { position: { x: 200, y: 40 } }); // a tap: the i-dot
    const expected = encodeSignatureFrames(page.pad.toSignatureInput()).frames;
    expect(expected).toHaveLength(1);
    (root.querySelector('[data-pad="done"]') as HTMLButtonElement).click();
    const qr = root.querySelector('[data-pad="qr"]') as HTMLCanvasElement;
    const texts = await readQr(qr);
    expect(texts).toEqual(expected);
    const sig = decodeSignatureFrames(texts);
    expect(sig.strokes.length).toBe(2);
    expect(sig.strokes[1]).toHaveLength(1);
    // where the ink landed: the drag started at CSS (20, 30) on a pad whose longer side maps to 1023 grid units
    const { width } = page.pad.toSignatureInput();
    const k = 1023 / width;
    expect(Math.abs(sig.strokes[0][0].x - 20 * k)).toBeLessThanOrEqual(1);
    expect(Math.abs(sig.strokes[0][0].y - 30 * k)).toBeLessThanOrEqual(1);
    expect(Math.abs(sig.strokes[1][0].x - 200 * k)).toBeLessThanOrEqual(1);
    expect(Math.abs(sig.strokes[1][0].y - 40 * k)).toBeLessThanOrEqual(1);
  });
});
