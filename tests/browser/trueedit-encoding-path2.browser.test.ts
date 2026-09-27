/**
 * Limits row 39 — an EMBEDDED simple font with NO /ToUnicode was never edited in place: 459 corpus runs (Type1C and
 * TrueType on a bare /WinAnsiEncoding, pdfTeX Type1 on /Differences with no base) were all redrawn in a base-14
 * substitute. The editor now reads such a font through its /Encoding and glyph names, and Path 2 reuses a code only
 * when the stream already draws it with that font.
 *
 * Oracle: REAL pdf.js, which reads these fonts through its own glyph list — independent of `glyphNames.ts`. An in-place
 * edit is proven by pdf.js reading the new digits at the run's origin in the SAME font it uses for an untouched run of
 * the same saved file, and by ink in the run's band (the glyphs draw, not blank). The control — a digit the stream never
 * draws — comes back in a different font. The fixture's Noto font is FULL, so it cannot show what an absent subset
 * glyph would look like; the presence rule is pinned by the control's outcome, not by pixels.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import fontUrl from '../../src/assets/fonts/NotoNaskhArabic-Regular.ttf?url';
import { replaceTextAt } from '../../src/utils/contentStreamEditor';
import { makeLiteralSubsetPdf, LITERAL_RUNS, type LiteralSubsetOptions } from '../utils/_literalSubsetFixture';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

type Item = { str: string; x: number; y: number; font: string };

async function items(bytes: Uint8Array): Promise<Item[]> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  const out = (tc.items as { str?: string; transform?: number[]; fontName?: string }[])
    .filter(i => i.str?.trim() && i.transform)
    .map(i => ({ str: i.str as string, x: (i.transform as number[])[4], y: (i.transform as number[])[5], font: i.fontName as string }));
  await doc.loadingTask.destroy();
  return out;
}

/** Dark pixels in the band of the run at (x, y) — 24 pt digits, page 400×400, rendered at scale 2. */
async function inkAt(bytes: Uint8Array, p: { x: number; y: number }): Promise<number> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('no 2d context');
  await page.render({ canvas, canvasContext: c2d, viewport: vp }).promise;
  const top = Math.floor((400 - p.y - 22) * 2);
  const { data } = c2d.getImageData(Math.floor(p.x * 2), top, 160, 30 * 2);
  await doc.loadingTask.destroy();
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128 && data[i + 3] > 0) ink++;
  return ink;
}

const at = (list: Item[], p: { x: number; y: number }) => list.find(i => Math.abs(i.x - p.x) < 0.5 && Math.abs(i.y - p.y) < 0.5);

async function fixture(o: LiteralSubsetOptions): Promise<Uint8Array> {
  const font = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
  return makeLiteralSubsetPdf(font, o);
}

const SHAPES: [string, LiteralSubsetOptions][] = [
  ['a bare /WinAnsiEncoding', { toUnicode: false, encoding: 'winansi' }],
  ['/Differences with no base', { toUnicode: false, baseEncoding: false }],
];

describe('true-edit — an embedded simple font without ToUnicode (limits row 39)', () => {
  it.each(SHAPES)('fixture (%s): pdf.js reads every run through the encoding, in one font', async (_n, o) => {
    const list = await items(await fixture(o));
    for (const r of Object.values(LITERAL_RUNS)) expect(at(list, r)?.str.replace(/\s/g, '')).toBe(r.text);
    expect(new Set(list.map(i => i.font)).size).toBe(1);
  });

  it.each(SHAPES.flatMap(([n, o]) => ([['tj', '54321'], ['tjArray', '0987'], ['mixed', '4321'], ['quote', '987']] as const)
    .map(([run, text]) => [n, run, text, o] as const)))('%s: an edit of the %s run keeps the embedded font', async (_n, run, text, o) => {
    const doc = await PDFDocument.load(await fixture(o));
    const r = LITERAL_RUNS[run];
    expect(await replaceTextAt(doc, 0, { x: r.x, y: r.y }, text, 1)).toBe(true);
    const saved = await doc.save();
    const after = await items(saved);
    const edited = at(after, r);
    const untouched = at(after, run === 'tj' ? LITERAL_RUNS.quote : LITERAL_RUNS.tj);
    expect(edited?.str.replace(/\s/g, '')).toBe(text);
    expect(untouched).toBeDefined();
    expect(edited?.font).toBe(untouched?.font);
    expect(await inkAt(saved, r)).toBeGreaterThan(200);
  });

  it.each(SHAPES)('control (%s): a digit the stream never draws is redrawn in a substitute font', async (_n, o) => {
    const doc = await PDFDocument.load(await fixture(o));
    const r = LITERAL_RUNS.tj;
    expect(await replaceTextAt(doc, 0, { x: r.x, y: r.y }, '12645', 1)).toBe('substituted');
    const after = await items(await doc.save());
    const redrawn = after.find(i => i.str.includes('12645'));
    const untouched = at(after, LITERAL_RUNS.quote);
    expect(redrawn).toBeDefined();
    expect(untouched).toBeDefined();
    expect(redrawn?.font).not.toBe(untouched?.font);
  });
});
