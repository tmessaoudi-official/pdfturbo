/**
 * #1c controller: the self-contained .docx editor entry point. jsdom. The
 * dynamic import + download are driven through the injectable seams so the full
 * open→edit→save→download flow is deterministic; one test uses the REAL
 * mountDocxEditor (it runs in jsdom) to prove the default wiring round-trips.
 */
import { describe, it, expect, vi } from 'vitest';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { createDocxEditorController } from '../../src/docx/docxEditorController';
import type { DocxEditorHandle } from '../../src/docx/docxProseMirror';
import { parseDocModel, paragraphText } from '../../src/docx/docModel';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';

async function makeDocx(text: string): Promise<Uint8Array> {
  const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text })] })] }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

describe('createDocxEditorController', () => {
  it('appends a hidden .docx file input and a hidden modal; open() clicks the input', () => {
    const c = createDocxEditorController();
    const input = document.querySelector<HTMLInputElement>('input[data-docx-editor-input]');
    const modal = document.querySelector<HTMLElement>('.docx-editor-modal');
    expect(input?.accept).toContain('.docx');
    expect(modal?.style.display).toBe('none');
    const click = vi.spyOn(input as HTMLInputElement, 'click').mockImplementation(() => {});
    c.open();
    expect(click).toHaveBeenCalledOnce();
    c.destroy();
  });

  it('loadBytes mounts via the seam, shows the modal, and Save downloads <base>-edited.docx', async () => {
    const saved = new Uint8Array([1, 2, 3]);
    const handle: DocxEditorHandle = { save: () => saved, view: {} as never, destroy: vi.fn() };
    const loadEditor = vi.fn(() => Promise.resolve(handle));
    const download = vi.fn();
    const c = createDocxEditorController({ loadEditor, download });

    await c.loadBytes(new Uint8Array([9]), 'report.docx');
    const modal = document.querySelector<HTMLElement>('.docx-editor-modal');
    expect(loadEditor).toHaveBeenCalledOnce();
    expect(modal?.style.display).toBe('flex');

    document.querySelector<HTMLButtonElement>('.docx-editor-save')?.click();
    expect(download).toHaveBeenCalledWith(saved, 'report-edited.docx');

    document.querySelector<HTMLButtonElement>('.docx-editor-close')?.click();
    expect(handle.destroy).toHaveBeenCalled();
    expect(modal?.style.display).toBe('none');
    c.destroy();
  });

  it('default wiring (real mountDocxEditor) round-trips an edited document through download', async () => {
    let out: Uint8Array | null = null;
    const c = createDocxEditorController({ download: bytes => { out = bytes; } });
    await c.loadBytes(await makeDocx('Original'), 'memo.docx');
    document.querySelector<HTMLButtonElement>('.docx-editor-save')?.click();
    expect(out).toBeInstanceOf(Uint8Array);
    const model = parseDocModel(getDocumentXml(openOpc(out as unknown as Uint8Array)));
    expect(model.paragraphs.map(paragraphText)).toContain('Original');
    c.destroy();
  });

  it('destroy() removes the input and modal from the DOM', () => {
    const c = createDocxEditorController();
    expect(document.querySelector('input[data-docx-editor-input]')).not.toBeNull();
    c.destroy();
    expect(document.querySelector('input[data-docx-editor-input]')).toBeNull();
    expect(document.querySelector('.docx-editor-modal')).toBeNull();
  });
});
