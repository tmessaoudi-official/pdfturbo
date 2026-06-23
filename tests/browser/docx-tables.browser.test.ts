/**
 * Task 9 — DOCX table editing, real-Chrome round-trip guard.
 *
 * jsdom (docxTablesMapping.test.ts) proves the model/save/schema/mapper logic; this
 * exercises what jsdom can't: a REAL ProseMirror view with table layout in a live
 * browser environment, cell text edits + a nested-table cell edit, save() re-zipping,
 * reopen, asserting both outer and inner table structure + edited text survive.
 *
 * Also asserts that Slice 3a exposes NO structural (add row/column) affordance.
 */
import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType } from 'docx';
import { EditorView } from 'prosemirror-view';
import { EditorState, TextSelection } from 'prosemirror-state';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { parseDocModel } from '../../src/docx/docModel';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';
import { buildNumberingMap } from '../../src/docx/opcParts';
import { buildDocxToolbar } from '../../src/docx/docxToolbar';
import { docxSchema } from '../../src/docx/docxSchema';


/**
 * Build a .docx with:
 *   - one top-level paragraph
 *   - an OUTER 2×1 table:
 *       row 0: cell [0,0] = a paragraph ("Outer text") + a NESTED 1×1 table ("Inner text")
 *       row 1: cell [1,0] = a paragraph ("Row2 text")
 */
async function makeDocxWithNestedTable(): Promise<Uint8Array> {
  const nestedTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: 'Inner text' })] })],
          }),
        ],
      }),
    ],
  });

  const outerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            // cell [0,0] holds a paragraph AND a nested table
            children: [
              new Paragraph({ children: [new TextRun({ text: 'Outer text' })] }),
              nestedTable,
            ],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: 'Row2 text' })] })],
          }),
        ],
      }),
    ],
  });

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: 'Intro paragraph' })] }),
        outerTable,
      ],
    }],
  });

  // Use toBlob — nodebuffer is unsupported in the browser environment.
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}

