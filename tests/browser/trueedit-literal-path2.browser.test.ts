/**
 * Limits row 38 — Path 2 (reuse the embedded font's own glyphs through its ToUnicode) rewrote HEX operands only, so
 * an embedded simple font written as LITERAL strings went to the Path-3 base-14 redraw — 171 corpus runs, all
 * pdfTeX literals, measured by row 17.
 *
 * Oracle: REAL pdf.js. The fixture's font is the vendored Noto Naskh TTF with /Differences mapping 0x21..0x2A to the
 * digits, so an in-place edit is proven by pdf.js reading the new digits at the run's own origin in the SAME font it
 * uses for an untouched run of the same saved file (pdf.js font ids carry the document number, so the comparison
 * stays inside one document), while the Path-3 control comes back in a different font.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from '@cantoo/pdf-lib';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import fontUrl from '../../src/assets/fonts/NotoNaskhArabic-Regular.ttf?url';
import { replaceTextAt } from '../../src/utils/contentStreamEditor';
import { makeLiteralSubsetPdf, LITERAL_RUNS } from '../utils/_literalSubsetFixture';

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

const at = (list: Item[], p: { x: number; y: number }) => list.find(i => Math.abs(i.x - p.x) < 0.5 && Math.abs(i.y - p.y) < 0.5);

async function fixture(): Promise<Uint8Array> {
  const font = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
  return makeLiteralSubsetPdf(font);
}

describe('true-edit — Path 2 on literal-string operands (limits row 38)', () => {
  it('fixture: pdf.js reads every run through the ToUnicode, in one font', async () => {
    const list = await items(await fixture());
    for (const r of Object.values(LITERAL_RUNS)) expect(at(list, r)?.str.replace(/\s/g, '')).toBe(r.text);
    expect(new Set(list.map(i => i.font)).size).toBe(1);
  });

  it.each([
    ['tj', '54321'],
    ['tjArray', '0987'],
    ['mixed', '4321'],
    ['quote', '987'],
  ] as const)('an edit of the %s run keeps the embedded font', async (run, text) => {
    const doc = await PDFDocument.load(await fixture());
    const r = LITERAL_RUNS[run];
    expect(await replaceTextAt(doc, 0, { x: r.x, y: r.y }, text, 1)).toBe(true);
    const after = await items(await doc.save());
    const edited = at(after, r);
    const untouched = at(after, run === 'tj' ? LITERAL_RUNS.quote : LITERAL_RUNS.tj);
    expect(edited?.str.replace(/\s/g, '')).toBe(text);
    expect(untouched).toBeDefined();
    expect(edited?.font).toBe(untouched?.font);
  });

  it('control: a character the ToUnicode cannot encode is redrawn in a substitute font', async () => {
    const doc = await PDFDocument.load(await fixture());
    const r = LITERAL_RUNS.tj;
    expect(await replaceTextAt(doc, 0, { x: r.x, y: r.y }, '12A45', 1)).toBe('substituted');
    const after = await items(await doc.save());
    const redrawn = after.find(i => i.str.includes('12A45'));
    const untouched = at(after, LITERAL_RUNS.quote);
    expect(redrawn).toBeDefined();
    expect(untouched).toBeDefined();
    expect(redrawn?.font).not.toBe(untouched?.font);
  });
});
