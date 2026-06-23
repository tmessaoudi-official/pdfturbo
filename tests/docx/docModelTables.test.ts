import { describe, it, expect } from 'vitest';
import { parseDocModel, isDocTable, applyBlocks, applyParagraphRuns, type DocTable, type DocParagraph } from '../../src/docx/docModel';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
function docXml(bodyInner: string): string {
  return `<?xml version="1.0"?><w:document ${W}><w:body>${bodyInner}</w:body></w:document>`;
}
const para = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('docModel — applyBlocks (table-free equals applyParagraphRuns)', () => {
  it('produces the same output as applyParagraphRuns for paragraph-only edits', () => {
    const xml = docXml(para('one') + para('two'));
    const edited: DocParagraph[] = [{ runs: [{ text: 'ONE', bold: true }] }, { runs: [{ text: 'two' }] }];
    const viaBlocks = applyBlocks(xml, edited);
    const viaParas = applyParagraphRuns(xml, edited);
    expect(viaBlocks).toBe(viaParas);
    expect(parseDocModel(viaBlocks).paragraphs[0].runs[0]).toMatchObject({ text: 'ONE', bold: true });
  });

  it('append and remove paths are also byte-equal to applyParagraphRuns', () => {
    // Append: 1 DOM paragraph, 2 model paragraphs (extra cloned + appended at end).
    const xmlAppend = docXml(para('one'));
    const editedAppend: DocParagraph[] = [{ runs: [{ text: 'ONE' }] }, { runs: [{ text: 'TWO' }] }];
    expect(applyBlocks(xmlAppend, editedAppend)).toBe(applyParagraphRuns(xmlAppend, editedAppend));
    // Remove: 2 DOM paragraphs, 1 model paragraph (trailing removed).
    const xmlRemove = docXml(para('one') + para('two'));
    const editedRemove: DocParagraph[] = [{ runs: [{ text: 'ONE' }] }];
    expect(applyBlocks(xmlRemove, editedRemove)).toBe(applyParagraphRuns(xmlRemove, editedRemove));
  });
});

describe('docModel — blocks (paragraph-only back-compat)', () => {
  it('populates blocks alongside paragraphs for a table-free doc', () => {
    const model = parseDocModel(docXml(para('A') + para('B')));
    // paragraphs unchanged (top-level)
    expect(model.paragraphs.map(p => p.runs[0].text)).toEqual(['A', 'B']);
    // blocks mirror paragraphs, all kind paragraph (no DocTable in this case)
    expect(model.blocks).toHaveLength(2);
    expect(model.blocks.every(b => !isDocTable(b))).toBe(true);
    expect((model.blocks[0] as DocParagraph).runs[0].text).toBe('A');
  });
});

