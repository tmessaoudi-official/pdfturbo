// @vitest-environment jsdom
// The phone pad's QR (phone-signature-pad plan step 4). The QR must stay in ALPHANUMERIC mode — step 1 measured it
// 2–7 versions smaller than byte mode — and the budget is one version-19 EC-M code for a 909-character frame
// (Decisions Log 2026-11-10 19:47 / 20:18). A frame may start or end with a space (base45's alphabet has one), so the
// text is never trimmed. That zxing reads the drawn code back is pinned in real Chrome (tests/browser/pad-page).
import { describe, it, expect } from 'vitest';
import { makeQr, drawQr } from '../../src/utils/qrCanvas';
import { PTSIG_LIMITS } from '../../src/utils/signatureStrokes';

const FULL_FRAME = ' ' + 'PT0Z$%*+-./:9'.repeat(70).slice(0, PTSIG_LIMITS.maxFrameChars - 2) + ' ';

describe('makeQr — alphanumeric mode, EC M', () => {
  it('a full 909-character frame starting and ending with a space is ONE version-19 code (93 modules)', () => {
    expect(FULL_FRAME).toHaveLength(909);
    expect(makeQr(FULL_FRAME).size).toBe(93);
  });

  it('a short frame is a small code (version auto-picked)', () => {
    expect(makeQr('PT1 AB').size).toBe(21);
  });

  it('refuses text outside the alphanumeric set rather than switching to byte mode', () => {
    expect(() => makeQr('pt1')).toThrow(/alphanumeric/);
    expect(() => makeQr('PTé')).toThrow(/alphanumeric/);
  });
});

describe('drawQr — integer device pixels, a 4-module quiet zone', () => {
  function pixel(canvas: HTMLCanvasElement, x: number, y: number): number[] {
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    return Array.from(ctx.getImageData(x, y, 1, 1).data);
  }

  it('fits the space given in device pixels, with whole pixels per module, and fixes the CSS box', () => {
    const canvas = document.createElement('canvas');
    const r = drawQr(canvas, 'PT1 AB', 200, 2); // 400 device px for 21 + 8 modules
    expect(r).toEqual({ modules: 21, modulePx: 13 });
    expect([canvas.width, canvas.height]).toEqual([29 * 13, 29 * 13]);
    expect([canvas.style.width, canvas.style.height]).toEqual([`${(29 * 13) / 2}px`, `${(29 * 13) / 2}px`]);
  });

  it('paints the quiet zone white and each module black or white at its own pixels', () => {
    const canvas = document.createElement('canvas');
    const { modulePx } = drawQr(canvas, 'PT1 AB', 200, 2);
    const qr = makeQr('PT1 AB');
    expect(pixel(canvas, 1, 1)).toEqual([255, 255, 255, 255]);
    expect(pixel(canvas, 4 * modulePx - 1, 4 * modulePx - 1)).toEqual([255, 255, 255, 255]);
    for (const [r, c] of [[0, 0], [0, 8], [8, 0], [10, 10], [20, 20], [7, 7]]) {
      const x = (4 + c) * modulePx + Math.floor(modulePx / 2);
      const y = (4 + r) * modulePx + Math.floor(modulePx / 2);
      expect(pixel(canvas, x, y)).toEqual(qr.isDark(r, c) ? [0, 0, 0, 255] : [255, 255, 255, 255]);
    }
  });

  it('never drops below one device pixel per module', () => {
    const canvas = document.createElement('canvas');
    expect(drawQr(canvas, FULL_FRAME, 20, 1)).toEqual({ modules: 93, modulePx: 1 });
  });
});
