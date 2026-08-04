/**
 * EH-E end-to-end against REAL pdf.js output.
 *
 * The unit tests (tests/utils/borderlessTable.test.ts) use synthetic geometry, which proves the
 * algorithm but not that it survives contact with pdf.js: item widths come from font metrics, text is
 * fragmented in ways a fixture never reproduces, and baselines carry real rounding. So: draw a
 * borderless table with pdf-lib, extract it with pdf.js exactly as exportTableCsv does, and check both
 * the positive case and the refusal case.
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerShimUrl from '../../src/utils/pdf-worker-shim?worker&url';
import { buildTableGrid, gridToCsv, type TableTextItem } from '../../src/utils/tableExtract';
import { inferBorderlessGrid } from '../../src/utils/borderlessTable';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

interface RawItem { str: string; transform: number[]; width: number }

/** Exactly the mapping exportService._extractPageTableData performs, width included. */
async function itemsOf(bytes: Uint8Array): Promise<TableTextItem[]> {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  return (content.items as unknown as RawItem[])
    .filter(it => typeof it.str === 'string' && it.str.trim().length > 0 && Array.isArray(it.transform))
    .map(it => ({ x: it.transform[4], y: it.transform[5], text: it.str, width: it.width }));
}

/** No rules drawn anywhere — columns exist only as whitespace. */
async function borderlessTablePdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const rows = [
    ['Item', 'Qty', 'Price'],
    ['Widget', '2', '9.99'],
    ['Gadget', '11', '24.50'],
    ['Doohickey', '3', '5.00'],
  ];
  const xs = [50, 250, 400];
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      page.drawText(cell, { x: xs[c], y: 240 - r * 20, size: 12, font });
    });
  });
  return doc.save();
}

/** A page of ordinary prose — the false-positive case. */
async function prosePdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = [
    'The quick brown fox jumps over the lazy dog and then keeps',
    'running through the field until it reaches the far hedge where',
    'it pauses briefly before turning back toward the river bank,',
    'pursued at a distance by nothing in particular that morning.',
  ];
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 240 - i * 20, size: 11, font }));
  return doc.save();
}

describe('EH-E — borderless table extraction from a real PDF', () => {
  it('the lattice detector finds NOTHING (there are no rules) — the precondition', async () => {
    const items = await itemsOf(await borderlessTablePdf());
    // No rules at all, so the ruled path cannot form a grid. If this ever passes, the test below is
    // no longer exercising the borderless path.
    expect(buildTableGrid([], [], items)).toBeNull();
  });

  it('the borderless detector recovers the 4x3 grid and its reading order', async () => {
    const items = await itemsOf(await borderlessTablePdf());
    const grid = inferBorderlessGrid(items);
    expect(grid).not.toBeNull();
    expect(grid?.rows).toBe(4);
    expect(grid?.cols).toBe(3);
    expect(gridToCsv(grid as NonNullable<typeof grid>)).toBe(
      'Item,Qty,Price\nWidget,2,9.99\nGadget,11,24.50\nDoohickey,3,5.00',
    );
  });

  it('REFUSES a page of real prose', async () => {
    const items = await itemsOf(await prosePdf());
    expect(inferBorderlessGrid(items)).toBeNull();
  });
});
