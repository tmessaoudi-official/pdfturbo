/**
 * Phase 2 Slice A Task 7: the rich-text toolbar — controls dispatch the expected
 * ProseMirror commands against a live view. jsdom (ProseMirror runs in jsdom).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { docxSchema } from '../../src/docx/docxSchema';
import { buildDocxToolbar, type DocxToolbar } from '../../src/docx/docxToolbar';

function paraDoc(text: string): ReturnType<typeof docxSchema.node> {
  return docxSchema.node('doc', null, [docxSchema.node('paragraph', null, [docxSchema.text(text)])]);
}
let view: EditorView;
let tb: DocxToolbar;
function mount(text: string): void {
  const place = document.createElement('div');
  document.body.appendChild(place);
  view = new EditorView(place, { state: EditorState.create({ doc: paraDoc(text) }) });
  tb = buildDocxToolbar(view);
  document.body.appendChild(tb.dom);
}
function selectAll(): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)));
}
const ctrl = <T extends Element>(act: string): T => tb.dom.querySelector(`[data-act="${act}"]`) as T;

// jsdom lacks layout: commands set scrollIntoView → coordsAtPos → getClientRects.
// Stub the rect APIs so updateState's scroll doesn't throw (real browser is fine).
function fakeRect(): DOMRect {
  return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}
beforeEach(() => {
  document.body.innerHTML = '';
  Element.prototype.getClientRects = (): DOMRectList => [fakeRect()] as unknown as DOMRectList;
  Element.prototype.getBoundingClientRect = (): DOMRect => fakeRect();
  Range.prototype.getClientRects = (): DOMRectList => [fakeRect()] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = (): DOMRect => fakeRect();
});

describe('docxToolbar (Task 7)', () => {
  it('B / I / U buttons toggle the corresponding marks over the selection', () => {
    mount('hello');
    selectAll();
    ctrl<HTMLElement>('bold').click();
    expect(view.state.doc.rangeHasMark(1, 6, docxSchema.marks.strong)).toBe(true);
    ctrl<HTMLElement>('italic').click();
    expect(view.state.doc.rangeHasMark(1, 6, docxSchema.marks.em)).toBe(true);
    ctrl<HTMLElement>('underline').click();
    expect(view.state.doc.rangeHasMark(1, 6, docxSchema.marks.underline)).toBe(true);
  });

  it('link button + URL input adds a link mark, and clicking again removes it', () => {
    mount('hello');
    selectAll();
    const input = ctrl<HTMLInputElement>('linkInput');
    ctrl<HTMLElement>('link').click();              // reveal the input
    input.value = 'https://example.com';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(view.state.doc.rangeHasMark(1, 6, docxSchema.marks.link)).toBe(true);
    tb.update();
    expect(ctrl<HTMLElement>('link').classList.contains('active')).toBe(true);
    selectAll();
    ctrl<HTMLElement>('link').click();              // in-link → remove
    expect(view.state.doc.rangeHasMark(1, 6, docxSchema.marks.link)).toBe(false);
  });

  it('link input rejects an unsafe scheme (no mark applied)', () => {
    mount('hello');
    selectAll();
    const input = ctrl<HTMLInputElement>('linkInput');
    ctrl<HTMLElement>('link').click();
    input.value = 'javascript:alert(1)';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(view.state.doc.rangeHasMark(1, 6, docxSchema.marks.link)).toBe(false);
  });

  it('heading select sets the block type and Normal resets it', () => {
    mount('Title');
    const sel = ctrl<HTMLSelectElement>('heading');
    sel.value = '2';
    sel.dispatchEvent(new Event('change'));
    expect(view.state.doc.firstChild?.type.name).toBe('heading');
    expect(view.state.doc.firstChild?.attrs.level).toBe(2);
    sel.value = '0';
    sel.dispatchEvent(new Event('change'));
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('font and size selects apply the attr marks over the selection', () => {
    mount('styled');
    selectAll();
    const font = ctrl<HTMLSelectElement>('font');
    font.value = 'Georgia';
    font.dispatchEvent(new Event('change'));
    expect(view.state.doc.rangeHasMark(1, 7, docxSchema.marks.fontFamily)).toBe(true);
    const size = ctrl<HTMLSelectElement>('size');
    size.value = '18';
    size.dispatchEvent(new Event('change'));
    expect(view.state.doc.rangeHasMark(1, 7, docxSchema.marks.fontSize)).toBe(true);
  });

  it('color picker applies the color mark over the selection (Workstream A)', () => {
    mount('tint');
    selectAll();
    const color = ctrl<HTMLInputElement>('color');
    color.value = '#ff0000';
    color.dispatchEvent(new Event('input'));
    expect(view.state.doc.rangeHasMark(1, 5, docxSchema.marks.color)).toBe(true);
  });

  it('bullet and ordered buttons wrap the selection in the right list, toggling off on repeat', () => {
    mount('item');
    ctrl<HTMLElement>('bullet').click();
    expect(view.state.doc.firstChild?.type.name).toBe('bullet_list');
    ctrl<HTMLElement>('bullet').click(); // toggle off
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    ctrl<HTMLElement>('ordered').click();
    expect(view.state.doc.firstChild?.type.name).toBe('ordered_list');
  });

  it('exposes the Insert-image button + a hidden file input', () => {
    mount('hello');
    expect(ctrl<HTMLElement>('insertImage')).not.toBeNull();
    const file = ctrl<HTMLInputElement>('insertImageFile');
    expect(file.type).toBe('file');
    expect(file.accept).toContain('image/png');
  });

  it('insertImage places a docx_image node (anchorId -1) at the selection', () => {
    mount('hello');
    const before = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    tb.insertImage(before, 'image/png', 75, 50);
    let img: ReturnType<typeof docxSchema.node> | null = null;
    view.state.doc.descendants(node => { if (node.type.name === 'docx_image') img = node; return true; });
    expect(img).not.toBeNull();
    const attrs = (img as unknown as { attrs: Record<string, unknown> }).attrs;
    expect(attrs.mime).toBe('image/png');
    expect(attrs.widthPt).toBe(75);
    expect(attrs.heightPt).toBe(50);
    expect(attrs.anchorId).toBe(-1);
    expect(attrs.dataB64).toBe(btoa('\x89PNG'));
  });
});

describe('docxToolbar — table editing (Slice 3b)', () => {
  function cellNode(text: string): ReturnType<typeof docxSchema.node> {
    return docxSchema.node('table_cell', null, [docxSchema.node('paragraph', null, [docxSchema.text(text)])]);
  }
  /** A doc holding a 1×2 table (one row, two cells). */
  function tableDoc(): ReturnType<typeof docxSchema.node> {
    const r = docxSchema.node('table_row', null, [cellNode('A'), cellNode('B')]);
    return docxSchema.node('doc', null, [docxSchema.node('table', null, [r])]);
  }
  function mountTable(): void {
    const place = document.createElement('div');
    document.body.appendChild(place);
    view = new EditorView(place, { state: EditorState.create({ doc: tableDoc() }) });
    tb = buildDocxToolbar(view);
    document.body.appendChild(tb.dom);
    // Put the caret inside the first cell's paragraph (doc>table>row>cell>paragraph>text).
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
  }
  function countNodes(name: string): number {
    let count = 0;
    view.state.doc.descendants(node => { if (node.type.name === name) count++; return true; });
    return count;
  }

  it('exposes the four structural acts', () => {
    mountTable();
    for (const act of ['addRowAfter', 'deleteRow', 'addColumnAfter', 'deleteColumn']) {
      expect(ctrl(act)).not.toBeNull();
    }
  });

  it('addRowAfter adds a table row', () => {
    mountTable();
    expect(countNodes('table_row')).toBe(1);
    ctrl<HTMLElement>('addRowAfter').click();
    expect(countNodes('table_row')).toBe(2);
  });

  it('addColumnAfter adds a column (a cell to the row)', () => {
    mountTable();
    expect(countNodes('table_cell')).toBe(2);
    ctrl<HTMLElement>('addColumnAfter').click();
    expect(countNodes('table_cell')).toBe(3);
  });

  it('deleteRow / deleteColumn shrink the table', () => {
    mountTable();
    ctrl<HTMLElement>('addRowAfter').click();   // 2 rows
    ctrl<HTMLElement>('deleteRow').click();      // back to 1
    expect(countNodes('table_row')).toBe(1);
    ctrl<HTMLElement>('deleteColumn').click();   // 2 cells → 1
    expect(countNodes('table_cell')).toBe(1);
  });

  it('mergeCells merges a CellSelection into one cell (colspan grows)', async () => {
    const { CellSelection } = await import('prosemirror-tables');
    mountTable(); // 1×2
    const cellPos: number[] = [];
    view.state.doc.descendants((node, pos) => { if (node.type.name === 'table_cell') cellPos.push(pos); return true; });
    const sel = new CellSelection(view.state.doc.resolve(cellPos[0]), view.state.doc.resolve(cellPos[1]));
    view.dispatch(view.state.tr.setSelection(sel));
    tb.update();
    const mergeBtn = ctrl<HTMLButtonElement>('mergeCells');
    expect(mergeBtn.disabled).toBe(false);
    mergeBtn.click();
    expect(countNodes('table_cell')).toBe(1);
    let colspan = 1;
    view.state.doc.descendants(node => { if (node.type.name === 'table_cell') colspan = Number(node.attrs.colspan); return true; });
    expect(colspan).toBe(2);
  });

  it('splitCell splits a merged cell back into two', async () => {
    const { CellSelection } = await import('prosemirror-tables');
    mountTable();
    const cellPos: number[] = [];
    view.state.doc.descendants((node, pos) => { if (node.type.name === 'table_cell') cellPos.push(pos); return true; });
    view.dispatch(view.state.tr.setSelection(new CellSelection(view.state.doc.resolve(cellPos[0]), view.state.doc.resolve(cellPos[1]))));
    ctrl<HTMLElement>('mergeCells').click();
    expect(countNodes('table_cell')).toBe(1);
    // caret in the merged cell → split
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    tb.update();
    const splitBtn = ctrl<HTMLButtonElement>('splitCell');
    expect(splitBtn.disabled).toBe(false);
    splitBtn.click();
    expect(countNodes('table_cell')).toBe(2);
  });

  it('disables merge with a plain caret (no multi-cell selection) and split on an un-merged cell', () => {
    mountTable();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    tb.update();
    expect(ctrl<HTMLButtonElement>('mergeCells').disabled).toBe(true);
    expect(ctrl<HTMLButtonElement>('splitCell').disabled).toBe(true);
  });

  it('disables the structural buttons inside a MERGED table (3b refuses to restructure merges)', () => {
    // A 1-row table whose single cell spans 2 grid columns (colspan=2).
    const place = document.createElement('div');
    document.body.appendChild(place);
    const merged = docxSchema.node('table_cell', { colspan: 2 }, [docxSchema.node('paragraph', null, [docxSchema.text('Merged')])]);
    const r = docxSchema.node('table_row', null, [merged]);
    const doc = docxSchema.node('doc', null, [docxSchema.node('table', null, [r])]);
    view = new EditorView(place, { state: EditorState.create({ doc }) });
    tb = buildDocxToolbar(view);
    document.body.appendChild(tb.dom);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    tb.update();
    for (const act of ['addRowAfter', 'deleteRow', 'addColumnAfter', 'deleteColumn']) {
      expect(ctrl<HTMLButtonElement>(act).disabled).toBe(true);
    }
  });
});