const cell = (text: string): string => `<w:tc><w:tcPr/><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const row = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
const table = (...rows: string[]): string => `<w:tbl><w:tblPr/><w:tblGrid/>${rows.join('')}</w:tbl>`;

/** A w:tbl whose w:tblGrid declares `cols` gridCol children (each 100 twips). */
const gridCols = (cols: number): string =>
  Array.from({ length: cols }, () => `<w:gridCol w:w="100"/>`).join('');
const tableG = (cols: number, ...rows: string[]): string =>
  `<w:tbl><w:tblPr/><w:tblGrid>${gridCols(cols)}</w:tblGrid>${rows.join('')}</w:tbl>`;
const countTag = (xml: string, tag: string): number => xml.split(`<${tag}`).length - 1;

describe('docModel — table structural reconcile (Slice 3b: add/del row & column)', () => {
  it('adds a new row in place (clones a w:tr, grid unchanged)', () => {
    const xml = docXml(tableG(2, row(cell('A1'), cell('B1'))));
    const model = parseDocModel(xml);
    const t = model.blocks[0] as DocTable;
    t.rows.push({ cells: [{ blocks: [{ runs: [{ text: 'A2' }] }] }, { blocks: [{ runs: [{ text: 'B2' }] }] }] });
    const out = applyBlocks(xml, model.blocks);
    expect(countTag(out, 'w:tr')).toBe(2);          // a row was added
    expect(countTag(out, 'w:gridCol')).toBe(2);     // grid column count unchanged
    expect(out).toContain('A2');
    expect(out).toContain('B2');
    const re = (parseDocModel(out).blocks[0] as DocTable).rows;
    expect(re).toHaveLength(2);
    expect((re[1].cells[1].blocks[0] as DocParagraph).runs[0].text).toBe('B2');
  });

  it('removes a row in place', () => {
    const xml = docXml(tableG(2, row(cell('A1'), cell('B1')), row(cell('A2'), cell('B2'))));
    const model = parseDocModel(xml);
    (model.blocks[0] as DocTable).rows.pop(); // delete the 2nd row
    const out = applyBlocks(xml, model.blocks);
    expect(countTag(out, 'w:tr')).toBe(1);
    expect(out).toContain('A1');
    expect(out).not.toContain('A2');
  });

  it('adds a column in place (every row gains a cell; grid gains a gridCol)', () => {
    const xml = docXml(tableG(2, row(cell('A1'), cell('B1')), row(cell('A2'), cell('B2'))));
    const model = parseDocModel(xml);
    const t = model.blocks[0] as DocTable;
    for (const r of t.rows) r.cells.push({ blocks: [{ runs: [{ text: 'NEW' }] }] });
    const out = applyBlocks(xml, model.blocks);
    expect(countTag(out, 'w:gridCol')).toBe(3);     // grid widened
    const re = (parseDocModel(out).blocks[0] as DocTable).rows;
    expect(re[0].cells).toHaveLength(3);
    expect(re[1].cells).toHaveLength(3);
    expect((re[0].cells[2].blocks[0] as DocParagraph).runs[0].text).toBe('NEW');
  });

  it('removes a column in place (every row loses a cell; grid loses a gridCol)', () => {
    const xml = docXml(tableG(2, row(cell('A1'), cell('B1')), row(cell('A2'), cell('B2'))));
    const model = parseDocModel(xml);
    const t = model.blocks[0] as DocTable;
    for (const r of t.rows) r.cells.pop(); // drop the last column
    const out = applyBlocks(xml, model.blocks);
    expect(countTag(out, 'w:gridCol')).toBe(1);
    const re = (parseDocModel(out).blocks[0] as DocTable).rows;
    expect(re[0].cells).toHaveLength(1);
    expect(out).toContain('A1');
    expect(out).not.toContain('B1');
  });

  it('a NON-structural cell edit is byte-identical to the 3a min-reconcile (grid verbatim)', () => {
    const xml = docXml(
      `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/></w:tblPr><w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="200"/></w:tblGrid>` +
      row(cell('A1'), cell('B1')) + row(cell('A2'), cell('B2')) + `</w:tbl>`,
    );
    const model = parseDocModel(xml);
    (model.blocks[0] as DocTable).rows[0].cells[0].blocks = [{ runs: [{ text: 'EDIT' }] }];
    const out = applyBlocks(xml, model.blocks);
    expect(out).toContain('<w:gridCol w:w="100"/>');
    expect(out).toContain('<w:gridCol w:w="200"/>');  // grid untouched on a non-structural edit
    expect(countTag(out, 'w:gridCol')).toBe(2);
    expect(out).toContain('EDIT');
  });

  it('adds a row to a merged table AND preserves the merge (3c/3d rebuild supersedes the 3b refusal)', () => {
    // Row 0 has a single cell spanning 2 grid columns (gridSpan=2); row 1 has 2 cells.
    const spanCell = `<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Merged</w:t></w:r></w:p></w:tc>`;
    const xml = docXml(`<w:tbl><w:tblPr/><w:tblGrid>${gridCols(2)}</w:tblGrid>` +
      row(spanCell) + row(cell('A2'), cell('B2')) + `</w:tbl>`);
    const model = parseDocModel(xml);
    // Add a 3rd row — 3c/3d now handles merged tables via the rebuild path.
    (model.blocks[0] as DocTable).rows.push({ cells: [{ blocks: [{ runs: [{ text: 'X' }] }] }] });
    const out = applyBlocks(xml, model.blocks);
    expect(countTag(out, 'w:tr')).toBe(3);                 // row added
    expect(out).toContain('<w:gridSpan w:val="2"/>');      // row-0 merge preserved
    expect(out).toContain('Merged');
    expect(out).toContain('X');
    const re = parseDocModel(out).blocks[0] as DocTable;
    expect(re.rows).toHaveLength(3);
    expect(re.rows[0].cells[0].colspan).toBe(2);
  });
});

describe('docModel — merge parsing (Slice 3c/3d: gridSpan + vMerge → colspan/rowspan)', () => {
  const spanCell = (text: string, n: number): string =>
    `<w:tc><w:tcPr><w:gridSpan w:val="${n}"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const vRestart = (text: string): string =>
    `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const vCont = (): string => `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`;

  it('reads a horizontal merge (gridSpan) as colspan; the covered position is absent', () => {
    const xml = docXml(tableG(2, row(spanCell('AB', 2)), row(cell('C'), cell('D'))));
    const t = parseDocModel(xml).blocks[0] as DocTable;
    expect(t.rows[0].cells).toHaveLength(1);
    expect(t.rows[0].cells[0].colspan).toBe(2);
    expect((t.rows[0].cells[0].blocks[0] as DocParagraph).runs[0].text).toBe('AB');
    expect(t.rows[1].cells).toHaveLength(2); // un-merged row keeps both cells
  });

  it('reads a vertical merge (vMerge restart+continue) as rowspan; the continuation cell is dropped', () => {
    // col 0 spans 2 rows (restart in row0, continue in row1); col 1 has normal cells.
    const xml = docXml(tableG(2, row(vRestart('A'), cell('B')), row(vCont(), cell('D'))));
    const t = parseDocModel(xml).blocks[0] as DocTable;
    expect(t.rows[0].cells).toHaveLength(2);
    expect(t.rows[0].cells[0].rowspan).toBe(2);
    expect((t.rows[0].cells[0].blocks[0] as DocParagraph).runs[0].text).toBe('A');
    expect(t.rows[1].cells).toHaveLength(1); // continuation placeholder dropped → only col-1 cell
    expect((t.rows[1].cells[0].blocks[0] as DocParagraph).runs[0].text).toBe('D');
  });

  it('leaves an un-merged cell with colspan/rowspan undefined (1)', () => {
    const xml = docXml(tableG(2, row(cell('A'), cell('B'))));
    const t = parseDocModel(xml).blocks[0] as DocTable;
    expect(t.rows[0].cells[0].colspan).toBeUndefined();
    expect(t.rows[0].cells[0].rowspan).toBeUndefined();
  });
});

describe('docModel — merge EMIT (Slice 3c/3d: colspan/rowspan → gridSpan/vMerge, in place)', () => {
  const spanCell = (text: string, n: number): string =>
    `<w:tc><w:tcPr><w:gridSpan w:val="${n}"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

  it('emits a horizontal merge (colspan=2) as w:gridSpan on a previously-simple table', () => {
    const xml = docXml(tableG(2, row(cell('A'), cell('B')), row(cell('C'), cell('D'))));
    const model = parseDocModel(xml);
    const t = model.blocks[0] as DocTable;
    // merge row0's two cells → one cell colspan 2
    t.rows[0] = { cells: [{ blocks: [{ runs: [{ text: 'A' }] }], colspan: 2 }] };
    const out = applyBlocks(xml, model.blocks);
    expect(out).toContain('<w:gridSpan w:val="2"/>');
    const re = (parseDocModel(out).blocks[0] as DocTable);
    expect(re.rows[0].cells).toHaveLength(1);
    expect(re.rows[0].cells[0].colspan).toBe(2);
    expect(re.rows[1].cells).toHaveLength(2); // un-merged row intact
  });

  it('emits a vertical merge (rowspan=2) as w:vMerge restart + continuation placeholder', () => {
    const xml = docXml(tableG(2, row(cell('A'), cell('B')), row(cell('C'), cell('D'))));
    const model = parseDocModel(xml);
    const t = model.blocks[0] as DocTable;
    // merge col0 across both rows: row0 col0 rowspan 2; row1 loses its col0 cell
    t.rows[0] = { cells: [{ blocks: [{ runs: [{ text: 'A' }] }], rowspan: 2 }, { blocks: [{ runs: [{ text: 'B' }] }] }] };
    t.rows[1] = { cells: [{ blocks: [{ runs: [{ text: 'D' }] }] }] };
    const out = applyBlocks(xml, model.blocks);
    expect(out).toContain('<w:vMerge w:val="restart"/>');
    expect(out).toContain('<w:vMerge/>'); // continuation placeholder fabricated
    const re = (parseDocModel(out).blocks[0] as DocTable);
    expect(re.rows[0].cells[0].rowspan).toBe(2);
    expect(re.rows[1].cells).toHaveLength(1);
  });

  it('SPLIT: removing a colspan re-expands the row to full cells (no gridSpan)', () => {
    const xml = docXml(tableG(2, row(spanCell('AB', 2)), row(cell('C'), cell('D'))));
    const model = parseDocModel(xml);
    const t = model.blocks[0] as DocTable;
    expect(t.rows[0].cells[0].colspan).toBe(2); // sanity: parsed as merged
    // split: row0 becomes two normal cells
    t.rows[0] = { cells: [{ blocks: [{ runs: [{ text: 'A' }] }] }, { blocks: [{ runs: [{ text: 'B' }] }] }] };
    const out = applyBlocks(xml, model.blocks);
    expect(out).not.toContain('w:gridSpan');
    const re = (parseDocModel(out).blocks[0] as DocTable);
    expect(re.rows[0].cells).toHaveLength(2);
    expect(re.rows[0].cells[0].colspan).toBeUndefined();
  });

  it('a TEXT edit on a merged table (structure unchanged) keeps the merge structure verbatim', () => {
    const xml = docXml(
      `<w:tbl><w:tblPr/><w:tblGrid>${gridCols(2)}</w:tblGrid>` +
      row(spanCell('AB', 2)) + row(cell('C'), cell('D')) + `</w:tbl>`,
    );
    const model = parseDocModel(xml);
    const t = model.blocks[0] as DocTable;
    (t.rows[0].cells[0].blocks[0] as DocParagraph).runs = [{ text: 'EDITED' }];
    const out = applyBlocks(xml, model.blocks);
    expect(out).toContain('<w:gridSpan w:val="2"/>'); // merge preserved
    expect(out).toContain('EDITED');
    const re = (parseDocModel(out).blocks[0] as DocTable);
    expect(re.rows[0].cells[0].colspan).toBe(2);
    expect((re.rows[0].cells[0].blocks[0] as DocParagraph).runs[0].text).toBe('EDITED');
  });
});

