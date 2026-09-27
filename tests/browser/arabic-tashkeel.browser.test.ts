/**
 * Limits row 25 (C19) — tashkeel (Arabic vowel marks) placed where the font's GPOS puts them.
 *
 * pdf-lib's embedder keeps only each glyph's advance width, so a mark (advance 0) drew at the pen with
 * none of its GPOS offset: off its base letter, and at the baseline instead of above or below it. The
 * oracle is Chrome shaping the same string with the same font (HarfBuzz): the ink of the exported line,
 * rendered by pdf.js, must overlap the ink Chrome draws. Every fixture carries marks with a NON-ZERO
 * yOffset, so a fix that moved glyphs sideways but not up would still fail.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { unzlibSync } from 'fflate';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { drawArabicLine, measureArabicLine } from '../../src/export/arabicOverlay';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const SIZE = 40, SCALE = 3, W = 500, H = 110, RIGHT = 480, BASE = 45;

async function exportLine(text: string) {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const pg = doc.addPage([W, H]);
  await drawArabicLine(doc, pg, { text, x: 10, y: BASE, right: RIGHT, size: SIZE, color: { r: 0, g: 0, b: 0 } });
  return doc.save({ useObjectStreams: false });
}

async function pdfInk(text: string): Promise<HTMLCanvasElement> {
  const pdf = await pdfjsLib.getDocument({ data: await exportLine(text) }).promise;
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: SCALE });
  const c = document.createElement('canvas');
  c.width = vp.width; c.height = vp.height;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, viewport: vp }).promise;
  return c;
}

/** The page's decoded content stream(s) as text. */
async function contentOps(text: string): Promise<string> {
  const { PDFDocument, PDFArray } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(await exportLine(text));
  const contents = doc.getPage(0).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map(r => doc.context.lookup(r)) : [contents];
  return streams.map(s => new TextDecoder('latin1').decode(unzlibSync((s as unknown as { contents: Uint8Array }).contents))).join('\n');
}

let faceReady: Promise<void> | null = null;
async function chromeInk(text: string): Promise<HTMLCanvasElement> {
  faceReady ??= (async () => {
    const url = (await import('../../src/assets/fonts/NotoNaskhArabic-Regular.ttf?url')).default;
    const face = new FontFace('NotoTashkeelOracle', `url(${url})`);
    await face.load();
    document.fonts.add(face);
  })();
  await faceReady;
  const c = document.createElement('canvas');
  c.width = W * SCALE; c.height = H * SCALE;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000';
  ctx.font = `${SIZE * SCALE}px NotoTashkeelOracle`;
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, RIGHT * SCALE, (H - BASE) * SCALE);
  return c;
}

/** Intersection over union of the two ink masks (dark pixels), same canvas size. */
function overlap(a: HTMLCanvasElement, b: HTMLCanvasElement): number {
  const da = (a.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, a.width, a.height).data;
  const db = (b.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, b.width, b.height).data;
  let inter = 0, union = 0;
  for (let i = 0; i < da.length; i += 4) {
    const x = da[i] < 128, y = db[i] < 128;
    if (x && y) inter++;
    if (x || y) union++;
  }
  return inter / union;
}

// Measured 2026-09-27 against Chrome: before the fix 0.737 / 0.820 / 0.823, after 0.964 / 1.000 / 0.974.
const VOWELLED = ['مُحَمَّدٌ', 'بِسْمِ اللَّهِ', 'قُلْ هُوَ'];

describe('Arabic overlay — tashkeel positioned by GPOS (row 25, C19)', () => {
  for (const text of VOWELLED) {
    it(`marks sit where Chrome shapes them: ${text}`, async () => {
      expect(overlap(await pdfInk(text), await chromeInk(text))).toBeGreaterThan(0.93);
    });
  }

  it('CONTROL: an unvowelled line already matched Chrome, and still does', async () => {
    expect(overlap(await pdfInk('مرحبا بكم'), await chromeInk('مرحبا بكم'))).toBeGreaterThan(0.99);
    // …and its bytes are the ones of before: a plain `<hex> Tj`, no TJ array and no text rise. Pixels
    // cannot see this (pdf.js draws Tj and TJ alike), which is why the operators are read.
    const ops = await contentOps('مرحبا بكم');
    expect(ops).toMatch(/>\s*Tj/);
    expect(ops).not.toMatch(/\]\s*TJ|[\d.-]+\s+Ts/);
  });

  it('a mark in a mixed Arabic + Latin line is positioned too (the bidi path)', async () => {
    const ops = await contentOps('مُحَمَّدٌ PDF');
    expect(ops).toMatch(/\]\s*TJ/);
    expect(ops).toMatch(/[1-9][\d.]*\s+Ts/);
  });

  it('measureArabicLine (the redaction footprint and the right-alignment) is the shaped advance Chrome measures', async () => {
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    await chromeInk(''); // loads the oracle font
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    ctx.font = `${SIZE}px NotoTashkeelOracle`;
    ctx.direction = 'rtl';
    for (const text of VOWELLED) {
      const w = await measureArabicLine(await PDFDocument.create(), { text, size: SIZE });
      expect(w).toBeCloseTo(ctx.measureText(text).width, 0);
    }
  });
});
