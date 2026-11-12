// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  IMPORT_LIMITS,
  SignatureImageError,
  OWN_ALPHA_SHARE,
  checkImageFile,
  hasOwnTransparency,
  inkBounds,
  keyOutPaper,
} from '../../src/utils/signatureImage';
import { fitContain } from '../../src/utils/signaturePad';

/**
 * Import image (phone-signature-pad plan step 5a, ruled 2026-11-10 23:46: the paper is removed, the ink kept).
 * The fixtures and their pass criteria were fixed BEFORE the code (3C round 2): (i) ink on white — what the keying
 * sees for an opaque image (since 7b A2 a mostly transparent one, the phone's PNG, keeps its own alpha) — keeps every
 * stroke; (ii) a photo-like page whose paper runs 235 → 170 across it with ink at
 * 40: alpha 0 everywhere outside the ink, ink alpha ≥ 200.
 */

function canvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  return ctx;
}

/** A grey-level image: `grey(x, y)` per pixel, fully opaque. */
function greyImage(w: number, h: number, grey: (x: number, y: number) => number): ImageData {
  const img = canvas(w, h).createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const g = grey(x, y);
      img.data[i] = g;
      img.data[i + 1] = g;
      img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

const alphaAt = (img: ImageData, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];

// 7b commit A2 (ruling 2026-11-12 10:25): an image that is MOSTLY transparent keeps its own alpha — the phone's PNG has
// no paper to key out, and keying it on white erased a light ink (yellow: luminance 226, 29 below the paper, KEY_LO 30).
// The share was measured in Chrome before the code: the phone PNG of a signature 73–95% clear, a pad-filling scribble
// 8.5–66%, an opaque sheet with r=40 transparent corners 0.2% — so 5%.
describe('hasOwnTransparency', () => {
  /** A 100x100 opaque image with its first `clear` pixels fully transparent. */
  const withClear = (clear: number) => {
    const img = canvas(100, 100).createImageData(100, 100);
    for (let p = 0; p < 10_000; p++) img.data[p * 4 + 3] = p < clear ? 0 : 255;
    return img;
  };

  it('the share is 5%', () => {
    expect(OWN_ALPHA_SHARE).toBe(0.05);
  });

  it('true at exactly 5% fully transparent pixels, false one pixel below', () => {
    expect(hasOwnTransparency(withClear(500))).toBe(true);
    expect(hasOwnTransparency(withClear(499))).toBe(false);
  });

  it('only FULLY transparent pixels count: a soft edge (alpha 1-254) everywhere is not transparency', () => {
    const img = withClear(0);
    for (let p = 0; p < 10_000; p++) img.data[p * 4 + 3] = 128;
    expect(hasOwnTransparency(img)).toBe(false);
  });

  it('an opaque image, and a fully clear one', () => {
    expect(hasOwnTransparency(withClear(0))).toBe(false);
    expect(hasOwnTransparency(withClear(10_000))).toBe(true);
  });
});

describe('keyOutPaper', () => {
  it('(i) ink on white — the pad PNG composited over white — keeps every ink pixel opaque and the paper clear', () => {
    const ctx = canvas(120, 60);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 120, 60); // the loader composites over white: a transparent PNG becomes ink on white
    ctx.fillStyle = '#000000';
    ctx.fillRect(10, 20, 100, 4); // a stroke
    ctx.fillRect(60, 5, 3, 50); // a crossing stroke
    const img = ctx.getImageData(0, 0, 120, 60);
    keyOutPaper(img);
    expect(alphaAt(img, 30, 21)).toBe(255);
    expect(alphaAt(img, 61, 50)).toBe(255);
    expect(alphaAt(img, 5, 5)).toBe(0);
    expect(alphaAt(img, 100, 50)).toBe(0);
    const inkPixels = (() => {
      let n = 0;
      for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) n++;
      return n;
    })();
    expect(inkPixels).toBe(100 * 4 + 3 * 50 - 3 * 4); // exactly the two strokes, overlap counted once
  });

  it('(ii) a photo: paper 235 → 170 across the page, ink 40 — the paper is clear EVERYWHERE, the ink ≥ 200', () => {
    const w = 256;
    const h = 128;
    const isInk = (x: number, y: number) =>
      (y >= 60 && y < 63 && x >= 20 && x < 236) || // a horizontal stroke across the whole gradient
      Math.abs(y - (10 + x * 0.4)) < 1.5; // a diagonal one
    const img = greyImage(w, h, (x, y) => (isInk(x, y) ? 40 : Math.round(235 - (65 * x) / (w - 1))));
    keyOutPaper(img);
    const paperOpaque: string[] = [];
    const inkWeak: string[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = alphaAt(img, x, y);
        if (isInk(x, y)) {
          if (a < 200) inkWeak.push(`${x},${y}=${a}`);
        } else if (a !== 0) {
          // A paper pixel touching ink is an edge pixel — still paper in the fixture, so it must be clear too.
          paperOpaque.push(`${x},${y}=${a}`);
        }
      }
    }
    expect(paperOpaque.slice(0, 10)).toEqual([]);
    expect(inkWeak.slice(0, 10)).toEqual([]);
  });

  it('keeps the ink colour: a blue stroke stays blue', () => {
    const ctx = canvas(40, 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 40, 20);
    ctx.fillStyle = '#1030c0';
    ctx.fillRect(5, 8, 30, 4);
    const img = ctx.getImageData(0, 0, 40, 20);
    keyOutPaper(img);
    const i = (9 * 40 + 20) * 4;
    expect([img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]).toEqual([0x10, 0x30, 0xc0, 255]);
  });
});

