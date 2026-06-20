/**
 * Task 3 — find/replace bar UI (jsdom). Drives the bar's DOM against a live (bare)
 * ProseMirror view carrying the plugin, asserting open/close visibility, the option
 * toggles, the live counter, and the invalid-regex error state. Layout-dependent
 * scroll calls are stubbed (jsdom has no layout).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { docxSchema } from '../../src/docx/docxSchema';
import { findReplacePlugin, findReplaceKey } from '../../src/docx/findReplacePlugin';
import { buildFindReplaceBar, type FindReplaceBar } from '../../src/docx/findReplaceBar';
import { initI18n } from '../../src/utils/i18n';

function paraDoc(text: string): ReturnType<typeof docxSchema.node> {
  return docxSchema.node('doc', null, [docxSchema.node('paragraph', null, [docxSchema.text(text)])]);
}

function fakeRect(): DOMRect {
  return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

let view: EditorView;
let bar: FindReplaceBar;
function mount(text: string): void {
  const place = document.createElement('div');
  document.body.appendChild(place);
  view = new EditorView(place, { state: EditorState.create({ doc: paraDoc(text), plugins: [findReplacePlugin()] }) });
  bar = buildFindReplaceBar(view);
  document.body.appendChild(bar.dom);
}
const q = <T extends Element>(sel: string): T => bar.dom.querySelector(sel) as T;

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  document.body.innerHTML = '';
  Element.prototype.getClientRects = (): DOMRectList => [fakeRect()] as unknown as DOMRectList;
  Element.prototype.getBoundingClientRect = (): DOMRect => fakeRect();
  Range.prototype.getClientRects = (): DOMRectList => [fakeRect()] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = (): DOMRect => fakeRect();
});

describe('findReplaceBar', () => {
  it('open(false) shows the bar with the replace row hidden', () => {
    mount('hello');
    bar.open(false);
    expect(bar.isOpen()).toBe(true);
    expect(bar.dom.style.display).not.toBe('none');
    expect(q<HTMLElement>('.fr-replace-row').style.display).toBe('none');
  });

  it('open(true) reveals the replace row', () => {
    mount('hello');
    bar.open(true);
    expect(q<HTMLElement>('.fr-replace-row').style.display).not.toBe('none');
  });

  it('typing a query updates the live counter', () => {
    mount('a x a');
    bar.open(false);
    const find = q<HTMLInputElement>('.fr-find');
    find.value = 'a';
    find.dispatchEvent(new Event('input'));
    expect(q<HTMLElement>('.fr-counter').textContent).toBe('1 of 2');
  });

  it('shows a "+" in the counter when matches are capped', () => {
    mount('a'.repeat(1100));
    bar.open(false);
    const find = q<HTMLInputElement>('.fr-find');
    find.value = 'a';
    find.dispatchEvent(new Event('input'));
    expect(q<HTMLElement>('.fr-counter').textContent).toBe('1 of 1000+');
  });

  it('the close button closes the bar and deactivates the plugin', () => {
    mount('hello');
    bar.open(false);
    q<HTMLButtonElement>('.fr-close').click();
    expect(bar.isOpen()).toBe(false);
    expect(findReplaceKey.getState(view.state)?.active).toBe(false);
  });

  it('an invalid regex marks the find field as errored', () => {
    mount('hello');
    bar.open(false);
    q<HTMLButtonElement>('[data-opt="regex"]').click(); // enable regex
    const find = q<HTMLInputElement>('.fr-find');
    find.value = '(';
    find.dispatchEvent(new Event('input'));
    expect(find.classList.contains('fr-error')).toBe(true);
    expect(q<HTMLElement>('.fr-counter').textContent).toBe('0 of 0');
  });

  it('clicking a toggle reflects active state', () => {
    mount('hello');
    bar.open(false);
    const caseBtn = q<HTMLButtonElement>('[data-opt="case"]');
    caseBtn.click();
    expect(caseBtn.classList.contains('active')).toBe(true);
  });
});
