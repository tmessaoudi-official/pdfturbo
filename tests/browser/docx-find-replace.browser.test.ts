/**
 * Real-Chrome guard for DOCX find/replace. jsdom (findReplace*.test.ts) covers the
 * pure core, plugin state, and bar wiring; only a real browser exercises: the Mod-f
 * keymap opening the bar, the decoration plugin actually painting `.fr-match` elements
 * over a laid-out ProseMirror view, Enter-cycling the active match, and Replace-all
 * mutating the doc while a BOLD match's replacement keeps its bold through a save→reopen
 * OPC round-trip (the "inherit match start" contract). Since table cells are now in the
 * PM doc (Slice C #3a), find/replace reaches cell text too — the second test guards this.
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
    // The cell text "CELL" is now part of the PM doc (table cells are editable in 3a),
    // so textContent includes it. "foo" doesn't appear in the cell → cell is untouched.
    expect(handle.view.state.doc.textContent).toBe('bar middle barCELL');

    // 5) Save → reopen: the first (formerly bold) match's replacement is still bold.
    const out = handle.save();
    const opc = openOpc(out);
    const xml = getDocumentXml(opc);
    const model = parseDocModel(xml, buildNumberingMap(opc));
    const boldBar = model.paragraphs.some(p => p.runs.some(r => r.bold === true && r.text.includes('bar')));
    expect(boldBar).toBe(true);
    // Table structure + untouched cell text survived the save (grid verbatim).
    expect(xml).toContain('<w:tbl');
    expect(xml).toContain('CELL');

    handle.destroy();
    container.remove();
  });

  it('find/replace reaches text inside a table cell and round-trips correctly', async () => {
    // Fixture: a top-level paragraph + a table whose single cell contains "foo bar foo".
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun({ text: 'outside' })] }),
          new Table({ rows: [new TableRow({ children: [new TableCell({ children: [
            new Paragraph({ children: [new TextRun({ text: 'foo bar foo' })] }),
          ] })] })] }),
        ],
      }],
    });
    const bytes = new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());

    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, bytes);
    if (handle.findReplaceBar) container.appendChild(handle.findReplaceBar);
    const barDom = handle.findReplaceBar as HTMLElement;

    const pm = container.querySelector<HTMLElement>('.ProseMirror');
    pressCtrl(pm as HTMLElement, 'f');

    // 1) "foo" appears twice inside the cell — both matches are found.
    const find = barDom.querySelector<HTMLInputElement>('.fr-find') as HTMLInputElement;
    find.value = 'foo';
    find.dispatchEvent(new Event('input', { bubbles: true }));
    expect(container.querySelectorAll('.fr-match').length).toBe(2);
    expect(barDom.querySelector('.fr-counter')?.textContent).toBe('1 of 2');

    // 2) Replace-all "foo" → "baz" rewrites both occurrences in the cell.
    const replace = barDom.querySelector<HTMLInputElement>('.fr-replace') as HTMLInputElement;
    replace.value = 'baz';
    replace.dispatchEvent(new Event('input', { bubbles: true }));
    barDom.querySelector<HTMLButtonElement>('.fr-replace-all')?.click();

    // textContent = top-level para + cell para (no separator — PM textContent is raw).
    // "outside" is unchanged; both "foo" in the cell became "baz".
    expect(handle.view.state.doc.textContent).toBe('outsidebaz bar baz');

    // 3) Save → reopen: the replaced text is inside <w:tbl>, table grid survived.
    const out = handle.save();
    const opc2 = openOpc(out);
    const xml2 = getDocumentXml(opc2);
    expect(xml2).toContain('<w:tbl');
    // The cell now contains "baz" twice, not "foo".
    expect(xml2).toContain('baz bar baz');
    expect(xml2).not.toContain('>foo<');
    // Table grid structure is preserved (cardinal in-place rule).
    expect(xml2).toContain('<w:tblGrid');

    handle.destroy();
    container.remove();
  });
});
