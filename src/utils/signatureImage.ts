/**
 * Import a signature from an image (phone-signature-pad plan step 5a; ruling 2026-11-10 23:46: the paper is removed,
 * the ink kept). The no-webcam route — the phone's Download PNG — and a photo of a signature on paper both land here.
 *
 * The file is untrusted. It is type- and byte-capped, loaded as an `<img>` from a blob URL so its dimensions are known
 * from the header and capped BEFORE `createImageBitmap` decodes it, downscaled to a long side of `maxSide`, and trimmed to the
 * ink. An image that is MOSTLY transparent (`hasOwnTransparency` — the phone's Download PNG) keeps its own alpha: it has
 * no paper, and keying it on white erased a light ink (7b A2, ruling 2026-11-12 10:25: yellow vanished). Any other image
 * is composited over WHITE (its few clear pixels would otherwise read as black ink) and keyed. Bound, accepted by the
 * ruling: a mostly transparent PNG that carries an opaque white box keeps the box. An image whose border is pure black
 * (`isFlattenedOnBlack` — that PNG sent "as a photo" by a messenger, its clear pixels turned black) is keyed in reverse
 * (`keyOutBlackSheet`), or refused as `flattened` when its ink was black too (W22-F). The PC then re-encodes the pad as PNG
 * on Save, so no EXIF or other metadata of the source survives.
 */

export const IMPORT_LIMITS = { maxBytes: 15 * 1024 * 1024, maxPixels: 50_000_000, maxSide: 2048 };
export type ImportLimits = typeof IMPORT_LIMITS;

const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type SignatureImageErrorCode = 'type' | 'bytes' | 'pixels' | 'decode' | 'empty' | 'flattened';

/** An image refused for a reason the user can act on — shown in the modal, never logged. */
export class SignatureImageError extends Error {
  constructor(readonly code: SignatureImageErrorCode, message: string) {
    super(message);
    this.name = 'SignatureImageError';
  }
}

export function checkImageFile(file: { type: string; size: number }, limits: ImportLimits = IMPORT_LIMITS): void {
  if (!TYPES.has(file.type)) throw new SignatureImageError('type', `not a PNG, JPEG or WebP image: "${file.type}"`);
  if (file.size > limits.maxBytes) throw new SignatureImageError('bytes', `${file.size} bytes, over ${limits.maxBytes}`);
}

// Keying. The paper level is estimated LOCALLY — a photo's paper is not white and not even (the fixture runs 235 → 170
// across the page): the 90th brightness percentile of each block, interpolated between block centres. A pixel darker
// than its paper by more than KEY_LO is ink, fully opaque from KEY_HI; the ramp between keeps antialiased edges soft.
// A block more than 90% ink (a marker stroke wider than a block) would read as paper: blocks are 1/16 of the long side,
// at least 16 px, far wider than a pen stroke at the 2048 px working size.
const KEY_LO = 30;
const KEY_HI = 90;
const PAPER_PERCENTILE = 0.9;

/**
 * The share of FULLY transparent pixels from which an image keeps its own alpha. Measured in Chrome (7b A2, 2026-11-12)
 * on the phone's own Download PNG: a signature 73–95% clear, a pad-filling scribble 8.5–66%; an opaque paper sheet with
 * transparent rounded corners (r = 40 on 1000×700) 0.2%. A denser cross-hatch measured 3.1% at width 2.5 and falls back
 * to keying — harmless for a dark ink, a light one fades there.
 */
export const OWN_ALPHA_SHARE = 0.05;

/** True when at least `OWN_ALPHA_SHARE` of the pixels are fully transparent (alpha 0): the image brings its own alpha. */
export function hasOwnTransparency(img: ImageData): boolean {
  const { data } = img;
  const pixels = data.length / 4;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 0) clear++;
  return clear >= pixels * OWN_ALPHA_SHARE;
}

