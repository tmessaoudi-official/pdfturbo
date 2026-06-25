/**
 * A2 (true-edit) — semi-transparent text (`ca`/`CA` via an ExtGState `gs`) must keep
 * its alpha on a Path-3 redraw instead of being repainted fully opaque.
 *
 * The bug: `locateTextOps` never captured the active ExtGState, so a Path-3
 * standard-font redraw of watermark/faded text came out solid. The fix records the
 * `gs` resource name, looks up its `ca`/`CA`, and re-emits a `gs` (alpha<1) inside
 * the redraw `q…Q` block.
 *
 * Path-3 is forced the same way as the spot-color test: a STANDARD Helvetica font
 * edited to text with a non-ASCII WinAnsi char (`é`) → Path-1 byte-swap skipped, no
 * ToUnicode subset for Path-2, `é` is WinAnsi so the redraw is not refused → Path-3.
 * jsdom can't run this (needs real pdf.js rasterization + canvas alpha sampling).
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

/** One-page PDF: black Helvetica text, optionally under a `gs` with `ca` alpha. */
async function makePdf(alpha: number | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const res = alpha !== null
    ? pdf.context.obj({ Font: { Helv: helv.ref }, ExtGState: { GS0: { ca: alpha, CA: alpha } } })
    : pdf.context.obj({ Font: { Helv: helv.ref } });
  page.node.set(PDFName.of('Resources'), pdf.context.register(res));
  const gsPrefix = alpha !== null ? '/GS0 gs ' : '';
  const content = `${gsPrefix}0 0 0 rg BT /Helv 44 Tf 20 ${BASELINE} Td (${ORIGINAL}) Tj ET`;
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 0xff;
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(bytes)));
  return pdf.save();
}

/** Average luminance of inked (non-white) pixels; higher = lighter (more transparent). */
async function sampleInkLuminance(bytes: Uint8Array, scale = 3): Promise<{ lum: number; ink: number }> {
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
  let sum = 0, ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    const pr = data[i], pg = data[i + 1], pb = data[i + 2];
    if (255 - pr + (255 - pg) + (255 - pb) > 60) { sum += (pr + pg + pb) / 3; ink++; }
  }
  return ink === 0 ? { lum: 255, ink: 0 } : { lum: sum / ink, ink };
}

async function originOf(bytes: Uint8Array): Promise<{ x: number; y: number }> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  const item = (tc.items as Array<{ str: string; transform: number[] }>).find(i => i.str.trim().length > 0);
  if (!item) throw new Error('no text item');
  return { x: item.transform[4], y: item.transform[5] };
}

describe('true-edit — Path-3 redraw preserves ExtGState alpha (A2)', () => {
  it('redraws faded text lighter than an opaque control', async () => {
    const faded = await makePdf(0.3);   // text under /GS0 gs with ca 0.3
    const opaque = await makePdf(null); // identical text, no gs (fully opaque)

    const docA = await PDFDocument.load(faded.slice(0));
    expect(await replaceTextAt(docA, 0, await originOf(faded), NEW_TEXT, 5)).toBe(true);
    const a = await sampleInkLuminance(await docA.save());

    const docB = await PDFDocument.load(opaque.slice(0));
    expect(await replaceTextAt(docB, 0, await originOf(opaque), NEW_TEXT, 5)).toBe(true);
    const b = await sampleInkLuminance(await docB.save());

    expect(a.ink).toBeGreaterThan(50); // the redraw actually drew glyphs
    expect(b.ink).toBeGreaterThan(50);
    // Alpha 0.3 black-on-white renders mid-gray; opaque renders near-black.
    expect(a.lum).toBeGreaterThan(b.lum + 40);
  });
});
