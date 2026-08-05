/**
 * EH-E false-positive corpus — the evidence the C9 (DOCX) decision needs.
 *
 * The CSV/XLSX exports can afford a false positive: the user asked for a table, so a wrong answer costs
 * them one discardable file. The DOCX path cannot — `reconstructPage` REMOVES in-region words from the
 * paragraph flow, so a phantom table silently mangles ordinary prose. That asymmetry is why C9 was left
 * gated, and "the gate is tight enough" is a claim that needs measuring rather than asserting.
 *
 * So: build realistic page shapes with pdf-lib, extract them with real pdf.js exactly as the export does,
 * and record what the detector says. The prose cases are the ones that matter — each is a shape a real
 * document contains, chosen because it could plausibly look tabular:
 *   - a two-column article (one clean whitespace band down the middle)
 *   - a BULLETED LIST (markers aligned in their own column, and every line spans both bands — so it
 *     defeats the multi-column-page discriminator, which is why it is the case I most expected to fail)
 *   - an indented block quote, a code listing (leading-space columns)
 *   - a sparse title page
 * Key-value pairs are recorded but NOT asserted either way: "Name: / Ada Lovelace" genuinely is a
 * two-column table by most definitions, so scoring it would be scoring an opinion.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { inferBorderlessGrid } from '../../src/utils/borderlessTable';
import type { TableTextItem } from '../../src/utils/tableExtract';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

interface RawItem { str: string; transform: number[]; width: number }
type Draw = (page: import('@cantoo/pdf-lib').PDFPage, font: import('@cantoo/pdf-lib').PDFFont) => void;

async function pageItems(draw: Draw): Promise<TableTextItem[]> {
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 320]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  draw(page, font);
  const bytes = await doc.save();
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pg = await pdf.getPage(1);
  const content = await pg.getTextContent();
  return (content.items as unknown as RawItem[])
    .filter(i => typeof i.str === 'string' && i.str.trim().length > 0)
    .map(i => ({ x: i.transform[4], y: i.transform[5], text: i.str, width: i.width }));
}

const T = (
  pg: import('@cantoo/pdf-lib').PDFPage, f: import('@cantoo/pdf-lib').PDFFont,
  s: string, x: number, y: number, size = 11,
): void => { pg.drawText(s, { x, y, size, font: f }); };

// ── genuine tables (must be FOUND) ────────────────────────────────────────────────────────────────
const invoice: Draw = (pg, f) => {
  const rows = [['Description', 'Qty', 'Unit', 'Total'], ['Widget A', '2', '9.99', '19.98'],
    ['Gadget B', '11', '24.50', '269.50'], ['Service fee', '1', '35.00', '35.00']];
  rows.forEach((r, i) => {
    const y = 270 - i * 22;
    T(pg, f, r[0], 40, y); T(pg, f, r[1], 230, y); T(pg, f, r[2], 310, y); T(pg, f, r[3], 400, y);
  });
};
const statement: Draw = (pg, f) => {
  const rows = [['01/03', 'Opening balance', '1,240.00'], ['04/03', 'Card payment', '-38.20'],
    ['09/03', 'Transfer in', '500.00'], ['15/03', 'Direct debit', '-72.15']];
  rows.forEach((r, i) => {
    const y = 270 - i * 22;
    T(pg, f, r[0], 40, y); T(pg, f, r[1], 120, y); T(pg, f, r[2], 390, y);
  });
};

// ── prose (must be REFUSED) ───────────────────────────────────────────────────────────────────────
const prose: Draw = (pg, f) => {
  ['The quick brown fox jumps over the lazy dog and then keeps',
    'running through the field until it reaches the far hedge where',
    'it pauses briefly before turning back toward the river bank,',
    'pursued at a distance by nothing at all that morning.',
    'Later the weather turned and the field emptied of everything.']
    .forEach((l, i) => T(pg, f, l, 40, 270 - i * 20));
};
const twoColumn: Draw = (pg, f) => {
  for (let i = 0; i < 6; i++) T(pg, f, 'left column body text here', 40, 270 - i * 20);
  for (let i = 0; i < 6; i++) T(pg, f, 'right column body text here', 270, 270 - i * 20);
};
const bulletList: Draw = (pg, f) => {
  ['First item of the list goes here', 'Second item of the list',
    'Third item, a bit longer than the rest', 'Fourth and final item']
    .forEach((l, i) => { const y = 270 - i * 24; T(pg, f, '•', 40, y); T(pg, f, l, 62, y); });
};
const blockQuote: Draw = (pg, f) => {
  ['Introductory sentence that runs the full measure of the page here',
    '    An indented quotation that sits inside the body copy',
    '    and continues onto a second line of its own.',
    'Closing sentence that again runs the full measure of it.']
    .forEach((l, i) => T(pg, f, l, 40, 270 - i * 20));
};
const codeListing: Draw = (pg, f) => {
  ['function add(a, b) {', '  const sum = a + b;', '  return sum;', '}', 'const total = add(2, 3);']
    .forEach((l, i) => T(pg, f, l, 40, 270 - i * 18, 10));
};
const titlePage: Draw = (pg, f) => {
  T(pg, f, 'ANNUAL REPORT', 150, 240, 20);
  T(pg, f, 'Financial year 2026', 170, 200);
  T(pg, f, 'Prepared by the office', 160, 170);
};
const keyValue: Draw = (pg, f) => {
  [['Name:', 'Ada Lovelace'], ['Role:', 'Mathematician'], ['Born:', '1815'], ['Notes:', 'First programmer']]
    .forEach(([k, v], i) => { const y = 270 - i * 24; T(pg, f, k, 40, y); T(pg, f, v, 160, y); });
};

describe('EH-E corpus — genuine borderless tables are FOUND', () => {
  it('an invoice-shaped 4x4 table', async () => {
    const g = inferBorderlessGrid(await pageItems(invoice));
    expect(g).not.toBeNull();
    expect(g?.rows).toBe(4);
    expect(g?.cols).toBeGreaterThanOrEqual(3);
  });

  it('a bank-statement-shaped 4x3 table', async () => {
    const g = inferBorderlessGrid(await pageItems(statement));
    expect(g).not.toBeNull();
    expect(g?.rows).toBe(4);
  });
});

describe('EH-E corpus — prose is REFUSED (the cases that gate C9)', () => {
  const proseCases: [string, Draw][] = [
    ['single-column prose', prose],
    ['two-column article', twoColumn],
    ['bulleted list', bulletList],
    ['indented block quote', blockQuote],
    ['code listing', codeListing],
    ['sparse title page', titlePage],
  ];

  for (const [name, draw] of proseCases) {
    it(`${name} is not a table`, async () => {
      const grid = inferBorderlessGrid(await pageItems(draw));
      expect(grid, `${name} was misread as a ${grid?.rows}x${grid?.cols} table`).toBeNull();
    });
  }
});

describe('EH-E corpus — deliberately unscored', () => {
  it('key-value pairs: recorded, not asserted (genuinely a 2-column table by most definitions)', async () => {
    const g = inferBorderlessGrid(await pageItems(keyValue));
    // No expectation on the verdict — only that asking the question does not throw. Scoring this would
    // be scoring an opinion, and a test that encodes an opinion as a requirement is a trap.
    expect(g === null || g.rows > 0).toBe(true);
  });
});
