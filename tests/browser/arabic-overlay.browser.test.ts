/**
 * Arabic overlay rendering end-to-end (real Chrome, Phase C): draw Arabic onto a
 * pdf-lib page via the CID glyph-ID path, save, re-open with pdf.js, and assert
 * the text is recovered as real Arabic (ToUnicode roundtrip) — NOT the '?' that
 * the old StandardFonts path produced. jsdom can't fetch the font asset.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { drawArabicLine } from '../../src/export/arabicOverlay';
import { isArabicText } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

/**
 * Column-wise ink-density profile over the inked bounding box, resampled to N
 * bins. Trimming leading/trailing blank columns makes it position-invariant, so
 * two renders of the same glyphs at different x-offsets compare equal — only the
 * left-to-right ink *shape* matters. Used to detect RTL mirror/reversal.
 */
function inkProfile(canvas: HTMLCanvasElement, bins = 120): number[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const { width: W, height: H } = canvas;
  const d = ctx.getImageData(0, 0, W, H).data;
  const col = new Array<number>(W).fill(0);
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      if ((d[i] + d[i + 1] + d[i + 2]) / 3 < 128) s++;
    }
    col[x] = s;
  }
  let lo = 0;
  let hi = W - 1;
  while (lo < W && col[lo] === 0) lo++;
  while (hi > 0 && col[hi] === 0) hi--;
  const seg = col.slice(lo, hi + 1);
  const out = new Array<number>(bins).fill(0);
  for (let k = 0; k < bins; k++) {
    const a = Math.floor((k * seg.length) / bins);
    const b = Math.max(a + 1, Math.floor(((k + 1) * seg.length) / bins));
    let s = 0;
    let n = 0;
    for (let j = a; j < b && j < seg.length; j++) {
      s += seg[j];
      n++;
    }
    out[k] = n ? s / n : 0;
  }
  return out;
}

function pearson(p: number[], q: number[]): number {
  const n = p.length;
  const mp = p.reduce((a, b) => a + b, 0) / n;
  const mq = q.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dp = 0;
  let dq = 0;
  for (let i = 0; i < n; i++) {
    const a = p[i] - mp;
    const b = q[i] - mq;
    num += a * b;
    dp += a * a;
    dq += b * b;
  }
  return num / Math.sqrt(dp * dq || 1);
}

