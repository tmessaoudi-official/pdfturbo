/**
 * Limits row 21 (D10, real pdf.js) — multi-column pages export column by column.
 *
 * Until row 21 a column gutter had to be 5% of the page wide, and real two-column papers leave 12–17 pt (2–3%): the
 * Word/Markdown/text export of BERT's page 2 read `Unlike left-to- These approaches have been generalized to right
 * language model …`, the two columns interleaved line by line. And a 4-column page was cut 1|3, then capped, so it
 * came out as 3 groups. Each page here is drawn with pdf-lib, extracted by pdf.js and reconstructed by the export's
 * own `reconstructPage`; the oracle is the text as drawn, column after column.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { reconstructPage, type RawTextItem, type FontInfoMap } from '../../src/utils/flowDoc';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

const W = 595, H = 842;

/** `cols` columns of `lines` lines each, `gutter` points apart; returns the page's reconstructed text. */
async function exported(cols: number, gutter: number, lines: string[][], size = 10): Promise<string> {
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const colW = (W - 2 * 54 - (cols - 1) * gutter) / cols;
  lines.forEach((col, c) => col.forEach((l, i) =>
    page.drawText(l, { x: 54 + c * (colW + gutter), y: 760 - i * size * 1.2, size, font, maxWidth: colW })));
  const pdf = await pdfjsLib.getDocument({ data: await doc.save() }).promise;
  const p = await pdf.getPage(1);
  const items = (await p.getTextContent()).items as unknown as RawTextItem[];
  const flow = reconstructPage(items, {} as FontInfoMap, W, H);
  await pdf.loadingTask.destroy();
  expect(flow.tables ?? [], 'read as prose, not claimed by the borderless-table gate').toHaveLength(0);
  return flow.paragraphs.map(par => par.runs.map(r => r.text).join('')).join(' ').replace(/\s+/g, ' ').trim();
}

describe('limits row 21 — columns come out one after the other', () => {
  it('a two-column paper with a 14pt gutter (BERT leaves 12–17)', async () => {
    const left = ['The left column opens the', 'argument and carries it', 'down the page until it', 'reaches the bottom margin.'];
    const right = ['The right column picks it', 'up again at the top and', 'finishes the thought only', 'after the left one ends.'];
    expect(await exported(2, 14, [left, right])).toBe([...left, ...right].join(' '));
  });

  // Prose lines of five words: short aligned cells (three words or fewer) are what the borderless-table gate claims
  // as a table since limits row 20, which is right for them and not the case under test here.
  const prose = (n: number) => Array.from({ length: n }, (_, c) =>
    ['alpha beta gamma delta epsilon', 'zeta eta theta iota kappa', 'lambda mu nu xi omicron'].map(l => `c${c + 1} ${l}`));

  it('a four-column page', async () => {
    const cols = prose(4);
    expect(await exported(4, 18, cols, 7)).toBe(cols.flat().join(' '));
  });

  it('a five-column page', async () => {
    const cols = prose(5);
    expect(await exported(5, 16, cols, 6)).toBe(cols.flat().join(' '));
  });
});