describe('inkBounds', () => {
  it('is the box of the pixels with any alpha, or null when there are none', () => {
    const ctx = canvas(50, 40);
    expect(inkBounds(ctx.getImageData(0, 0, 50, 40))).toBeNull();
    ctx.fillStyle = '#000';
    ctx.fillRect(7, 11, 20, 3);
    ctx.fillRect(30, 2, 1, 1);
    expect(inkBounds(ctx.getImageData(0, 0, 50, 40))).toEqual({ x: 7, y: 2, w: 24, h: 12 });
  });
});

describe('fitContain', () => {
  it('fits a wide source into a box, centred vertically', () => {
    expect(fitContain(200, 50, 100, 40)).toEqual({ x: 0, y: 7.5, w: 100, h: 25 });
  });
  it('fits a tall source, centred horizontally', () => {
    expect(fitContain(50, 100, 100, 40)).toEqual({ x: 40, y: 0, w: 20, h: 40 });
  });
});

describe('checkImageFile', () => {
  const file = (type: string, size: number) => ({ type, size });
  it('accepts png, jpeg and webp up to the byte cap', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/webp']) expect(() => checkImageFile(file(t, IMPORT_LIMITS.maxBytes))).not.toThrow();
  });
  it('refuses another type with code "type"', () => {
    for (const t of ['image/svg+xml', 'image/gif', 'application/pdf', '']) {
      expect(() => checkImageFile(file(t, 10))).toThrow(expect.objectContaining({ code: 'type' }));
    }
  });
  it('refuses a file over the byte cap with code "bytes"', () => {
    expect(() => checkImageFile(file('image/png', IMPORT_LIMITS.maxBytes + 1))).toThrow(SignatureImageError);
    expect(() => checkImageFile(file('image/png', IMPORT_LIMITS.maxBytes + 1))).toThrow(expect.objectContaining({ code: 'bytes' }));
  });
  it('the caps are the planned ones: 15 MB, 50 MP, a 2048 px long side', () => {
    expect(IMPORT_LIMITS).toEqual({ maxBytes: 15 * 1024 * 1024, maxPixels: 50_000_000, maxSide: 2048 });
  });
});