/** Make the paper transparent in place; the ink keeps its colour. `img` is opaque (composited over white). */
export function keyOutPaper(img: ImageData): void {
  const { width: w, height: h, data } = img;
  const lum = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < lum.length; p++, i += 4) lum[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);

  const block = Math.max(16, Math.ceil(Math.max(w, h) / 16));
  const nx = Math.ceil(w / block);
  const ny = Math.ceil(h / block);
  const paper = new Float32Array(nx * ny);
  const hist = new Uint32Array(256);
  for (let by = 0; by < ny; by++) {
    for (let bx = 0; bx < nx; bx++) {
      hist.fill(0);
      const x1 = Math.min(w, (bx + 1) * block);
      const y1 = Math.min(h, (by + 1) * block);
      for (let y = by * block; y < y1; y++) for (let x = bx * block; x < x1; x++) hist[lum[y * w + x]]++;
      const n = (x1 - bx * block) * (y1 - by * block);
      const target = Math.ceil(n * PAPER_PERCENTILE);
      let seen = 0;
      let v = 0;
      for (; v < 255; v++) {
        seen += hist[v];
        if (seen >= target) break;
      }
      paper[by * nx + bx] = v;
    }
  }

  // Bilinear between block centres; clamped at the edges (the outer half-block takes the edge block's level).
  const cell = (f: number, n: number): [number, number, number] => {
    const c = Math.min(Math.max(f, 0), n - 1);
    const i0 = Math.floor(c);
    const i1 = Math.min(i0 + 1, n - 1);
    return [i0, i1, c - i0];
  };
  for (let y = 0; y < h; y++) {
    const [y0, y1, ty] = cell((y + 0.5) / block - 0.5, ny);
    for (let x = 0; x < w; x++) {
      const [x0, x1, tx] = cell((x + 0.5) / block - 0.5, nx);
      const top = paper[y0 * nx + x0] * (1 - tx) + paper[y0 * nx + x1] * tx;
      const bottom = paper[y1 * nx + x0] * (1 - tx) + paper[y1 * nx + x1] * tx;
      const d = top * (1 - ty) + bottom * ty - lum[y * w + x];
      const a = d <= KEY_LO ? 0 : d >= KEY_HI ? 1 : (d - KEY_LO) / (KEY_HI - KEY_LO);
      data[(y * w + x) * 4 + 3] = Math.round(a * 255);
    }
  }
}

// A transparent image FLATTENED ON BLACK (W22-F, ruling 2026-11-12 13:55): a messenger that sends the phone's PNG "as a
// photo" re-encodes it as a JPEG, and its clear pixels become black. Measured on the developer's WhatsApp file: no alpha,
// 94.5% near-black, the border's max channel ≤ 16 on 99.87% of it, 29 at most. Keyed as paper it came out backwards —
// the black around the strokes kept, the yellow removed. Measured in Chrome on the pad's own PNG flattened at JPEG
// quality 0.5: a pad-filling scribble keeps 95.1% of its border ≤ 24 (98.2% ≤ 40). A photo of paper does not reach that: a desk is
// noisy, a sheet is light. Bound (signing.md): a light sheet on a PURE-black surround (a scanner's black lid) passes the
// test, and its sheet is kept as the ink.

/** The max channel at or under which a pixel is the black sheet: above the noise measured on the real file's border (29 at most). */
const SHEET_BLACK = 32;
/** The share of the border that must be opaque and `SHEET_BLACK` for an image to be read as flattened on black. */
export const FLAT_BORDER_SHARE = 0.9;
/** At or under this max channel a pixel is clear: JPEG noise and ringing must not become faint ink. */
const INK_FLOOR = 40;
/** From this max channel a pixel counts as ink when finding the ink colour; fewer than `MIN_INK` such pixels → none. */
const INK_BRIGHT = 64;
const MIN_INK = 20;

const maxChannel = (d: Uint8ClampedArray, i: number) => Math.max(d[i], d[i + 1], d[i + 2]);

/** True when at least `FLAT_BORDER_SHARE` of the border pixels are opaque and black: a transparent image flattened on black. */
export function isFlattenedOnBlack(img: ImageData): boolean {
  const { width: w, height: h, data } = img;
  let n = 0;
  let black = 0;
  const at = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    n++;
    if (data[i + 3] === 255 && maxChannel(data, i) <= SHEET_BLACK) black++;
  };
  for (let x = 0; x < w; x++) {
    at(x, 0);
    if (h > 1) at(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    at(0, y);
    if (w > 1) at(w - 1, y);
  }
  return n > 0 && black >= n * FLAT_BORDER_SHARE;
}