describe('DOCX table editing — real Chrome round-trip', () => {
  it('edits a cell and a nested cell; outer+inner table structure survives save→reopen', async () => {
    const bytes = await makeDocxWithNestedTable();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, bytes);

    // --- locate "Outer text" and edit it ---
    let outerPos = -1;
    let outerLen = 0;
    handle.view.state.doc.descendants((node, pos) => {
      if (outerPos >= 0) return false;
      if (node.isText && node.text?.includes('Outer text')) {
        outerPos = pos;
        outerLen = node.text.length;
        return false;
      }
      return true;
    });
    expect(outerPos).toBeGreaterThan(0);

    handle.view.dispatch(
      handle.view.state.tr.insertText('Outer EDITED', outerPos, outerPos + outerLen),
    );

    // --- locate "Inner text" (inside the nested table cell) and edit it ---
    let innerPos = -1;
    let innerLen = 0;
    handle.view.state.doc.descendants((node, pos) => {
      if (innerPos >= 0) return false;
      if (node.isText && node.text?.includes('Inner text')) {
        innerPos = pos;
        innerLen = node.text.length;
        return false;
      }
      return true;
    });
    expect(innerPos).toBeGreaterThan(0);

    handle.view.dispatch(
      handle.view.state.tr.insertText('Inner EDITED', innerPos, innerPos + innerLen),
    );

    // --- save → reopen ---
    const saved = handle.save();
    handle.destroy();
    container.remove();

    expect(saved).toBeInstanceOf(Uint8Array);

    const opc = openOpc(saved);
    const xml = getDocumentXml(opc);
    const model = parseDocModel(xml, buildNumberingMap(opc));

    // Outer table present + grid survived.
    expect(xml).toContain('<w:tbl');
    expect(xml).toContain('<w:tblGrid');

    // The edited outer-cell text is present.
    expect(xml).toContain('Outer EDITED');
    expect(xml).not.toContain('Outer text');

    // The edited nested-cell text is present.
    expect(xml).toContain('Inner EDITED');
    expect(xml).not.toContain('Inner text');

    // Row2 cell was not edited — it must survive verbatim.
    expect(xml).toContain('Row2 text');

    // At least one DocTable is in the top-level blocks (the outer table).
    const tableBlock = model.blocks.find(b => b.kind === 'table');
    expect(tableBlock).toBeDefined();
    if (tableBlock?.kind === 'table') {
      // Outer table has 2 rows.
      expect(tableBlock.rows).toHaveLength(2);

      // Cell [0,0] contains a nested table.
      const cell00 = tableBlock.rows[0].cells[0];
      const nestedTableBlock = cell00.blocks.find(b => b.kind === 'table');
      expect(nestedTableBlock).toBeDefined();

      // Cell [1,0] text survived.
      const cell10 = tableBlock.rows[1].cells[0];
      const cell10Text = cell10.blocks
        .flatMap(b => b.kind === 'table' ? [] : b.runs.map(r => r.text))
        .join('');
      expect(cell10Text).toContain('Row2 text');
    }
  });

  it('Slice 3b exposes the four structural toolbar acts (disabled outside a table)', () => {
    // buildDocxToolbar now wires addRowAfter / deleteRow / addColumnAfter / deleteColumn.
    const structuralActs = ['addRowAfter', 'deleteRow', 'addColumnAfter', 'deleteColumn'];

    const mountEl = document.createElement('div');
    document.body.appendChild(mountEl);
    const minState = EditorState.create({
      schema: docxSchema,
      doc: docxSchema.nodes.doc.create(null, [docxSchema.nodes.paragraph.create()]),
    });
    const minView = new EditorView(mountEl, { state: minState });
    const toolbar = buildDocxToolbar(minView);
    const toolbarEl = toolbar.dom;

    for (const act of structuralActs) {
      const b = toolbarEl.querySelector<HTMLButtonElement>(`[data-act="${act}"]`);
      expect(b).not.toBeNull();
      // Caret is in a plain paragraph (not a table) → the structural buttons are disabled.
      expect(b?.disabled).toBe(true);
    }
    // The non-table acts are still present (regression guard).
    for (const act of ['bold', 'italic', 'underline', 'bullet', 'ordered']) {
      expect(toolbarEl.querySelector(`[data-act="${act}"]`)).not.toBeNull();
    }

    toolbar.destroy();
    minView.destroy();
    mountEl.remove();
  });

  it('adds a row via the toolbar button — the new row survives save → reopen (3b in-place reconcile)', async () => {
    const bytes = await makeDocxWithNestedTable();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, bytes);
    const toolbar = buildDocxToolbar(handle.view);
    document.body.appendChild(toolbar.dom);

    // Count ALL table_row nodes (outer 2 + nested 1 = 3 to start).
    const rowCount = (): number => {
      let c = 0;
      handle.view.state.doc.descendants(node => { if (node.type.name === 'table_row') c++; return true; });
      return c;
    };
    const rowsBefore = rowCount();
    expect(rowsBefore).toBe(3);

    // Place the caret in the "Row2 text" cell, then click "add row".
    let pos = -1;
    handle.view.state.doc.descendants((node, p) => {
      if (pos >= 0) return false;
      if (node.isText && node.text?.includes('Row2 text')) { pos = p; return false; }
      return true;
    });
    expect(pos).toBeGreaterThan(0);
    handle.view.dispatch(handle.view.state.tr.setSelection(TextSelection.create(handle.view.state.doc, pos)));
    toolbar.update();

    const addRowBtn = toolbar.dom.querySelector<HTMLButtonElement>('[data-act="addRowAfter"]');
    expect(addRowBtn).not.toBeNull();
    expect(addRowBtn?.disabled).toBe(false); // enabled inside the table
    addRowBtn?.click();
    expect(rowCount()).toBe(rowsBefore + 1); // editor gained one row in the outer table

    // Type into the new (3rd) row so we can assert it persists.
    let newCellPos = -1;
    handle.view.state.doc.descendants((node, p) => {
      // last empty paragraph inside a table_cell
      if (node.type.name === 'table_cell') newCellPos = p + 2; // cell → paragraph → text insert point
      return true;
    });
    handle.view.dispatch(handle.view.state.tr.insertText('Row3 NEW', newCellPos));

    const saved = handle.save();
    toolbar.destroy();
    handle.destroy();
    container.remove();

    const xml = getDocumentXml(openOpc(saved));
    const model = parseDocModel(xml, buildNumberingMap(openOpc(saved)));
    const tbl = model.blocks.find(b => b.kind === 'table');
    expect(tbl?.kind).toBe('table');
    if (tbl?.kind === 'table') {
      expect(tbl.rows.length).toBe(3); // the added row round-tripped through the in-place save
    }
    expect(xml).toContain('Row3 NEW');
  });
});