describe('drawArabicLine (real Chrome)', () => {
  it('renders shaped Arabic recoverable as real Unicode (no "?")', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    await drawArabicLine(doc, page, {
      text: 'مرحبا',
      x: 20,
      y: 100,
      right: 280,
      size: 24,
      color: { r: 0, g: 0, b: 0 },
    });
    const bytes = await doc.save();

    // The content stream must carry a hex-encoded show-text (Tj), not a literal
    // '?' substitution from a Latin standard font.
    const ascii = String.fromCharCode(...bytes.subarray(0, bytes.length));
    expect(ascii).not.toContain('(?');

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const p = await pdf.getPage(1);
    const content = await p.getTextContent();
    const extracted = content.items.map((item) => (item as { str: string }).str).join('');
    // ToUnicode roundtrip recovers Arabic codepoints → real glyphs were embedded.
    expect(isArabicText(extracted)).toBe(true);
    expect(extracted).not.toContain('?');

    // Rasterize: the Arabic must actually paint visible ink (not a blank/tofu box)
    // and sit in the RIGHT half of the box (RTL right-alignment). Glyph ORDER /
    // mirror correctness is asserted separately in the next test (native-RTL corr).
    const scale = 3;
    const vp = p.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const cctx = canvas.getContext('2d');
    if (!cctx) throw new Error('no 2d context');
    await p.render({ canvas, canvasContext: cctx, viewport: vp }).promise;
    const px = cctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let darkCount = 0;
    let sumX = 0;
    let minX = canvas.width;
    let maxX = 0;
    for (let i = 0; i < px.length; i += 4) {
      // luminance < 128 = ink (white bg)
      if (px[i] < 128 && px[i + 1] < 128 && px[i + 2] < 128) {
        darkCount++;
        const x = (i / 4) % canvas.width;
        sumX += x;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    expect(darkCount).toBeGreaterThan(200); // visible ink, not blank
    const centroidX = sumX / darkCount;
    expect(centroidX).toBeGreaterThan(canvas.width / 2); // right-aligned (RTL)

    // Regression guard for the WOFF-embedding bug (2026-06-17): the broken `.woff`
    // font embedded only the `ا` (alef) outline — every other glyph rendered blank,
    // so the word collapsed to one narrow stroke (~840 dark px, ~25px wide at this
    // scale) yet still passed the weak ink/centroid checks above. A correctly
    // embedded font paints all 5 letters of "مرحبا" across a wide span. These
    // thresholds sit firmly between the two regimes (broken ~210/~25px vs fixed
    // ~1400/~135px at size 24, scale 3).
    expect(darkCount).toBeGreaterThan(900); // all glyphs paint, not just alef
    const inkWidthPx = maxX - minX;
    expect(inkWidthPx).toBeGreaterThan(80); // multi-glyph word width, not one stroke
  });

  // ORDER guard (2026-06-17): the assertions above (right-aligned + multi-glyph)
  // pass for a MIRROR-REVERSED word too — they never checked left-to-right glyph
  // order. This caught the reverseCidHex double-reversal: font.encodeText already
  // returns visual RTL order, so reversing it rendered the line mirror-backwards.
  // We compare the rendered ink profile against a NATIVE dir=rtl render of the same
  // string in the same font (ground truth); correct order correlates ~1, a mirror
  // correlates near 0. Must match the truth AND beat its mirror.
  it('renders Arabic in correct visual order — matches native RTL, not its mirror', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const S = 'محمد رسول الله';
    const size = 40;
    const doc = await PDFDocument.create();
    const page = doc.addPage([700, 110]);
    await drawArabicLine(doc, page, { text: S, x: 20, y: 45, right: 680, size, color: { r: 0, g: 0, b: 0 } });
    const bytes = await doc.save();

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const p = await pdf.getPage(1);
    const scale = 2;
    const vp = p.getViewport({ scale });
    const appCanvas = document.createElement('canvas');
    appCanvas.width = Math.ceil(vp.width);
    appCanvas.height = Math.ceil(vp.height);
    const appCtx = appCanvas.getContext('2d');
    if (!appCtx) throw new Error('no 2d context');
    appCtx.fillStyle = '#fff';
    appCtx.fillRect(0, 0, appCanvas.width, appCanvas.height);
    await p.render({ canvas: appCanvas, canvasContext: appCtx, viewport: vp }).promise;

    // Native ground truth: same string, same font, browser-shaped dir=rtl.
    const fontUrl = (await import('../../src/assets/fonts/NotoNaskhArabic-Regular.ttf?url')).default;
    const face = new FontFace('NotoNaskhOrderTest', `url(${fontUrl})`);
    await face.load();
    document.fonts.add(face);
    const refCanvas = document.createElement('canvas');
    refCanvas.width = appCanvas.width;
    refCanvas.height = appCanvas.height;
    const refCtx = refCanvas.getContext('2d');
    if (!refCtx) throw new Error('no 2d context');
    refCtx.fillStyle = '#fff';
    refCtx.fillRect(0, 0, refCanvas.width, refCanvas.height);
    refCtx.fillStyle = '#000';
    refCtx.font = `${size * scale}px NotoNaskhOrderTest`;
    refCtx.direction = 'rtl';
    refCtx.textAlign = 'right';
    refCtx.textBaseline = 'middle';
    refCtx.fillText(S, refCanvas.width - 20 * scale, refCanvas.height / 2);

    const pApp = inkProfile(appCanvas);
    const pRef = inkProfile(refCanvas);
    const corrCorrect = pearson(pApp, pRef);
    const corrMirror = pearson(pApp, [...pRef].reverse());
    // Correct order strongly correlates with native; mirror does not. (Measured:
    // fixed ≈ 0.98 correct / ≈ 0.2 mirror; reversed bug ≈ −0.06 correct.)
    expect(corrCorrect).toBeGreaterThan(0.8);
    expect(corrCorrect).toBeGreaterThan(corrMirror + 0.3);
  });

  // #3b — a line mixing Arabic with Latin/Western-digits used to route entirely
  // through the Arabic font, which has no Latin glyphs → "World"/"100" rendered as
  // .notdef (extracted as U+0000 tofu). Bidi run-segmentation now draws those runs
  // with Helvetica, so they survive as readable text.
  it('mixed Arabic + Latin/digits: non-Arabic runs render readable (no tofu)', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([420, 120]);
    await drawArabicLine(doc, page, {
      text: 'السعر 100 USD', x: 20, y: 60, right: 400, size: 28, color: { r: 0, g: 0, b: 0 },
    });
    const bytes = await doc.save();
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const p = await pdf.getPage(1);
    const extracted = (await p.getTextContent()).items.map((i) => (i as { str: string }).str).join('');
    expect(extracted.includes(String.fromCharCode(0))).toBe(false); // non-Arabic runs are real glyphs, not .notdef/tofu (U+0000)
    expect(extracted).toContain('100'); // Western digits present & readable
    expect(extracted).toContain('USD'); // Latin word present & readable
    expect(isArabicText(extracted)).toBe(true); // Arabic still present
  });

  // Slice-1 bidi engine: drawBidiLine now orders runs via the shared UAX#9 engine
  // (utils/bidi visualRuns). An embedded Latin WORD must render in correct L→R order
  // ("World", not "dlroW") AND sit left of the Arabic in a base-RTL line.
  it('embedded Latin word renders forward and left of the Arabic (engine run order)', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([420, 120]);
    await drawArabicLine(doc, page, {
      text: 'مرحبا World', x: 20, y: 60, right: 400, size: 28, color: { r: 0, g: 0, b: 0 },
    });
    const bytes = await doc.save();
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const p = await pdf.getPage(1);
    const items = (await p.getTextContent()).items as { str: string; transform: number[] }[];
    const all = items.map((i) => i.str).join('');
    expect(all).toContain('World'); // forward (Helvetica draws the logical run), not "dlroW"
    expect(isArabicText(all)).toBe(true);
    // The Latin run sits to the LEFT of the Arabic (base-RTL): min x of a Latin item
    // is less than min x of an Arabic item.
    const xOf = (pred: (s: string) => boolean) =>
      Math.min(...items.filter((i) => pred(i.str) && i.str.trim()).map((i) => i.transform[4]));
    const latinX = xOf((s) => /[A-Za-z]/.test(s));
    const arabicX = xOf((s) => isArabicText(s));
    expect(latinX).toBeLessThan(arabicX);
  });
});

