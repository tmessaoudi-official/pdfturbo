/**
 * DOCX #2 / true-edit Gap 2 regression — spot-color (Separation/`scn`) text must
 * keep its color on a Path-3 redraw instead of being recolored BLACK.
 *
 * The bug: `parseFillColorToRgb` only understands `rg`/`g`/`k`. A Separation/spot
 * fill is emitted as `<tint> scn`, which the parser can't resolve, so the Path-3
 * fallback redraw used to default to black — silently recoloring spot text. The
 * fix samples the rendered glyph color from the canvas and passes it as
 * `fallbackColor`; `resolveRedrawColor` then prefers it over black.
 *
 * This test forces Path-3 deliberately: a STANDARD Helvetica font (so the literal
 * byte-swap Path-1 is eligible) edited to text containing a non-ASCII WinAnsi char
 * (`é`) — `isAsciiSafe` is then false so Path-1 is skipped, there is no ToUnicode
 * subset so Path-2 is skipped, and `é` is WinAnsi so the redraw is NOT refused →
 * Path-3 runs. The fill is `scn`, so without the fix the redraw is black.
 *
 * jsdom cannot run this: it needs real pdf.js rasterization of a Separation
 * colorspace + canvas pixel sampling.
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
const ORIGINAL = 'Hello';
const NEW_TEXT = 'Héllo'; // non-ASCII WinAnsi `é` forces the Path-3 redraw

/**
 * Build a one-page PDF whose Helvetica text is filled via a Separation ("spot")
 * colorspace: `/CS0 cs 1 scn` with a Type-2 tint transform mapping tint 1 → an
 * orange (1, 0.5, 0). `page.drawText` cannot emit `scn`, so the content stream and
 * resources are constructed at the object level.
 */
async function makeSpotColorPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  // Separation /MySpot over DeviceRGB; tint 0 → white, tint 1 → orange.
  const tintFn = pdf.context.obj({
    FunctionType: 2,
    Domain: [0, 1],
    C0: [1, 1, 1],
    C1: [1, 0.5, 0],
    N: 1,
  });
  const sepCS = pdf.context.obj([
    PDFName.of('Separation'),
    PDFName.of('MySpot'),
    PDFName.of('DeviceRGB'),
    tintFn,
  ]);
  const sepRef = pdf.context.register(sepCS);

  const resources = pdf.context.obj({
    Font: { Helv: helv.ref },
    ColorSpace: { CS0: sepRef },
  });
  page.node.set(PDFName.of('Resources'), pdf.context.register(resources));

  const content = `/CS0 cs 1 scn BT /Helv 44 Tf 20 ${BASELINE} Td (${ORIGINAL}) Tj ET`;
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
  let r = 0;
  let g = 0;
  let b = 0;
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    const pr = data[i];
    const pg = data[i + 1];
    const pb = data[i + 2];
    // "Inked" = noticeably darker than the white background in some channel.
    if (255 - pr + (255 - pg) + (255 - pb) > 60) {
      r += pr;
      g += pg;
      b += pb;
      ink++;
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

describe('true-edit — spot-color (Separation/scn) text keeps its color on Path-3 redraw', () => {
  it('redraws in the canvas-sampled spot color, not black', async () => {
    const original = await makeSpotColorPdf();

    // Sanity: the fixture really renders in the spot color (orange: red ≫ blue).
    const orig = await sampleInkedColor(original);
    expect(orig.ink).toBeGreaterThan(50);
    expect(orig.r - orig.b).toBeGreaterThan(40);

    const origin = await originOf(original);
    // Mimic the handler: sample the glyph color from the rendered canvas and pass
    // it as the Path-3 fallback (normalized 0..1).
    const sampled = { r: orig.r / 255, g: orig.g / 255, b: orig.b / 255 };

    // (A) WITH the sampled fallback → the redraw keeps the spot color.
    const docA = await PDFDocument.load(original.slice(0));
    const okA = await replaceTextAt(docA, 0, origin, NEW_TEXT, 5, undefined, sampled);
    expect(okA).toBe(true);
    const colored = await sampleInkedColor(await docA.save());
    expect(colored.ink).toBeGreaterThan(50); // Path-3 actually drew the glyphs
    expect(colored.r - colored.b).toBeGreaterThan(50); // chromatic, red-dominant

    // (B) Control — WITHOUT a fallback the redraw falls back to black (the bug
    // this fix removes): the same edit renders achromatic and dark.
    const docB = await PDFDocument.load(original.slice(0));
    const okB = await replaceTextAt(docB, 0, origin, NEW_TEXT, 5);
    expect(okB).toBe(true);
    const black = await sampleInkedColor(await docB.save());
    expect(black.ink).toBeGreaterThan(50);
    expect(Math.abs(black.r - black.b)).toBeLessThan(30); // achromatic
    expect(black.r).toBeLessThan(140); // dark, not the orange spot color
  });
});
