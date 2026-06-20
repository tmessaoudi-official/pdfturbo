/**
 * #1c DOCX editor — real-Chrome guard. jsdom (docxEditorController.test.ts) covers
 * the glue with injected seams; this exercises what jsdom can't: the controller's
 * DEFAULT loadEditor seam — a real dynamic import of ./docxProseMirror — mounting a
 * real ProseMirror contenteditable with browser layout, then Save re-zipping valid
 * .docx bytes that round-trip. Plus a real DOM edit reflected on save.
 */
import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { createDocxEditorController } from '../../src/docx/docxEditorController';
import { parseDocModel, paragraphText } from '../../src/docx/docModel';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';

async function makeDocx(text: string): Promise<Uint8Array> {
  const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text })] })] }] });
  // toBlob (not toBuffer — nodebuffer is unsupported in the browser).
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}

describe('DOCX editor controller — real browser', () => {
  it('lazy-loads the real editor, renders a contenteditable, and Save round-trips', async () => {
    let saved: Uint8Array | null = null;
    const c = createDocxEditorController({ download: bytes => { saved = bytes; } });
    await c.loadBytes(await makeDocx('Hello browser'), 'memo.docx');

    const pm = document.querySelector<HTMLElement>('.docx-editor-mount .ProseMirror');
    expect(pm).not.toBeNull();
    expect(pm?.isContentEditable).toBe(true);
    expect(pm?.textContent).toContain('Hello browser');

    document.querySelector<HTMLButtonElement>('.docx-editor-save')?.click();
    expect(saved).toBeInstanceOf(Uint8Array);
    const model = parseDocModel(getDocumentXml(openOpc(saved as unknown as Uint8Array)));
    expect(model.paragraphs.map(paragraphText)).toContain('Hello browser');
    c.destroy();
  });

  it('reflects a real DOM edit (typed into the contenteditable) on save', async () => {
    let saved: Uint8Array | null = null;
    const c = createDocxEditorController({ download: bytes => { saved = bytes; } });
    await c.loadBytes(await makeDocx('OldText'), 'doc.docx');

    const pm = document.querySelector<HTMLElement>('.docx-editor-mount .ProseMirror');
    pm?.focus();
    // Select the whole document, then type — ProseMirror handles the input events.
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(pm as HTMLElement);
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand('insertText', false, 'NewText');
    expect(pm?.textContent).toContain('NewText');

    // ProseMirror observes DOM edits via an async MutationObserver; let it flush
    // into editor state before we serialize on save.
    await new Promise<void>(r => { setTimeout(r, 50); });
    document.querySelector<HTMLButtonElement>('.docx-editor-save')?.click();
    const texts = parseDocModel(getDocumentXml(openOpc(saved as unknown as Uint8Array))).paragraphs.map(paragraphText);
    expect(texts).toContain('NewText');
    expect(texts).not.toContain('OldText');
    c.destroy();
  });
});
