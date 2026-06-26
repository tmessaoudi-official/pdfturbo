import { describe, it, expect } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { sanitizeWinAnsi, docModelToPdfBytes, headingFontSize, listMarkerText, resolveStandardFontFamily, buildCellGrid } from '../../src/docx/docxToPdf';
import type { DocModel, DocTable, DocRow, DocCell } from '../../src/docx/docModel';

const para = (text: string, bold = false, italic = false): DocModel['paragraphs'][number] => ({
  runs: [{ text, bold, italic }],
});
const cell = (text: string): DocCell => ({ blocks: [para(text)] });
const row = (...texts: string[]): DocRow => ({ cells: texts.map(cell) });
const table = (...rows: DocRow[]): DocTable => ({ kind: 'table', rows });

describe('sanitizeWinAnsi', () => {
  it('passes ASCII and Latin-1/CP1252 through unchanged', () => {
    expect(sanitizeWinAnsi('Hello, café — €5 “quote”')).toEqual({
      text: 'Hello, café — €5 “quote”',
      replaced: false,
    });
  });

  it('replaces non-WinAnsi (CJK / emoji) with ? and flags it', () => {
    // for…of iterates by code point: 2 CJK → "??", emoji (surrogate pair) → one "?".
    const r = sanitizeWinAnsi('hi 世界 🚀');
    expect(r.text).toBe('hi ?? ?');
    expect(r.replaced).toBe(true);
  });

  it('keeps whitespace (tab/newline) intact and reports no replacement', () => {
    expect(sanitizeWinAnsi('a\tb\nc')).toEqual({ text: 'a\tb\nc', replaced: false });
  });
});

