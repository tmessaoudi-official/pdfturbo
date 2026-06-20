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

  it('bullet and ordered buttons wrap the selection in the right list, toggling off on repeat', () => {
    mount('item');
    ctrl<HTMLElement>('bullet').click();
    expect(view.state.doc.firstChild?.type.name).toBe('bullet_list');
    ctrl<HTMLElement>('bullet').click(); // toggle off
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    ctrl<HTMLElement>('ordered').click();
    expect(view.state.doc.firstChild?.type.name).toBe('ordered_list');
  });
});
