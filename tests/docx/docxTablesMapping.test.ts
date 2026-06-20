import { describe, it, expect } from 'vitest';
import { docxSchema } from '../../src/docx/docxSchema';
import { docModelToDoc, docToDocModel } from '../../src/docx/docxProseMirror';
import type { DocModel, DocTable, DocParagraph } from '../../src/docx/docModel';

describe('docxSchema — table nodes', () => {
  it('includes prosemirror-tables node types', () => {
    expect(docxSchema.nodes.table).toBeDefined();
    expect(docxSchema.nodes.table_row).toBeDefined();
    expect(docxSchema.nodes.table_cell).toBeDefined();
  });
  it('cells accept block content (paragraphs + nested tables)', () => {
    const cell = docxSchema.nodes.table_cell;
    // cellContent 'block+' → a paragraph is valid cell content
    const p = docxSchema.nodes.paragraph.createAndFill();
    expect(p).not.toBeNull();
    expect(cell.contentMatch.matchType(docxSchema.nodes.paragraph)).not.toBeNull();
  });
});

const rt = (m: DocModel): DocModel => docToDocModel(docModelToDoc(m));
const p = (text: string): DocParagraph => ({ runs: [{ text }] });

describe('docModel ⇄ PM — table mapping', () => {
  it('round-trips a table with cell text', () => {
    const table: DocTable = { kind: 'table', rows: [
      { cells: [{ blocks: [p('A1')] }, { blocks: [p('B1')] }] },
      { cells: [{ blocks: [p('A2')] }, { blocks: [p('B2')] }] },
    ] };
    const model: DocModel = { blocks: [p('intro'), table], paragraphs: [p('intro')] };
    const back = rt(model);
    expect(back.blocks.map(b => (b.kind === 'table' ? 'T' : (b as DocParagraph).runs[0].text))).toEqual(['intro', 'T']);
    const bt = back.blocks[1] as DocTable;
    expect(bt.rows).toHaveLength(2);
    expect((bt.rows[0].cells[0].blocks[0] as DocParagraph).runs[0].text).toBe('A1');
    expect((bt.rows[1].cells[1].blocks[0] as DocParagraph).runs[0].text).toBe('B2');
  });

  it('round-trips a nested table', () => {
    const inner: DocTable = { kind: 'table', rows: [{ cells: [{ blocks: [p('inner')] }] }] };
    const outer: DocTable = { kind: 'table', rows: [{ cells: [{ blocks: [p('lead'), inner] }] }] };
    const back = rt({ blocks: [outer], paragraphs: [] });
    const bo = back.blocks[0] as DocTable;
    const cellBlocks = bo.rows[0].cells[0].blocks;
    expect(cellBlocks.map(b => (b.kind === 'table' ? 'T' : 'P'))).toEqual(['P', 'T']);
    expect(((cellBlocks[1] as DocTable).rows[0].cells[0].blocks[0] as DocParagraph).runs[0].text).toBe('inner');
  });

  it('a table between two list paragraphs splits the list run (does not merge across the table)', () => {
    const li = (text: string): DocParagraph => ({ runs: [{ text }], list: { ordered: false, level: 0 } });
    const table: DocTable = { kind: 'table', rows: [{ cells: [{ blocks: [p('cell')] }] }] };
    const model: DocModel = { blocks: [li('a'), table, li('b')], paragraphs: [li('a'), li('b')] };
    const back = rt(model);
    // The table must sit BETWEEN the two list paragraphs — order preserved, table not merged into a list.
    expect(back.blocks.map(b => (b.kind === 'table' ? 'T' : (b as DocParagraph).runs[0].text))).toEqual(['a', 'T', 'b']);
    // Both surviving paragraphs are still list items (the list membership round-trips on each side of the table).
    const [first, , third] = back.blocks;
    expect((first as DocParagraph).list).toBeDefined();
    expect((third as DocParagraph).list).toBeDefined();
  });
});
