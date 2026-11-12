/**
 * Import image in REAL Chrome (phone-signature-pad plan step 5a; ruling 2026-11-10 23:46: the paper is removed, the
 * ink kept). What jsdom cannot run: a real PNG / JPEG decoded through `<img>` + `createImageBitmap`, the caps checked
 * from the header BEFORE the full decode, a corrupt file, and the result fitted onto a real pad.
 *  (i)  the pad's OWN download (a transparent PNG from `strokesToCanvas`) imports with every stroke kept — since 7b A2
 *       it keeps its own alpha (mostly transparent: `hasOwnTransparency`), so a light ink survives too;
 *  (ii) a photo-like JPEG: paper 235 → 170 across the page, ink 40 — the paper away from the ink is clear.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { IMPORT_LIMITS, SignatureImageError, loadSignatureImage } from '../../src/utils/signatureImage';
import { SignaturePad } from '../../src/utils/signaturePad';
import { strokesToCanvas } from '../../src/utils/signaturePng';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const toFile = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<File>((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(new File([b], 'sig', { type })) : reject(new Error('toBlob failed'))), type, quality);
  });

const alpha = (c: HTMLCanvasElement) => {
  const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, c.width, c.height).data;
  return (x: number, y: number) => d[(y * c.width + x) * 4 + 3];
};

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    return e instanceof SignatureImageError ? e.code : `other: ${String(e)}`;
  }
};

describe('loadSignatureImage — real decode', () => {
  it('(i) the pad PNG (transparent background) keeps every stroke, trimmed to the ink, background clear', async () => {
    // A horizontal and a vertical stroke, 2.5 CSS px at scale 2, exactly as the phone's Download makes them.
    const png = strokesToCanvas(
      [[{ x: 10, y: 30 }, { x: 110, y: 30 }], [{ x: 60, y: 0 }, { x: 60, y: 60 }]],
      { color: '#000000', lineWidth: 2.5, scale: 2 },
    );
    if (!png) throw new Error('no png');
    const out = await loadSignatureImage(await toFile(png, 'image/png'));
    const a = alpha(out);
    // Trimmed to the ink: the PNG's own margin is gone, so the strokes' extent is the image (±2 px of antialiasing):
    // x 10..110 plus the 1.25 px round caps = 102.5 CSS px, y 0..60 plus caps = 62.5, at scale 2.
    expect(Math.abs(out.width - 102.5 * 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(out.height - 62.5 * 2)).toBeLessThanOrEqual(2);
    // The middle of each stroke is opaque, the four quadrants away from both strokes are clear.
    const midX = Math.round(out.width / 2);
    const midY = Math.round(out.height / 2);
    expect(a(10, midY)).toBe(255);
    expect(a(out.width - 10, midY)).toBe(255);
    expect(a(midX, 5)).toBe(255);
    expect(a(midX, out.height - 5)).toBe(255);
    for (const [x, y] of [[20, 20], [out.width - 20, 20], [20, out.height - 20], [out.width - 20, out.height - 20]]) {
      expect(a(x, y), `quadrant at ${x},${y}`).toBe(0);
    }
  });

  it('(ii) a photo-like JPEG: the paper (235 → 170) is clear 3 px away from the ink, the ink is opaque', async () => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 400;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const g = ctx.createLinearGradient(0, 0, 800, 0);
    g.addColorStop(0, 'rgb(235,235,235)');
    g.addColorStop(1, 'rgb(170,170,170)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 800, 400);
    ctx.fillStyle = 'rgb(40,40,40)';
    ctx.fillRect(100, 190, 600, 6); // the ink
    ctx.fillRect(400, 100, 6, 200);
    const out = await loadSignatureImage(await toFile(c, 'image/jpeg', 0.9));
    // Trimmed to the ink box: 600 x 200 (JPEG ringing may add a pixel).
    expect(Math.abs(out.width - 600)).toBeLessThanOrEqual(4);
    expect(Math.abs(out.height - 200)).toBeLessThanOrEqual(4);
    const a = alpha(out);
    // The trim puts the source's ink corner (100, 100) at (0, 0), give or take JPEG ringing: 5 px of slack around the ink.
    const nearInk = (x: number, y: number) => {
      const sx = x + 100;
      const sy = y + 100;
      return (sy >= 185 && sy < 201 && sx >= 95 && sx < 711) || (sx >= 395 && sx < 411 && sy >= 95 && sy < 305);
    };
    const opaquePaper: string[] = [];
    for (let y = 0; y < out.height; y += 2) for (let x = 0; x < out.width; x += 2) if (!nearInk(x, y) && a(x, y) !== 0) opaquePaper.push(`${x},${y}=${a(x, y)}`);
    expect(opaquePaper.slice(0, 10)).toEqual([]);
    expect(a(150, 93)).toBeGreaterThanOrEqual(200); // the horizontal stroke on the bright paper (source x 250)
    expect(a(500, 93)).toBeGreaterThanOrEqual(200); // and on the dark paper (source x 600)
  });

  it('refuses a corrupt file as "decode", and releases the blob URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const create = vi.spyOn(URL, 'createObjectURL');
    const bad = new File([new TextEncoder().encode('not an image at all')], 'x.png', { type: 'image/png' });
    expect(await codeOf(loadSignatureImage(bad))).toBe('decode');
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(create.mock.results[0].value);
  });

  it('a TRUNCATED file whose header is intact is refused as "decode" too (the header loads, the body does not)', async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    for (let i = 0; i < 400; i += 7) { ctx.fillStyle = `rgb(${i % 255},${(i * 3) % 255},90)`; ctx.fillRect(i, 0, 7, 300); }
    for (const type of ['image/png', 'image/jpeg']) {
      const whole = new Uint8Array(await (await toFile(c, type)).arrayBuffer());
      const cut = new File([whole.slice(0, Math.floor(whole.length / 3))], 'cut', { type });
      expect(await codeOf(loadSignatureImage(cut)), type).toBe('decode');
    }
  });

  it('checks the pixel cap from the header, BEFORE createImageBitmap decodes the image', async () => {
    const c = document.createElement('canvas');
    c.width = 100;
    c.height = 100;
    (c.getContext('2d') as CanvasRenderingContext2D).fillRect(10, 10, 20, 20);
    const file = await toFile(c, 'image/png');
    const decode = vi.spyOn(globalThis, 'createImageBitmap');
    expect(await codeOf(loadSignatureImage(file, { ...IMPORT_LIMITS, maxPixels: 100 * 100 - 1 }))).toBe('pixels');
    expect(decode).not.toHaveBeenCalled();
    expect(await codeOf(loadSignatureImage(file, { ...IMPORT_LIMITS, maxPixels: 100 * 100 }))).toBe('resolved');
  });

  it('downscales to the long-side cap', async () => {
    const c = document.createElement('canvas');
    c.width = 3000;
    c.height = 1000;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 3000, 1000);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 3000, 30); // ink across the whole width, so the trim keeps it
    const out = await loadSignatureImage(await toFile(c, 'image/png'));
    expect(out.width).toBe(IMPORT_LIMITS.maxSide);
  });

  it('a blank page is refused as "empty"', async () => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 100;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, 200, 100);
    expect(await codeOf(loadSignatureImage(await toFile(c, 'image/png')))).toBe('empty');
  });
});

// 7b commit A2 (ruling 2026-11-12 10:25): with colour on the phone, its Download PNG can be any palette ink. Keyed on
// white, yellow #ffff00 (luminance 226, 29 below the paper; KEY_LO is 30) vanished and the import said "no ink found".
// A MOSTLY transparent image now keeps its own alpha; an opaque one is keyed as before (the two controls).
describe('loadSignatureImage — an image with its own transparency (7b A2)', () => {
  const rgbaAt = (c: HTMLCanvasElement, x: number, y: number) =>
    Array.from((c.getContext('2d') as CanvasRenderingContext2D).getImageData(x, y, 1, 1).data);

  it('a YELLOW phone PNG imports yellow, trimmed to its strokes', async () => {
    const png = strokesToCanvas(
      [[{ x: 10, y: 30 }, { x: 110, y: 30 }], [{ x: 60, y: 0 }, { x: 60, y: 60 }]],
      { color: '#ffff00', lineWidth: 2.5, scale: 2 },
    );
    if (!png) throw new Error('no png');
    const out = await loadSignatureImage(await toFile(png, 'image/png'));
    expect(Math.abs(out.width - 102.5 * 2)).toBeLessThanOrEqual(2);
    expect(rgbaAt(out, 10, Math.round(out.height / 2))).toEqual([255, 255, 0, 255]);
    expect(alpha(out)(20, 20)).toBe(0);
  });

  it('a pad-filling yellow scribble (W11 shape, measured 8.5% clear at width 10) keeps its alpha too', async () => {
    const W = 368, H = 147;
    const scribble = [Array.from({ length: 50 }, (_, i) => ({ x: i % 2 ? W - 4 : 4, y: 4 + i * ((H - 8) / 49) }))];
    const png = strokesToCanvas(scribble, { color: '#ffff00', lineWidth: 10 * W / 500, scale: 2.8125 });
    if (!png) throw new Error('no png');
    const out = await loadSignatureImage(await toFile(png, 'image/png'));
    expect(rgbaAt(out, Math.round(out.width / 2), Math.round(out.height / 2))[3]).toBeGreaterThan(0);
  });

  it('control: an OPAQUE paper sheet with transparent rounded corners (0.2% clear) is still keyed', async () => {
    const c = document.createElement('canvas');
    c.width = 1000;
    c.height = 700;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = 'rgb(240,240,240)';
    ctx.beginPath();
    ctx.roundRect(0, 0, 1000, 700, 40);
    ctx.fill();
    ctx.fillStyle = 'rgb(30,30,30)';
    ctx.fillRect(200, 340, 600, 8); // the ink
    const out = await loadSignatureImage(await toFile(c, 'image/png'));
    expect(Math.abs(out.width - 600)).toBeLessThanOrEqual(4); // trimmed to the ink: the paper was keyed away
    expect(Math.abs(out.height - 8)).toBeLessThanOrEqual(4);
  });

  it('control: an opaque white-background PNG is still keyed (its white is removed)', async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 200;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 400, 200);
    ctx.fillStyle = '#000000';
    ctx.fillRect(50, 90, 300, 6);
    const out = await loadSignatureImage(await toFile(c, 'image/png'));
    expect(Math.abs(out.width - 300)).toBeLessThanOrEqual(4);
  });

  it('a fully transparent PNG is still refused as "empty"', async () => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 100;
    expect(await codeOf(loadSignatureImage(await toFile(c, 'image/png')))).toBe('empty');
  });
});

describe('Import onto the ✍ pad', () => {
  it('the imported signature lands centred on the pad and is what Save takes (getDataURL)', async () => {
    const png = strokesToCanvas([[{ x: 0, y: 20 }, { x: 200, y: 20 }]], { color: '#000000', lineWidth: 4, scale: 1 });
    if (!png) throw new Error('no png');
    const img = await loadSignatureImage(await toFile(png, 'image/png'));
    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 200;
    document.body.appendChild(canvas);
    const pad = new SignaturePad(canvas);
    pad.drawImage(img);
    expect(pad.isEmpty()).toBe(false);
    const a = alpha(canvas);
    expect(a(250, 100)).toBe(255); // a 204x4 line fitted to 500 wide: centred on the pad's middle row
    expect(a(250, 20)).toBe(0);
    expect(pad.getDataURL().startsWith('data:image/png')).toBe(true);
  });
});
