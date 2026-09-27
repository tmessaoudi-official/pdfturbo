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
import { inferBorderlessGrid, inferBorderlessGridForFlow, listLayoutGenre } from '../../src/utils/borderlessTable';
import { reconstructPage, type RawTextItem, type FontInfoMap, type FlowDoc } from '../../src/utils/flowDoc';
import { flowDocToDocxBase64 } from '../../src/utils/flowDocWriters';
import { ExportService, type IExportContext } from '../../src/export/exportService';
import type { DocumentPage } from '../../src/core/documentModel';
import type { IErrorReporter } from '../../src/core/errorReporter';
import type { TableTextItem } from '../../src/utils/tableExtract';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerShimUrl as string;

interface RawItem { str: string; transform: number[]; width: number }
type Draw = (page: import('@cantoo/pdf-lib').PDFPage, font: import('@cantoo/pdf-lib').PDFFont) => void;

async function pdfBytes(draw: Draw): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 320]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  draw(page, font);
  return doc.save();
}

async function rawItems(draw: Draw): Promise<RawItem[]> {
  const bytes = await pdfBytes(draw);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pg = await pdf.getPage(1);
  const content = await pg.getTextContent();
  return (content.items as unknown as RawItem[]).filter(i => typeof i.str === 'string');
}

async function pageItems(draw: Draw): Promise<TableTextItem[]> {
  return (await rawItems(draw))
    .filter(i => i.str.trim().length > 0)
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

// ── list layouts that pass every GEOMETRIC gate (limits row 20 — the C9 corpus's 10 false tables) ───────────────
const bookIndex: Draw = (pg, f) => {
  const cols = [
    ['Accrual 13', 'Adoption 29', 'Alimony 70', 'Annuities 60', 'Appeals 18', 'Assets 80', 'Awards 72', 'Bonds 59'],
    ['Casualty 104', 'Charity 97', 'Children 28', 'Credits 44', 'Custody 29', 'Damages 75', 'Debts 89', 'Dental 95'],
    ['Education 49', 'Elderly 74', 'Errors 44', 'Estates 75', 'Exempt 56', 'Fees 75', 'Filing 7', 'Fraud 16'],
    ['Gifts 76', 'Grants 73', 'Income 47 , 66', 'Interest 56', 'Jury 75', 'Lottery 75', 'Medical 95', 'Moving 94'],
  ];
  cols.forEach((col, c) => col.forEach((e, i) => T(pg, f, e, 40 + c * 112, 280 - i * 20, 10)));
};
const contents: Draw = (pg, f) => {
  T(pg, f, 'Contents', 40, 290);
  [['1 Introduction', '3'], ['2 Approach', '6'], ['2.1 Model . . . . . . . . . . . . . . . . .', '8'],
    ['2.2 Data . . . . . . . . . . . . . . . . . . .', '8'], ['3 Results', '10'], ['3.1 Tasks . . . . . . . . . . . . . . . . .', '11'],
    ['4 Limits', '14'], ['5 Impacts', '15'], ['6 Conclusion', '18']]
    .forEach(([t, n], i) => { const y = 266 - i * 24; T(pg, f, t, 40, y); T(pg, f, n, 440, y); });
};

describe('limits row 20 — the flow gate refuses list layouts the geometric gate accepts', () => {
  // The PAIRING is the point: each layout FIRES the geometric gate, so the refusal is the genre check doing the work,
  // not a fixture that never looked like a table.
  for (const [name, draw, genre] of [['a book index', bookIndex, 'index'], ['a table of contents', contents, 'contents']] as const) {
    it(`${name} passes the geometric gate and is refused as '${genre}'`, async () => {
      const items = await pageItems(draw);
      const g = inferBorderlessGrid(items);
      expect(g, 'the geometric gate must fire, or this case tests nothing').not.toBeNull();
      expect(listLayoutGenre(g as NonNullable<typeof g>)).toBe(genre);
      expect(inferBorderlessGridForFlow(items)).toBeNull();
    });
  }

  it('the invoice and the statement pass both gates', async () => {
    for (const draw of [invoice, statement]) expect(inferBorderlessGridForFlow(await pageItems(draw))).not.toBeNull();
  });

  // The WIRING: `reconstructPage` builds its own table input from the words; driving it end to end is what shows the
  // flow receives the table (a helper test cannot see a dropped `width`).
  const flow = async (draw: Draw) =>
    reconstructPage((await rawItems(draw)) as unknown as RawTextItem[], {} as FontInfoMap, 500, 320);

  it('an invoice page exports as one table and no paragraphs', async () => {
    const page = await flow(invoice);
    expect(page.tables?.length).toBe(1);
    expect(page.tables?.[0].grid.cells[1]).toEqual(['Widget A', '2', '9.99', '19.98']);
    expect(page.paragraphs).toHaveLength(0);
    // In Word it is a table with no drawn borders — the PDF had none.
    const { unzipSync, strFromU8 } = await import('fflate');
    const xml = strFromU8(unzipSync(Uint8Array.from(atob(await flowDocToDocxBase64({ pages: [page] })), c => c.charCodeAt(0)))['word/document.xml']);
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('Widget A');
    expect(xml).toMatch(/<w:tblBorders><w:top w:val="none"/);
    expect(xml).not.toMatch(/w:val="single"/);
  });

  it('prose drawn as several runs per line exports with no table — the flow must know where each run ENDS', async () => {
    // Real text arrives as several items per line (a bold word, a font change). Without each item's width, every gap
    // between two run STARTS reads as a column gutter: dropping `width` from the flow's table input read 114 of the
    // corpus's 360 pages as tables instead of 5, while every fixture drawn one item per cell stayed green.
    const { StandardFonts } = await import('@cantoo/pdf-lib');
    const styled: Draw = (pg, f) => {
      const bold = pg.doc.embedStandardFont(StandardFonts.HelveticaBold);
      const lines = [
        ['The survey ran for', 'three months', 'and reached every district'],
        ['in the region, including', 'remote villages', 'that had never been counted'],
        ['before. Results were', 'published early', 'to the local councils'],
        ['who asked for', 'a second round', 'the following spring'],
        ['once the roads', 'reopened after', 'the winter floods'],
      ];
      lines.forEach((segs, i) => {
        let x = 40;
        segs.forEach((seg, k) => {
          const font = k === 1 ? bold : f;
          T(pg, font, seg, x, 270 - i * 20);
          x += font.widthOfTextAtSize(seg, 11) + font.widthOfTextAtSize(' ', 11);
        });
      });
    };
    const raw = await rawItems(styled);
    expect(raw.filter(i => i.str.trim()).length, 'several items per line, or this case tests nothing').toBeGreaterThanOrEqual(15);
    const page = await flow(styled);
    expect(page.tables).toBeUndefined();
  });

  // The export itself: `_extractFlowDoc` walks the page's operators for rules, and a RULED table must still take the
  // lattice path — the borderless branch runs only when that finds nothing.
  const exported = async (draw: Draw): Promise<FlowDoc> => {
    const bytes = await pdfBytes(draw);
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const loud = {
      info() {}, silent(_e?: unknown, msg?: string) { throw new Error(`export reported: ${msg}`); },
      warn(k: string) { throw new Error(`export warned: ${k}`); },
      error(k: string, e?: unknown) { throw new Error(`export errored: ${k} ${String(e)}`); },
    } as unknown as IErrorReporter;
    try {
      const svc = new ExportService({
        documentModel: { pages: [{ id: 'p1', sourcePdfId: 's1', sourcePageNum: 1, rotation: 0 } as DocumentPage], sourcePdfs: new Map([['s1', { doc, bytes }]]) },
        elements: [], reportError: loud,
      } as unknown as IExportContext) as unknown as { _extractFlowDoc(): Promise<FlowDoc> };
      return await svc._extractFlowDoc();
    } finally {
      await doc.loadingTask.destroy();
    }
  };

  it('the real export: a whitespace invoice is a borderless table, the same invoice ruled is a lattice one', async () => {
    const plain = (await exported(invoice)).pages[0];
    expect(plain.tables?.length).toBe(1);
    expect(plain.tables?.[0].borderless).toBe(true);
    const ruled: Draw = (pg, f) => {
      invoice(pg, f);
      for (const y of [288, 262, 240, 218, 196]) pg.drawLine({ start: { x: 34, y }, end: { x: 460, y }, thickness: 0.8 });
      for (const x of [34, 222, 302, 392, 460]) pg.drawLine({ start: { x, y: 196 }, end: { x, y: 288 }, thickness: 0.8 });
    };
    const lattice = (await exported(ruled)).pages[0];
    expect(lattice.tables?.length).toBe(1);
    expect(lattice.tables?.[0].borderless).toBeUndefined();
  });

  it('prose, an index and a contents page export as paragraphs with no table (controls)', async () => {
    for (const draw of [prose, bookIndex, contents]) {
      const page = await flow(draw);
      expect(page.tables).toBeUndefined();
      expect(page.paragraphs.length).toBeGreaterThan(0);
    }
  });
});

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