describe('docModel — table parsing', () => {
  it('parses a top-level table into a DocTable block in document order', () => {
    const xml = docXml(para('intro') + table(row(cell('A1'), cell('B1')), row(cell('A2'), cell('B2'))) + para('outro'));
    const model = parseDocModel(xml);
    // blocks: paragraph, table, paragraph
    expect(model.blocks.map(b => (b.kind === 'table' ? 'T' : 'P'))).toEqual(['P', 'T', 'P']);
    // paragraphs field excludes cell paragraphs
    expect(model.paragraphs.map(p => p.runs[0].text)).toEqual(['intro', 'outro']);
    const t = model.blocks[1] as DocTable;
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].cells).toHaveLength(2);
    const cellPara = t.rows[0].cells[0].blocks[0] as DocParagraph;
    expect(cellPara.runs[0].text).toBe('A1');
  });
});

describe('docModel — table cell round-trip (structure preserved)', () => {
  it('edits a cell paragraph and leaves tblPr/tblGrid/tcPr verbatim', () => {
    const xml = docXml(
      para('before') +
      `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/></w:tblPr><w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="200"/></w:tblGrid>` +
      row(cell('A1'), cell('B1')) + row(cell('A2'), cell('B2')) + `</w:tbl>` +
      para('after'),
    );
    const model = parseDocModel(xml);
    // Edit cell A1 → "EDITED"
    const t = model.blocks[1] as DocTable;
    (t.rows[0].cells[0].blocks[0] as DocParagraph).runs = [{ text: 'EDITED', bold: true }];
    const out = applyBlocks(xml, model.blocks);
    // Structure preserved verbatim
    expect(out).toContain('<w:tblStyle w:val="Grid"/>');
    expect(out).toContain('<w:gridCol w:w="100"/>');
    expect(out).toContain('<w:gridCol w:w="200"/>');
    // Cell A1 edited, siblings intact
    const re = parseDocModel(out);
    const rt = re.blocks[1] as DocTable;
    expect((rt.rows[0].cells[0].blocks[0] as DocParagraph).runs[0]).toMatchObject({ text: 'EDITED', bold: true });
    expect((rt.rows[0].cells[1].blocks[0] as DocParagraph).runs[0].text).toBe('B1');
    expect((rt.rows[1].cells[0].blocks[0] as DocParagraph).runs[0].text).toBe('A2');
    // Top-level paragraphs intact and ordered around the table
    expect(re.paragraphs.map(p => p.runs[0].text)).toEqual(['before', 'after']);
  });

  it('preserves table position when a paragraph is inserted before the table', () => {
    const xml = docXml(para('P1') + table(row(cell('C'))) + para('P2'));
    const model = parseDocModel(xml);
    // Insert a new top-level paragraph between P1 and the table.
    model.blocks.splice(1, 0, { runs: [{ text: 'P1.5' }] });
    const out = applyBlocks(xml, model.blocks);
    const re = parseDocModel(out);
    // Order must be P1, P1.5, TABLE, P2 — the table did NOT jump.
    expect(re.blocks.map(b => (b.kind === 'table' ? 'T' : (b as DocParagraph).runs[0].text))).toEqual(['P1', 'P1.5', 'T', 'P2']);
  });
});

