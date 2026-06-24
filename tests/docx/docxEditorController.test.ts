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
    const handle: DocxEditorHandle = {
      save: () => saved,
      getModel: () => ({ blocks: [], paragraphs: [] }),
      getImages: () => [],
      view: {} as never,
      destroy: vi.fn(),
    };
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

  it('Export PDF renders the model and downloads a .pdf via the download seam', async () => {
    const downloads: { bytes: Uint8Array; filename: string }[] = [];
    const paras = [{ runs: [{ text: 'Hello world' }] }];
    const handle: DocxEditorHandle = {
      save: () => new Uint8Array([1]),
      getModel: () => ({ blocks: paras, paragraphs: paras }),
      getImages: () => [],
      view: {} as never,
      destroy: vi.fn(),
    };
    const loadEditor = vi.fn(() => Promise.resolve(handle));
    const download = vi.fn((bytes: Uint8Array, filename: string) => downloads.push({ bytes, filename }));
    const c = createDocxEditorController({ loadEditor, download });

    await c.loadBytes(new Uint8Array([9]), 'report.docx');
    const btn = document.querySelector<HTMLButtonElement>('.docx-editor-export-pdf');
    expect(btn).toBeTruthy();
    btn?.click();

    await vi.waitFor(() => expect(downloads.length).toBeGreaterThan(0));
    expect(downloads[0].filename).toBe('report.pdf');
    expect(new TextDecoder().decode(downloads[0].bytes.slice(0, 5))).toBe('%PDF-');
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

  it('mounts the editor toolbar above the editor when the handle provides one', async () => {
    const toolbarDom = document.createElement('div');
    toolbarDom.className = 'docx-toolbar';
    const handle: DocxEditorHandle = {
      save: () => new Uint8Array([1]),
      getModel: () => ({ blocks: [], paragraphs: [] }),
      getImages: () => [],
      view: {} as never,
      toolbarDom,
      destroy: vi.fn(() => toolbarDom.remove()),
    };
    const c = createDocxEditorController({ loadEditor: vi.fn(() => Promise.resolve(handle)), download: vi.fn() });
    await c.loadBytes(new Uint8Array([9]), 'doc.docx');
    const panel = document.querySelector<HTMLElement>('.docx-editor-panel');
    const tb = panel?.querySelector('.docx-toolbar');
    expect(tb).toBe(toolbarDom);
    // toolbar sits before the editor mount
    expect(toolbarDom.nextElementSibling?.classList.contains('docx-editor-mount')).toBe(true);
    c.close();
    expect(document.querySelector('.docx-toolbar')).toBeNull(); // removed on teardown
    c.destroy();
  });

  // ── QA-2026-06-23 P1-2: structural table edits must NOT be silently discarded ──
  it('warns (not silent) when a table the user removed is dropped from the save', async () => {
    let tables: { kind: 'table'; rows: never[] }[] = [{ kind: 'table', rows: [] }];
    const handle: DocxEditorHandle = {
      save: () => new Uint8Array([1]),
      getModel: () => ({ blocks: [...tables], paragraphs: [] }),
      getImages: () => [],
      view: {} as never,
      destroy: vi.fn(),
    };
    const notify = vi.fn();
    const c = createDocxEditorController({ loadEditor: vi.fn(() => Promise.resolve(handle)), download: vi.fn(), notify });
    await c.loadBytes(new Uint8Array([9]), 'tbl.docx'); // captured: 1 table

    tables = []; // user deletes the table in the editor → save() keeps the original (in-place)
    document.querySelector<HTMLButtonElement>('.docx-editor-save')?.click();
    expect(notify).toHaveBeenCalledWith('docxEditor.tableStructureUnsupported', 'warn');
    expect(notify).not.toHaveBeenCalledWith('docxEditor.saved', 'info'); // the warn replaces the success
    c.destroy();
  });

  it('a normal save (no table-count change) reports success, not the table warning', async () => {
    const handle: DocxEditorHandle = {
      save: () => new Uint8Array([1]),
      getModel: () => ({ blocks: [{ kind: 'table', rows: [] }], paragraphs: [] }),
      getImages: () => [],
      view: {} as never,
      destroy: vi.fn(),
    };
    const notify = vi.fn();
    const c = createDocxEditorController({ loadEditor: vi.fn(() => Promise.resolve(handle)), download: vi.fn(), notify });
    await c.loadBytes(new Uint8Array([9]), 'tbl.docx');
    document.querySelector<HTMLButtonElement>('.docx-editor-save')?.click();
    expect(notify).toHaveBeenCalledWith('docxEditor.saved', 'info');
    expect(notify).not.toHaveBeenCalledWith('docxEditor.tableStructureUnsupported', 'warn');
    c.destroy();
  });

  // ── QA-2026-06-23 P1-3: modal a11y — Esc + backdrop dismiss ──
  it('Escape closes the modal', async () => {
    const handle: DocxEditorHandle = {
      save: () => new Uint8Array([1]), getModel: () => ({ blocks: [], paragraphs: [] }),
      getImages: () => [],
      view: {} as never, destroy: vi.fn(),
    };
    const c = createDocxEditorController({ loadEditor: vi.fn(() => Promise.resolve(handle)), download: vi.fn() });
    await c.loadBytes(new Uint8Array([9]), 'd.docx');
    const modal = document.querySelector<HTMLElement>('.docx-editor-modal');
    expect(modal?.style.display).toBe('flex');
    modal?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal?.style.display).toBe('none');
    expect(handle.destroy).toHaveBeenCalled();
    c.destroy();
  });

  it('clicking the backdrop (outside the panel) closes the modal; clicking the panel does not', async () => {
    const handle: DocxEditorHandle = {
      save: () => new Uint8Array([1]), getModel: () => ({ blocks: [], paragraphs: [] }),
      getImages: () => [],
      view: {} as never, destroy: vi.fn(),
    };
    const c = createDocxEditorController({ loadEditor: vi.fn(() => Promise.resolve(handle)), download: vi.fn() });
    await c.loadBytes(new Uint8Array([9]), 'd.docx');
    const modal = document.querySelector<HTMLElement>('.docx-editor-modal');
    const panel = document.querySelector<HTMLElement>('.docx-editor-panel');
    panel?.dispatchEvent(new MouseEvent('click', { bubbles: true })); // inside → stays open
    expect(modal?.style.display).toBe('flex');
    modal?.dispatchEvent(new MouseEvent('click', { bubbles: true })); // on the backdrop → closes
    expect(modal?.style.display).toBe('none');
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
