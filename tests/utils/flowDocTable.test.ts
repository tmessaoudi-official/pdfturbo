/**
 * G9 — lattice (ruled) table → docx.Table.
 *
 * A page region bounded by ≥2 horizontal AND ≥2 vertical grid rules is detected
 * as a table, its cells filled from the positioned text items inside it, and
 * emitted as a real `w:tbl` in the DOCX. The table's text MUST NOT also appear as
 * normal `w:p` paragraphs (dedup). A page with no vertical rules emits NO table
 * (borderless tables are a documented ceiling) and is byte-identical to today.
 *
 * Synthetic-input jsdom guard: build RawTextItem[] + hRules/vRules (PDF user
 * space, y-up) directly and run reconstructPage → flowDocToDocxBase64, then unzip
 * with fflate and assert the document XML. The real op-walk → rules extraction is
 * covered separately (opStreamWalker + underline-strike browser test).
 */
import { describe, it, expect } from 'vitest';
import {
  reconstructPage,
  detectLatticeTables,
  type RawTextItem,
  type RuleRect,
  type FontInfoMap,
} from '../../src/utils/flowDoc';
import { flowDocToDocxBase64, flowDocToMarkdown, flowDocToText } from '../../src/utils/flowDocWriters';
import type { TableTextItem } from '../../src/utils/tableExtract';

const FONTS: FontInfoMap = { f1: { name: 'Helvetica', family: 'sans-serif' } };
const PAGE_W = 612;
const PAGE_H = 792;

/** Positioned text item with baseline origin (x, y) in PDF user space (y-up). */
function mkItem(str: string, x: number, y: number, size = 12): RawTextItem {
  return {
    str,
    dir: 'ltr',
    transform: [size, 0, 0, size, x, y],
    width: str.length * size * 0.5,
    height: size,
    fontName: 'f1',
    hasEOL: false,
  };
}

/**
 * A 2×2 lattice table near the page top:
 *   row bounds (y, y-up): 700 (top), 670 (mid), 640 (bottom)  → 2 rows
 *   col bounds (x):       100 (left), 250 (mid), 400 (right)  → 2 cols
 * Cells (reading order, top row first):
 *   [Name, Age]
 *   [Alice, 30]
 */
function tableHRules(): RuleRect[] {
  // Horizontal rules: thin (height 1), wide. y = bottom edge of the stroke.
  return [
    { x: 100, y: 700, width: 300, height: 1 },
    { x: 100, y: 670, width: 300, height: 1 },
    { x: 100, y: 640, width: 300, height: 1 },
  ];
}
function tableVRules(): RuleRect[] {
  // Vertical rules: thin (width 1), tall. x = left edge of the stroke.
  return [
    { x: 100, y: 640, width: 1, height: 60 },
    { x: 250, y: 640, width: 1, height: 60 },
    { x: 400, y: 640, width: 1, height: 60 },
  ];
}
/** Text items centered inside each of the 4 cells (baseline within the band). */
function tableItems(): RawTextItem[] {
  return [
    mkItem('Name', 110, 680),
    mkItem('Age', 260, 680),
    mkItem('Alice', 110, 650),
    mkItem('30', 260, 650),
  ];
}
/** Same four cell texts as bare TableTextItems (the pure detector's input shape). */
function tableTextItems(): TableTextItem[] {
  return tableItems().map(ti => ({ x: ti.transform[4], y: ti.transform[5], text: ti.str }));
}

async function unpackDocx(b64: string): Promise<Record<string, string>> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  const files = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [path, data] of Object.entries(files)) out[path] = strFromU8(data as Uint8Array);
  return out;
}

describe('detectLatticeTables — pure detection', () => {
  it('builds one 2×2 grid from ≥2 hRules and ≥2 vRules', () => {
    const tables = detectLatticeTables(tableTextItems(), tableHRules(), tableVRules(), PAGE_H);
    expect(tables.length).toBe(1);
    expect(tables[0].grid.rows).toBe(2);
    expect(tables[0].grid.cols).toBe(2);
    expect(tables[0].grid.cells[0]).toEqual(['Name', 'Age']);
    expect(tables[0].grid.cells[1]).toEqual(['Alice', '30']);
  });

  it('returns [] when there are no vertical rules (borderless — not attempted)', () => {
    expect(detectLatticeTables(tableTextItems(), tableHRules(), [], PAGE_H)).toEqual([]);
  });

  it('returns [] with only one vertical rule (cannot form a column)', () => {
    const oneV: RuleRect[] = [{ x: 100, y: 640, width: 1, height: 60 }];
    expect(detectLatticeTables(tableTextItems(), tableHRules(), oneV, PAGE_H)).toEqual([]);
  });
});

