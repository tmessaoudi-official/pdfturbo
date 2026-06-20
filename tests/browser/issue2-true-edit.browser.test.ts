/**
 * ISSUE-2 regression — editing text drawn in a SUBSET font must not lose the
 * replacement. Reproduces the heading "data loss" with a synthetic subset font
 * (LiberationSans embedded via fontkit with subset:true), then asserts the edit
 * both RENDERS (ink) and is TEXT-EXTRACTABLE after the fix.
 *
 * Before the fix two bugs combined: (1) the literal in-place byte-swap fired on
 * subset fonts → wrong/blank glyphs; (2) the standard-font fallback redraw was
 * appended via pdf-lib's page.drawText AFTER /Contents had been replaced, so it
 * landed in an orphaned stream — invisible and not extractable. Verified on a
 * real CID-font CV heading; this is the committed, fixture-free guard.
 *
 * jsdom cannot run this: needs real font subsetting + pdf.js rasterization.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import fontUrl from 'pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf?url';
import { replaceTextAt, findTextOpAt, isByteSwapUnsafeFont } from '../../src/utils/contentStreamEditor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const HEADING = 'Heading Sample Text';
const NEW_TEXT = 'ZZZSENTINEL'; // chars Z/N/I/L are not in HEADING's subset → forces fallback
const PAGE_W = 400;
const PAGE_H = 200;
const BASELINE = 150;

async function makeSubsetHeadingPdf(): Promise<Uint8Array> {
  const ttf = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(ttf, { subset: true });
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  page.drawText(HEADING, { x: 30, y: BASELINE, size: 24, font });
  return pdf.save();
}

async function inkInHeadingBand(bytes: Uint8Array, scale = 2): Promise<number> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no ctx');
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  // Heading band: around the baseline (PDF y-up → device y = (H - baseline)).
  const yTop = Math.floor((PAGE_H - BASELINE - 22) * scale);
  const yBot = Math.ceil((PAGE_H - BASELINE + 6) * scale);
  const { data } = ctx.getImageData(0, Math.max(0, yTop), canvas.width, Math.max(1, yBot - yTop));
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 180 && data[i + 1] < 180 && data[i + 2] < 180) ink++;
  }
  return ink;
}

async function extractText(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  return (tc.items as Array<{ str: string }>).map((i) => i.str).join('');
}

describe('ISSUE-2 — subset-font edit renders and stays extractable', () => {
  it('replaces a subset-font heading without losing the new text', async () => {
    const original = await makeSubsetHeadingPdf();

    // Sanity: the original renders.
    expect((await extractText(original)).includes('Heading')).toBe(true);
    expect(await inkInHeadingBand(original)).toBeGreaterThan(100);

    // Locate the heading op origin via pdf.js, then true-edit it.
    const pdfjsDoc = await pdfjsLib.getDocument({ data: original.slice(0) }).promise;
    const tc = await (await pdfjsDoc.getPage(1)).getTextContent();
    const item = (tc.items as Array<{ str: string; transform: number[] }>).find((i) => i.str.includes('Heading'));
    if (!item) throw new Error('heading item not found');
    const origin = { x: item.transform[4], y: item.transform[5] };

    const libDoc = await PDFDocument.load(original.slice(0));
    const op = await findTextOpAt(libDoc, 0, origin, 3);
    expect(op).not.toBeNull();
    // Confirm we exercised the byte-swap-unsafe path (the source of the data loss).
    expect(isByteSwapUnsafeFont(libDoc, 0, op?.fontKey ?? '')).toBe(true);
    const ok = await replaceTextAt(libDoc, 0, origin, NEW_TEXT, 3);
    // Slice B: this subset (byte-swap-unsafe) font is redrawn in a base-14 substitute → 'substituted'.
    expect(ok).toBe('substituted');
    const edited = await libDoc.save();

    // The new text must be BOTH extractable and actually rendered (ink present),
    // and the original heading must be gone.
    const editedText = await extractText(edited);
    expect(editedText).toContain(NEW_TEXT);
    expect(editedText).not.toContain('Heading Sample');
    expect(await inkInHeadingBand(edited)).toBeGreaterThan(100);
  });
});
