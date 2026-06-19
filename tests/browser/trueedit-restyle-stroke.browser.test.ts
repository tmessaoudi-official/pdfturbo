/**
 * True-edit F1/F2 regression — real-Chrome pixel guards.
 *
 * F1 (restyle): a color restyle requested at edit time must reach the rendered
 *   output. Before the fix, Path 1 (literal byte-swap) swapped the payload and
 *   IGNORED `style`, so a recolor while editing standard-font text silently stayed
 *   the original color. The fix forces the Path-3 redraw whenever a restyle is asked.
 *
 * F2 (stroke): stroked/outline text (`Tr` 1) must keep its stroke color + width
 *   through a Path-3 redraw. Before the fix `buildPath3Redraw` emitted only `rg`
 *   (fill), so the redraw rendered as a plain black fill. The fix captures the
 *   stroke (`RG`/`w`) + render mode and re-emits them.
 *
 * jsdom cannot run either: both need real pdf.js rasterization + canvas pixel
 * sampling. The jsdom unit tests assert the emitted operators; these assert pixels.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, PDFName } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { replaceTextAt } from '../../src/utils/contentStreamEditor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const PAGE_W = 320;
const PAGE_H = 120;
const BASELINE = 45;

/** Build a one-page PDF with a single LITERAL `(text) Tj` in standard Helvetica.
 *  `extraState` is injected before the show op (e.g. a stroke setup for F2). */
async function makeLiteralPdf(text: string, extraState = ''): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const resources = pdf.context.obj({ Font: { Helv: helv.ref } });
  page.node.set(PDFName.of('Resources'), pdf.context.register(resources));
  const content = `BT /Helv 44 Tf ${extraState}20 ${BASELINE} Td (${text}) Tj ET`;
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(bytes)));
  return pdf.save();
}

/** Render page 1 onto a white canvas and average the color of all inked pixels. */
async function sampleInkedColor(
  bytes: Uint8Array,
  scale = 3,
): Promise<{ r: number; g: number; b: number; ink: number }> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no ctx');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let r = 0, g = 0, b = 0, ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    const pr = data[i], pg = data[i + 1], pb = data[i + 2];
    if (255 - pr + (255 - pg) + (255 - pb) > 60) {
      r += pr; g += pg; b += pb; ink++;
    }
  }
  if (ink === 0) return { r: 255, g: 255, b: 255, ink: 0 };
  return { r: r / ink, g: g / ink, b: b / ink, ink };
}

async function originOf(bytes: Uint8Array): Promise<{ x: number; y: number }> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  const item = (tc.items as Array<{ str: string; transform: number[] }>).find(
    (i) => i.str.trim().length > 0,
  );
  if (!item) throw new Error('no text item found');
  return { x: item.transform[4], y: item.transform[5] };
}

describe('true-edit F1 — a color restyle reaches the rendered output', () => {
  it('redraws standard-font text in the requested color (was black via Path 1)', async () => {
    const original = await makeLiteralPdf('Hello');
    const origin = await originOf(original);

    // Sanity: the fixture renders black.
    const orig = await sampleInkedColor(original);
    expect(orig.ink).toBeGreaterThan(50);
    expect(Math.abs(orig.r - orig.b)).toBeLessThan(30); // achromatic

    // (A) WITH a color restyle → forced Path-3 redraw renders RED.
    const docA = await PDFDocument.load(original.slice(0));
    const okA = await replaceTextAt(docA, 0, origin, 'Hello', 5, { color: { r: 1, g: 0, b: 0 } });
    expect(okA).toBe(true);
    const red = await sampleInkedColor(await docA.save());
    expect(red.ink).toBeGreaterThan(50);
    expect(red.r - red.b).toBeGreaterThan(50); // chromatic, red-dominant

    // (B) Control — WITHOUT a style the edit stays in place (Path 1) and BLACK.
    const docB = await PDFDocument.load(original.slice(0));
    const okB = await replaceTextAt(docB, 0, origin, 'Hello');
    expect(okB).toBe(true);
    const black = await sampleInkedColor(await docB.save());
    expect(black.ink).toBeGreaterThan(50);
    expect(Math.abs(black.r - black.b)).toBeLessThan(30); // still achromatic
  });
});

describe('true-edit F2 — stroked text keeps its stroke through a Path-3 redraw', () => {
  it('re-emits Tr + stroke color + width so the redraw renders blue, not black', async () => {
    // Tr 1 = stroke-only; blue stroke; 1.5pt width.
    const original = await makeLiteralPdf('Hello', '1 Tr 0 0 1 RG 1.5 w ');
    const origin = await originOf(original);

    // Sanity: the fixture renders blue (stroke).
    const orig = await sampleInkedColor(original);
    expect(orig.ink).toBeGreaterThan(40);
    expect(orig.b - orig.r).toBeGreaterThan(40); // blue-dominant

    // A size restyle forces Path 3 (F1); the redraw must keep the blue stroke (F2).
    const doc = await PDFDocument.load(original.slice(0));
    const ok = await replaceTextAt(doc, 0, origin, 'Hi', 5, { fontSize: 46 });
    expect(ok).toBe(true);
    const after = await sampleInkedColor(await doc.save());
    expect(after.ink).toBeGreaterThan(40);   // the redraw actually drew glyphs
    expect(after.b - after.r).toBeGreaterThan(40); // STILL blue-dominant (stroke kept)
  });
});