describe('reconstructPage — lattice table population + dedup', () => {
  it('attaches a FlowTable and removes in-table text from paragraphs', () => {
    const page = reconstructPage(
      tableItems(), FONTS, PAGE_W, PAGE_H,
      undefined, undefined, undefined, tableHRules(), 0, tableVRules(),
    );
    expect(page.tables?.length).toBe(1);
    // All four cell texts were consumed → no leftover paragraphs for them.
    const paraText = page.paragraphs.map(p => p.runs.map(r => r.text).join('')).join(' ');
    expect(paraText).not.toContain('Name');
    expect(paraText).not.toContain('Alice');
  });

  it('keeps text OUTSIDE the table region as normal paragraphs', () => {
    const items = [...tableItems(), mkItem('A heading above', 100, 740), mkItem('Body below the table', 100, 600)];
    const page = reconstructPage(
      items, FONTS, PAGE_W, PAGE_H,
      undefined, undefined, undefined, tableHRules(), 0, tableVRules(),
    );
    const paraText = page.paragraphs.map(p => p.runs.map(r => r.text).join('')).join(' ');
    expect(paraText).toContain('A heading above');
    expect(paraText).toContain('Body below the table');
    expect(page.tables?.length).toBe(1);
  });

  it('no vRules → no table; paragraph path unchanged (byte-identical guard)', () => {
    const withV = reconstructPage(tableItems(), FONTS, PAGE_W, PAGE_H, undefined, undefined, undefined, tableHRules(), 0, tableVRules());
    const noV = reconstructPage(tableItems(), FONTS, PAGE_W, PAGE_H, undefined, undefined, undefined, tableHRules(), 0, undefined);
    expect(withV.tables?.length).toBe(1);
    expect(noV.tables).toBeUndefined();
    // Without vRules the four items reconstruct as ordinary paragraphs.
    const noVtext = noV.paragraphs.map(p => p.runs.map(r => r.text).join('')).join(' ');
    expect(noVtext).toContain('Name');
  });
});

describe('flowDocToDocxBase64 — table emission', () => {
  it('emits a w:tbl with the cell texts and does NOT duplicate them in body paragraphs', async () => {
    const items = [...tableItems(), mkItem('Intro paragraph', 100, 740)];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H, undefined, undefined, undefined, tableHRules(), 0, tableVRules());
    const files = await unpackDocx(await flowDocToDocxBase64({ pages: [page] }));
    const xml = files['word/document.xml'];

    // A real table element is present.
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('Alice');
    expect(xml).toContain('Name');

    // Dedup: the cell texts must live inside the table, not in a paragraph that
    // sits outside it. Slice off the <w:tbl>…</w:tbl> span and assert the body
    // text outside the table does not repeat the cell text.
    const tblStart = xml.indexOf('<w:tbl>');
    const tblEnd = xml.indexOf('</w:tbl>') + '</w:tbl>'.length;
    const outsideTable = xml.slice(0, tblStart) + xml.slice(tblEnd);
    expect(outsideTable).not.toContain('Alice');
    expect(outsideTable).not.toContain('Name');
    // The non-table paragraph still made it through.
    expect(outsideTable).toContain('Intro paragraph');
  });

  it('a page with NO vertical rules emits NO w:tbl', async () => {
    const page = reconstructPage(tableItems(), FONTS, PAGE_W, PAGE_H, undefined, undefined, undefined, tableHRules(), 0, undefined);
    const files = await unpackDocx(await flowDocToDocxBase64({ pages: [page] }));
    expect(files['word/document.xml']).not.toContain('<w:tbl>');
  });

  it('table cells carry visible borders (w:tblBorders)', async () => {
    const page = reconstructPage(tableItems(), FONTS, PAGE_W, PAGE_H, undefined, undefined, undefined, tableHRules(), 0, tableVRules());
    const xml = (await unpackDocx(await flowDocToDocxBase64({ pages: [page] })))['word/document.xml'];
    expect(xml).toContain('w:tblBorders');
  });
});

describe('flowDocToMarkdown / flowDocToText — table rendering', () => {
  it('Markdown emits a GitHub pipe table for a detected lattice table', () => {
    const page = reconstructPage(tableItems(), FONTS, PAGE_W, PAGE_H, undefined, undefined, undefined, tableHRules(), 0, tableVRules());
    const md = flowDocToMarkdown({ pages: [page] });
    expect(md).toContain('| Name | Age |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| Alice | 30 |');
  });

  it('TXT emits tab-joined rows for a detected lattice table', () => {
    const page = reconstructPage(tableItems(), FONTS, PAGE_W, PAGE_H, undefined, undefined, undefined, tableHRules(), 0, tableVRules());
    const txt = flowDocToText({ pages: [page] });
    expect(txt).toContain('Name\tAge');
    expect(txt).toContain('Alice\t30');
  });
});
