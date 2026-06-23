import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell } from 'docx';
import { docxSchema } from '../../src/docx/docxSchema';
import { docModelToDoc, docToDocModel, mountDocxEditor } from '../../src/docx/docxProseMirror';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';
import type { DocModel, DocTable, DocParagraph } from '../../src/docx/docModel';

/** Build the same minimal .docx as docxEditor.test.ts (Plain + BoldWord + table with "Cell A"). */
async function makeDocxWithTable(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: 'Plain' })] }),
        new Paragraph({ children: [new TextRun({ text: 'BoldWord', bold: true }), new TextRun({ text: ' ital', italics: true })] }),
        new Table({
          rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('Cell A')] })] })],
        }),
      ],
    }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

describe('mountDocxEditor — save routes through applyBlocks (table cell edits propagate)', () => {
  it('save() preserves a table through an unedited round-trip', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const h = mountDocxEditor(container, await makeDocxWithTable());
    const saved = h.save();
    h.destroy();
    container.remove();
    const xml = getDocumentXml(openOpc(saved));
    expect(xml).toContain('<w:tbl');
    expect(xml).toContain('Cell A');
  });

  it('save() propagates a cell text edit (requires applyBlocks not applyParagraphRuns)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const h = mountDocxEditor(container, await makeDocxWithTable());

    // Find the position of "Cell A" inside the PM doc.
    let cellTextPos = -1;
    let cellTextLen = 0;
    h.view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.includes('Cell A')) {
        cellTextPos = pos;
        cellTextLen = node.text.length;
        return false;
      }
      return true;
    });
    expect(cellTextPos).toBeGreaterThan(0); // sanity: text found

    // Edit "Cell A" → "Cell B" inside the table cell.
    h.view.dispatch(h.view.state.tr.insertText('Cell B', cellTextPos, cellTextPos + cellTextLen));

    const saved = h.save();
    h.destroy();
    container.remove();

    const xml = getDocumentXml(openOpc(saved));
    expect(xml).toContain('<w:tbl');
    // Cell edit must propagate — requires save() to use applyBlocks(edited.blocks).
    expect(xml).toContain('Cell B');
    expect(xml).not.toContain('Cell A');
  });
});

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

  it('round-trips a horizontally-merged cell (colspan) through PM', () => {
    const table: DocTable = { kind: 'table', rows: [
      { cells: [{ blocks: [p('AB')], colspan: 2 }] },
      { cells: [{ blocks: [p('C')] }, { blocks: [p('D')] }] },
    ] };
    const back = rt({ blocks: [table], paragraphs: [] });
    const bt = back.blocks[0] as DocTable;
    expect(bt.rows[0].cells).toHaveLength(1);
    expect(bt.rows[0].cells[0].colspan).toBe(2);
    expect(bt.rows[1].cells).toHaveLength(2);
  });

  it('round-trips a vertically-merged cell (rowspan) through PM', () => {
    const table: DocTable = { kind: 'table', rows: [
      { cells: [{ blocks: [p('A')], rowspan: 2 }, { blocks: [p('B')] }] },
      { cells: [{ blocks: [p('D')] }] },
    ] };
    const back = rt({ blocks: [table], paragraphs: [] });
    const bt = back.blocks[0] as DocTable;
    expect(bt.rows[0].cells[0].rowspan).toBe(2);
    expect(bt.rows[1].cells).toHaveLength(1);
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