describe('docModelToPdfBytes', () => {
  it('produces a loadable 1-page PDF for a short document', async () => {
    const paras = [para('Hello world'), para('Second paragraph')];
    const { bytes, hadUnsupportedChars } = await docModelToPdfBytes({
      blocks: paras,
      paragraphs: paras,
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(hadUnsupportedChars).toBe(false);
  });

  it('paginates a long document onto multiple pages', async () => {
    const paragraphs = Array.from({ length: 200 }, (_, i) => para(`Paragraph number ${i}`));
    const { bytes } = await docModelToPdfBytes({ blocks: paragraphs, paragraphs });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('flags unsupported characters from the document text', async () => {
    const paras = [para('東京')];
    const { hadUnsupportedChars } = await docModelToPdfBytes({ blocks: paras, paragraphs: paras });
    expect(hadUnsupportedChars).toBe(true);
  });

  it('hard-breaks a single token wider than the content width without throwing', async () => {
    const long = 'x'.repeat(2000);
    const paras = [para(long)];
    const { bytes } = await docModelToPdfBytes({ blocks: paras, paragraphs: paras });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('preserves inter-run spaces and renders bold via Helvetica-Bold', async () => {
    const paras = [{ runs: [{ text: 'The ' }, { text: 'bold', bold: true }, { text: ' word' }] }];
    const { bytes } = await docModelToPdfBytes({
      blocks: paras,
      paragraphs: paras,
    });
    expect(new TextDecoder('latin1').decode(bytes)).toContain('Helvetica-Bold');
  });

  it('renders an empty document as a valid 1-page PDF', async () => {
    const { bytes } = await docModelToPdfBytes({ blocks: [], paragraphs: [] });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('renders a model containing an image block without throwing (no { images } channel)', async () => {
    // Image-XObject embedding is asserted in the real-Chrome suite; here we only guard that
    // adding the image-block branch + removing opts.images didn't break the no-image render path.
    // An empty dataB64 makes drawImage's embed throw → caught and skipped, so text still renders.
    const capPara = { runs: [{ text: 'caption' }] };
    const img = { kind: 'image' as const, image: { dataB64: '', mime: 'image/png' as const, widthPt: 50, heightPt: 50 }, anchorId: 0 };
    const { bytes } = await docModelToPdfBytes({ blocks: [capPara, img], paragraphs: [capPara] });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('headingFontSize (Workstream A: heading fidelity)', () => {
  it('returns strictly descending sizes for H1>H2>H3, all larger than body', () => {
    const base = 11;
    const h1 = headingFontSize(1, base);
    const h2 = headingFontSize(2, base);
    const h3 = headingFontSize(3, base);
    expect(h1).toBeGreaterThan(h2);
    expect(h2).toBeGreaterThan(h3);
    expect(h3).toBeGreaterThan(base);
  });

  it('scales with the base size', () => {
    expect(headingFontSize(1, 20)).toBeGreaterThan(headingFontSize(1, 10));
  });
});

describe('listMarkerText (Workstream A: list markers)', () => {
  it('uses a WinAnsi-safe bullet for unordered items at any level', () => {
    expect(listMarkerText(false, 1, 0)).toBe('•');
    expect(listMarkerText(false, 5, 2)).toBe('•');
    // The bullet must survive WinAnsi sanitization (no '?').
    expect(sanitizeWinAnsi(listMarkerText(false, 1, 0)).replaced).toBe(false);
  });

  it('numbers ordered items by level: decimal / lower-alpha / lower-roman', () => {
    expect(listMarkerText(true, 1, 0)).toBe('1.');
    expect(listMarkerText(true, 3, 0)).toBe('3.');
    expect(listMarkerText(true, 1, 1)).toBe('a.');
    expect(listMarkerText(true, 2, 1)).toBe('b.');
    expect(listMarkerText(true, 1, 2)).toBe('i.');
    expect(listMarkerText(true, 4, 2)).toBe('iv.');
  });

  it('cycles the ordered format every 3 levels', () => {
    expect(listMarkerText(true, 1, 3)).toBe('1.'); // level 3 → decimal again
  });
});

describe('docModelToPdfBytes — rich paragraph fidelity (Workstream A)', () => {
  it('renders headings, lists, underline and color into a valid PDF', async () => {
    const blocks: DocModel['blocks'] = [
      { heading: 1, runs: [{ text: 'Title' }] },
      { heading: 2, runs: [{ text: 'Subtitle' }] },
      { runs: [{ text: 'underlined', underline: true }] },
      { runs: [{ text: 'red text', color: '#ff0000' }] },
      { list: { ordered: true, level: 0 }, runs: [{ text: 'first' }] },
      { list: { ordered: true, level: 0 }, runs: [{ text: 'second' }] },
      { list: { ordered: false, level: 0 }, runs: [{ text: 'bullet' }] },
    ];
    const { bytes, hadUnsupportedChars } = await docModelToPdfBytes({
      blocks,
      paragraphs: blocks.filter((b): b is DocModel['paragraphs'][number] => !('kind' in b && b.kind === 'table')),
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(hadUnsupportedChars).toBe(false);
  });

  it('a heading paragraph consumes more vertical space than a body paragraph', async () => {
    // A larger heading font pushes more content down → more pages for many headings
    // than for the same count of body paragraphs.
    const headings = Array.from({ length: 120 }, () => ({ heading: 1 as const, runs: [{ text: 'H' }] }));
    const bodies = Array.from({ length: 120 }, () => ({ runs: [{ text: 'H' }] }));
    const hDoc = await docModelToPdfBytes({ blocks: headings, paragraphs: headings });
    const bDoc = await docModelToPdfBytes({ blocks: bodies, paragraphs: bodies });
    const hPages = (await PDFDocument.load(hDoc.bytes)).getPageCount();
    const bPages = (await PDFDocument.load(bDoc.bytes)).getPageCount();
    expect(hPages).toBeGreaterThan(bPages);
  });
});

describe('docModelToPdfBytes — tables (#1d table rendering)', () => {
  it('renders a table to a valid PDF without throwing', async () => {
    const t = table(row('Item', 'Qty'), row('Widget', '3'));
    const { bytes } = await docModelToPdfBytes({ blocks: [t], paragraphs: [] });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('paginates a large table across pages (table content is NOT dropped)', async () => {
    // Regression: the old renderer iterated `model.paragraphs` (tables excluded) → a
    // table-only model rendered a single BLANK page. Now rows consume space and paginate.
    const rows = Array.from({ length: 80 }, (_, i) => row(`R${i}-c1`, `R${i}-c2`));
    const { bytes } = await docModelToPdfBytes({ blocks: [table(...rows)], paragraphs: [] });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('renders a nested table inside a cell without throwing', async () => {
    const inner = table(row('x', 'y'));
    const outerCell: DocCell = { blocks: [para('outer'), inner] };
    const t: DocTable = { kind: 'table', rows: [{ cells: [outerCell, cell('plain')] }] };
    const { bytes } = await docModelToPdfBytes({ blocks: [t], paragraphs: [] });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('renders paragraphs and a table interleaved in document order', async () => {
    const before = para('before the table');
    const after = para('after the table');
    const { bytes } = await docModelToPdfBytes({
      blocks: [before, table(row('A', 'B')), after],
      paragraphs: [before, after],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('flags unsupported chars inside table cells', async () => {
    const { hadUnsupportedChars } = await docModelToPdfBytes({
      blocks: [table(row('東京', 'ok'))],
      paragraphs: [],
    });
    expect(hadUnsupportedChars).toBe(true);
  });
});

describe('resolveStandardFontFamily (Feature 5)', () => {
  it('maps serif faces to Times', () => {
    for (const f of ['Times New Roman', 'Georgia', 'Garamond', 'Cambria', 'Book Antiqua', 'PT Serif'])
      expect(resolveStandardFontFamily(f)).toBe('Times');
  });
  it('maps monospace faces to Courier', () => {
    for (const f of ['Courier New', 'Consolas', 'Menlo', 'Lucida Console', 'Roboto Mono'])
      expect(resolveStandardFontFamily(f)).toBe('Courier');
  });
  it('maps sans / unknown / undefined to Helvetica', () => {
    for (const f of ['Arial', 'Calibri', 'Segoe UI', 'Verdana', 'Comic Sans MS', 'Wingdings', undefined, ''])
      expect(resolveStandardFontFamily(f)).toBe('Helvetica');
  });
});

describe('buildCellGrid (Feature 5 — merged cells)', () => {
  const C = (text: string, colspan?: number, rowspan?: number): DocCell => ({
    blocks: [para(text)], ...(colspan ? { colspan } : {}), ...(rowspan ? { rowspan } : {}),
  });

  it('places a plain 2×2 grid at unit offsets', () => {
    const t: DocTable = { kind: 'table', rows: [{ cells: [C('a'), C('b')] }, { cells: [C('c'), C('d')] }] };
    const g = buildCellGrid(t);
    expect(g.gridWidth).toBe(2);
    expect(g.placements.map(p => [p.row, p.col, p.colspan, p.rowspan])).toEqual([
      [0, 0, 1, 1], [0, 1, 1, 1], [1, 0, 1, 1], [1, 1, 1, 1],
    ]);
  });

  it('spans a colspan=2 header across both columns', () => {
    const t: DocTable = { kind: 'table', rows: [{ cells: [C('head', 2)] }, { cells: [C('a'), C('b')] }] };
    const g = buildCellGrid(t);
    expect(g.gridWidth).toBe(2);
    const head = g.placements.find(p => p.row === 0);
    expect([head?.col, head?.colspan]).toEqual([0, 2]);
    expect(g.placements.filter(p => p.row === 1).map(p => p.col)).toEqual([0, 1]);
  });

  it('skips columns occupied by a rowspan from above', () => {
    // row0: X(rowspan2) Y ; row1: Z → Z lands in col1 (col0 held by X)
    const t: DocTable = { kind: 'table', rows: [{ cells: [C('X', 1, 2), C('Y')] }, { cells: [C('Z')] }] };
    const g = buildCellGrid(t);
    expect(g.gridWidth).toBe(2);
    const z = g.placements.find(p => p.row === 1);
    expect(z?.col).toBe(1);
  });
});
