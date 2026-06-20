/**
 * Real-Chrome guard for DOCX find/replace. jsdom (findReplace*.test.ts) covers the
 * pure core, plugin state, and bar wiring; only a real browser exercises: the Mod-f
 * keymap opening the bar, the decoration plugin actually painting `.fr-match` elements
 * over a laid-out ProseMirror view, Enter-cycling the active match, and Replace-all
 * mutating the doc while a BOLD match's replacement keeps its bold through a save→reopen
 * OPC round-trip (the "inherit match start" contract). Tables pass through untouched.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell } from 'docx';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { parseDocModel } from '../../src/docx/docModel';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';
import { buildNumberingMap } from '../../src/docx/opcParts';
import { initI18n } from '../../src/utils/i18n';

beforeAll(async () => {
  await initI18n();
});

/** Paragraph "foo middle foo" (first foo BOLD) + a single-cell table. */
async function makeDoc(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [
          new TextRun({ text: 'foo', bold: true }),
          new TextRun({ text: ' middle foo' }),
        ] }),
        new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'CELL' })] })] })] })] }),
      ],
    }],
  });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}

function pressCtrl(el: Element, key: string, shiftKey = false): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey, bubbles: true, cancelable: true }));
}

describe('DOCX find/replace — real browser', () => {
  it('Mod-f opens the bar, paints matches, cycles, and replace-all keeps bold (round-trip)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, await makeDoc());
    if (handle.findReplaceBar) container.appendChild(handle.findReplaceBar);
    const barDom = handle.findReplaceBar as HTMLElement;
    expect(barDom).toBeTruthy();

    const pm = container.querySelector<HTMLElement>('.ProseMirror');
    expect(pm).toBeTruthy();

    // 1) Mod-f opens the bar.
    pressCtrl(pm as HTMLElement, 'f');
    expect(barDom.style.display).not.toBe('none');

    // 2) Type the query → decorations paint over EVERY match, one active.
    const find = barDom.querySelector<HTMLInputElement>('.fr-find') as HTMLInputElement;
    find.value = 'foo';
    find.dispatchEvent(new Event('input', { bubbles: true }));
    expect(container.querySelectorAll('.fr-match').length).toBe(2);
    expect(container.querySelectorAll('.fr-match-active').length).toBe(1);
    expect(barDom.querySelector('.fr-counter')?.textContent).toBe('1 of 2');

    // 3) Enter cycles to the next match (still exactly one active).
    pressCtrl(find, 'f'); // no-op guard: ensure focus path stable
    find.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(barDom.querySelector('.fr-counter')?.textContent).toBe('2 of 2');

    // 4) Replace-all 'foo' → 'bar'.
    const replace = barDom.querySelector<HTMLInputElement>('.fr-replace') as HTMLInputElement;
    replace.value = 'bar';
    replace.dispatchEvent(new Event('input', { bubbles: true }));
    barDom.querySelector<HTMLButtonElement>('.fr-replace-all')?.click();
    expect(handle.view.state.doc.textContent).toBe('bar middle bar');

    // 5) Save → reopen: the first (formerly bold) match's replacement is still bold.
    const out = handle.save();
    const opc = openOpc(out);
    const xml = getDocumentXml(opc);
    const model = parseDocModel(xml, buildNumberingMap(opc));
    const boldBar = model.paragraphs.some(p => p.runs.some(r => r.bold === true && r.text.includes('bar')));
    expect(boldBar).toBe(true);
    // Table part survived verbatim.
    expect(xml).toContain('<w:tbl');
    expect(xml).toContain('CELL');

    handle.destroy();
    container.remove();
  });
});