// Feature 4 — stroke / Tc / Tz on the Arabic overlay. Strong regression signal: the
// stroke path emits setTextRenderingMode (FillAndOutline) and the Tz path emits setHScale;
// a plain Arabic control emits neither (catches a silent revert to the no-attr CID path).
describe('drawArabicLine advanced attrs (real Chrome)', () => {
  async function opsFor(opts: Parameters<typeof drawArabicLine>[2]): Promise<number[]> {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 120]);
    await drawArabicLine(doc, page, opts);
    const bytes = await doc.save();
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const p = await pdf.getPage(1);
    const list = await p.getOperatorList();
    return Array.from(list.fnArray as number[]);
  }
  const base = { text: 'مرحبا', x: 20, y: 60, right: 280, size: 28, color: { r: 0, g: 0, b: 0 } };

  it('strokeWidth emits setTextRenderingMode; plain control does not', async () => {
    const TR = pdfjsLib.OPS.setTextRenderingMode;
    expect(await opsFor({ ...base, strokeWidth: 1.5 })).toContain(TR);
    expect(await opsFor({ ...base })).not.toContain(TR);
  });

  it('horizontalScale emits setHScale; plain control does not', async () => {
    const HS = pdfjsLib.OPS.setHScale;
    expect(await opsFor({ ...base, horizontalScale: 160 })).toContain(HS);
    expect(await opsFor({ ...base })).not.toContain(HS);
  });

  it('charSpacing emits setCharSpacing; plain control does not', async () => {
    const TC = pdfjsLib.OPS.setCharSpacing;
    expect(await opsFor({ ...base, charSpacing: 3 })).toContain(TC);
    expect(await opsFor({ ...base })).not.toContain(TC);
  });
});
