/**
 * DOCX editor paste wiring — transformPastedHTML sanitises Word HTML, and
 * Ctrl+Shift+V routes to a plain-text paste. jsdom runs ProseMirror fine.
 */
import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';

async function makeDocx(text: string): Promise<Uint8Array> {
  const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text })] })] }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

describe('docx editor — Word paste', () => {
  it('transformPastedHTML strips mso cruft from pasted HTML', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDocxEditor(host, await makeDocx('Start'));

    const transform = handle.view.someProp('transformPastedHTML');
    expect(typeof transform).toBe('function');
    const cleaned = (transform as (h: string) => string)('<p style="mso-x:1;font-size:12pt"><b>X</b></p>');
    expect(cleaned).not.toMatch(/mso-/);
    expect(cleaned).toMatch(/<b>X<\/b>/);

    handle.destroy();
    host.remove();
  });

  it('Ctrl+Shift+V arms plain-text paste (handlePaste returns true, formatting dropped)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDocxEditor(host, await makeDocx('Start'));
    const view = handle.view;

    view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true, bubbles: true }),
    );

    const handlePaste = view.someProp('handlePaste');
    expect(typeof handlePaste).toBe('function');

    // jsdom lacks DataTransfer/ClipboardEvent.clipboardData; handlePaste only
    // reads event.clipboardData.getData, so a minimal fake suffices here.
    const ev = {
      clipboardData: { getData: (t: string): string => (t === 'text/plain' ? 'Bold' : '<b>Bold</b>') },
    } as unknown as ClipboardEvent;
    const handled = (handlePaste as (v: typeof view, e: ClipboardEvent) => boolean)(view, ev);
    expect(handled).toBe(true);

    let sawStrong = false;
    view.state.doc.descendants(node => {
      if (node.marks.some(m => m.type.name === 'strong')) sawStrong = true;
    });
    expect(sawStrong).toBe(false);
    expect(view.state.doc.textContent).toContain('Bold');

    handle.destroy();
    host.remove();
  });

  it('a normal paste (no Shift) is NOT handled by handlePaste (HTML path runs)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountDocxEditor(host, await makeDocx('Start'));
    const handlePaste = handle.view.someProp('handlePaste');
    const ev = {
      clipboardData: { getData: (): string => 'x' },
    } as unknown as ClipboardEvent;
    expect((handlePaste as (v: typeof handle.view, e: ClipboardEvent) => boolean)(handle.view, ev)).toBe(false);
    handle.destroy();
    host.remove();
  });
});