/**
 * Key an image flattened on black, in place: the ink is what is BRIGHTER than the black, measured by the max channel
 * (pure blue ink has a luminance of 29 — the noise — and a max channel of 255). Flattening left `ink × coverage`, so the
 * coverage is `max channel / the ink's`, and every kept pixel is painted in the ONE ink colour (PTSIG and the pad carry
 * one ink per signature): dividing each pixel by its coverage would blow up the JPEG's colour error at the edges.
 * False when no ink brighter than the black is found (black ink sent as a photo: nothing is left to rescue).
 */
export function keyOutBlackSheet(img: ImageData): boolean {
  const { data } = img;
  const bright: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const m = maxChannel(data, i);
    if (m >= INK_BRIGHT) bright.push(i);
  }
  if (bright.length < MIN_INK) return false;
  // The ink: the brightest tenth of the bright pixels (the stroke cores, not their edges), its colour their mean.
  bright.sort((a, b) => maxChannel(data, a) - maxChannel(data, b));
  const core = bright.slice(Math.floor(bright.length * 0.9));
  const ink = [0, 0, 0];
  for (const i of core) for (let c = 0; c < 3; c++) ink[c] += data[i + c];
  for (let c = 0; c < 3; c++) ink[c] = Math.round(ink[c] / core.length);
  const inkMax = Math.max(ink[0], ink[1], ink[2]);
  for (let i = 0; i < data.length; i += 4) {
    const m = maxChannel(data, i);
    data[i + 3] = m <= INK_FLOOR ? 0 : Math.round(Math.min(1, m / inkMax) * 255);
    data[i] = ink[0];
    data[i + 1] = ink[1];
    data[i + 2] = ink[2];
  }
  return true;
}

/** The box of the pixels with any alpha, or null when the image is clear. */
export function inkBounds(img: ImageData): { x: number; y: number; w: number; h: number } | null {
  const { width: w, height: h, data } = img;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new SignatureImageError('decode', 'the image could not be read'));
    img.src = url;
  });
}

/** Load, cap, key and trim an image file into a transparent canvas of its ink. Refusals are `SignatureImageError`s. */
export async function loadSignatureImage(file: File, limits: ImportLimits = IMPORT_LIMITS): Promise<HTMLCanvasElement> {
  checkImageFile(file, limits);
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url); // the header: dimensions known (EXIF orientation applied), not yet decoded
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new SignatureImageError('decode', 'the image has no size');
    if (w * h > limits.maxPixels) throw new SignatureImageError('pixels', `${w}x${h}, over ${limits.maxPixels} pixels`);
    const s = Math.min(1, limits.maxSide / Math.max(w, h));
    const bw = Math.max(1, Math.round(w * s));
    const bh = Math.max(1, Math.round(h * s));
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(img, { resizeWidth: bw, resizeHeight: bh, resizeQuality: 'high' });
    } catch (e) {
      // A file whose header loads but whose body is broken (truncated, measured for PNG and JPEG) is rejected HERE, by
      // the decode, with a DOMException. Anything else is a bug, not a refused image.
      if (e instanceof DOMException) throw new SignatureImageError('decode', 'the image could not be decoded');
      throw e;
    }
    const work = document.createElement('canvas');
    work.width = bw;
    work.height = bh;
    const ctx = work.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.drawImage(bitmap, 0, 0); // on a CLEAR canvas first: does the image bring its own alpha?
    let data = ctx.getImageData(0, 0, bw, bh);
    if (isFlattenedOnBlack(data)) {
      if (!keyOutBlackSheet(data)) throw new SignatureImageError('flattened', 'a transparent image flattened on black, no light ink');
    } else if (!hasOwnTransparency(data)) {
      ctx.globalCompositeOperation = 'destination-over'; // white UNDER the image, as if drawn on paper
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, bw, bh);
      data = ctx.getImageData(0, 0, bw, bh);
      keyOutPaper(data);
    }
    bitmap.close();
    const box = inkBounds(data);
    if (!box) throw new SignatureImageError('empty', 'no ink found');
    const out = document.createElement('canvas');
    out.width = box.w;
    out.height = box.h;
    (out.getContext('2d') as CanvasRenderingContext2D).putImageData(data, -box.x, -box.y);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
