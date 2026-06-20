/**
 * Real-Chrome guard: pasting Word HTML into the DOCX editor runs the actual
 * ProseMirror paste pipeline (transformPastedHTML → cleanWordHtml → DOMParser via
 * the schema's parseDOM), preserves editor-supported formatting, and survives a
 * save→reopen OPC round-trip. jsdom (docxPaste.test.ts) covers the wiring with a
 * fake event; only a real browser exercises view.pasteHTML + DOMParser fidelity.
 *
 * view.pasteHTML(html) is the real paste entry point and applies transformPastedHTML
 * — used instead of dispatching a synthetic ClipboardEvent (whose clipboardData
 * cannot be populated for untrusted synthetic events).
 */
import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { parseDocModel } from '../../src/docx/docModel';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';

async function makeDocx(text: string): Promise<Uint8Array> {
  const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text })] })] }] });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}

const WORD_HTML =
  '<p class="MsoNormal" style="mso-margin-top-alt:auto;font-size:13pt"><b>Title</b></p>' +
  '<ul><li>one</li><li>two</li></ul>' +
  '<p><u>under</u></p>';

describe('DOCX editor — Word paste (real Chrome)', () => {
  it('preserves bold/underline/list through paste and OPC round-trip', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDocxEditor(host, await makeDocx('Start'));

    // Real paste pipeline (applies transformPastedHTML = cleanWordHtml).
    const ok = handle.view.pasteHTML(WORD_HTML);
    expect(ok).toBe(true);

    const model = handle.getModel();
    const paras = model.paragraphs;
    expect(paras.some(p => p.runs.some(r => r.bold === true && r.text.includes('Title')))).toBe(true);
    expect(paras.some(p => p.runs.some(r => r.underline === true && r.text.includes('under')))).toBe(true);
    expect(paras.some(p => p.list !== undefined)).toBe(true);

    // Save → reopen: text + formatting must survive OPC serialisation.
    const saved = handle.save();
    handle.destroy();

    const xml = getDocumentXml(openOpc(saved));
    expect(xml).toMatch(/two/);
    expect(xml).toMatch(/Title/);
    const reModel = parseDocModel(xml);
    expect(reModel.paragraphs.some(p => p.runs.some(r => r.bold === true && r.text.includes('Title')))).toBe(true);

    host.remove();
  });

  it('plain-text paste (Ctrl+Shift+V armed) drops formatting', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDocxEditor(host, await makeDocx('Start'));
    const view = handle.view;

    view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    // pasteHTML runs handlePaste first; armed → it inserts text/plain equivalent.
    // Here we feed bold HTML but expect NO bold to land.
    const dt = new DataTransfer();
    dt.setData('text/html', '<b>Bold</b>');
    dt.setData('text/plain', 'Bold');
    view.dom.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );

    let sawStrong = false;
    view.state.doc.descendants(node => {
      if (node.marks.some(m => m.type.name === 'strong')) sawStrong = true;
    });
    expect(sawStrong).toBe(false);
    expect(view.state.doc.textContent).toContain('Bold');

    handle.destroy();
    host.remove();
  });
});
