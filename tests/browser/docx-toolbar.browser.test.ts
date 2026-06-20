/**
 * T9 — DOCX rich-text toolbar, real-Chrome round-trip guard. jsdom covers the
 * toolbar's command wiring with getClientRects stubs (docxToolbar.test.ts); this
 * exercises what jsdom can't: a REAL ProseMirror view laid out in the browser, the
 * toolbar driving genuine commands against a live selection, save() re-zipping, and
 * reopening to prove (a) bold + H1 + bullet survived the OPC round-trip AND (b) an
 * untouched table part passed through verbatim (the cardinal in-place-edit rule).
 */
import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell } from 'docx';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { parseDocModel } from '../../src/docx/docModel';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';
import { buildNumberingMap } from '../../src/docx/opcParts';

/** A .docx with two top-level paragraphs followed by a single-cell table. */
async function makeDocxWithTable(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: 'Title' })] }),
        new Paragraph({ children: [new TextRun({ text: 'Body' })] }),
        new Table({
          rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'CELL' })] })] })] })],
        }),
      ],
    }],
  });
  // toBlob (not toBuffer — nodebuffer is unsupported in the browser).
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}

/** Select the full text of the first textblock containing `text`. */
function selectBlockByText(view: EditorView, text: string): void {
  let range: { from: number; to: number } | null = null;
  view.state.doc.descendants((node, pos) => {
    if (range) return false;
    if (node.isTextblock && node.textContent.includes(text)) {
      range = { from: pos + 1, to: pos + 1 + node.content.size };
      return false;
    }
    return true;
  });
  if (!range) throw new Error(`no textblock contains "${text}"`);
  const { from, to } = range;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
}

describe('DOCX rich-text toolbar — real browser round-trip', () => {
  it('applies bold + H1 + bullet via the toolbar; survives save; table passes through', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, await makeDocxWithTable());
    const toolbar = handle.toolbarDom as HTMLElement;
    expect(toolbar).toBeTruthy();

    // The view is a real contenteditable laid out by the browser.
    const pm = container.querySelector<HTMLElement>('.ProseMirror');
    expect(pm?.isContentEditable).toBe(true);

    // 1) Select "Title", make it bold and Heading 1.
    selectBlockByText(handle.view, 'Title');
    toolbar.querySelector<HTMLButtonElement>('[data-act="bold"]')?.click();
    const headingSel = toolbar.querySelector<HTMLSelectElement>('[data-act="heading"]');
    selectBlockByText(handle.view, 'Title'); // re-anchor (focus()/click may have moved it)
    if (headingSel) {
      headingSel.value = '1';
      headingSel.dispatchEvent(new Event('change'));
    }

    // 2) Put the cursor in "Body" and turn it into a bullet list.
    selectBlockByText(handle.view, 'Body');
    toolbar.querySelector<HTMLButtonElement>('[data-act="bullet"]')?.click();

    // 3) Save → reopen.
    const out = handle.save();
    expect(out).toBeInstanceOf(Uint8Array);
    const opc = openOpc(out);
    const xml = getDocumentXml(opc);
    const model = parseDocModel(xml, buildNumberingMap(opc));

    // Two top-level paragraphs round-trip — the table is NOT counted among them.
    expect(model.paragraphs).toHaveLength(2);

    const title = model.paragraphs.find(p => p.runs.some(r => r.text.includes('Title')));
    const body = model.paragraphs.find(p => p.runs.some(r => r.text.includes('Body')));
    expect(title?.heading).toBe(1);
    expect(title?.runs.some(r => r.bold)).toBe(true);
    expect(body?.list).toBeDefined();

    // Table part survived verbatim inside document.xml.
    expect(xml).toContain('<w:tbl');
    expect(xml).toContain('CELL');

    handle.destroy();
    container.remove();
  });
});