describe('docModel — nested table round-trip', () => {
  it('edits a nested cell and preserves both outer and inner structure', () => {
    const inner = `<w:tbl><w:tblPr><w:tblStyle w:val="Inner"/></w:tblPr><w:tblGrid><w:gridCol w:w="50"/></w:tblGrid>${row(cell('inner-A'))}</w:tbl>`;
    // Outer cell contains a paragraph AND a nested table.
    const outerCell = `<w:tc><w:tcPr/><w:p><w:r><w:t>outer-lead</w:t></w:r></w:p>${inner}</w:tc>`;
    const xml = docXml(`<w:tbl><w:tblPr><w:tblStyle w:val="Outer"/></w:tblPr><w:tblGrid><w:gridCol w:w="300"/></w:tblGrid><w:tr>${outerCell}</w:tr></w:tbl>`);
    const model = parseDocModel(xml);
    const outer = model.blocks[0] as DocTable;
    const cellBlocks = outer.rows[0].cells[0].blocks;
    expect(cellBlocks.map(b => (b.kind === 'table' ? 'T' : 'P'))).toEqual(['P', 'T']); // lead para + nested table
    const innerTable = cellBlocks[1] as DocTable;
    (innerTable.rows[0].cells[0].blocks[0] as DocParagraph).runs = [{ text: 'INNER-EDITED' }];
    const out = applyBlocks(xml, model.blocks);
    expect(out).toContain('<w:tblStyle w:val="Outer"/>');
    expect(out).toContain('<w:tblStyle w:val="Inner"/>');
    const re = parseDocModel(out);
    const reInner = (re.blocks[0] as DocTable).rows[0].cells[0].blocks[1] as DocTable;
    expect((reInner.rows[0].cells[0].blocks[0] as DocParagraph).runs[0].text).toBe('INNER-EDITED');
  });
});
