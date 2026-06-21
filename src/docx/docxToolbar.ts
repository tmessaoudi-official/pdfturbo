/**
 * docxToolbar — the rich-text formatting toolbar for the DOCX editor. Each control
 * dispatches a ProseMirror command against the live view; bold/italic/underline
 * reflect active state after every transaction. Built on docxSchema; pure DOM, no
 * framework. i18n via t().
 */
import { type EditorView } from 'prosemirror-view';
import { type EditorState, type Transaction, type Command } from 'prosemirror-state';
import { toggleMark, setBlockType } from 'prosemirror-commands';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import { type MarkType, type NodeType } from 'prosemirror-model';
import { docxSchema } from './docxSchema';
import { t } from '../utils/i18n';

const m = docxSchema.marks;
const n = docxSchema.nodes;

const FONTS = ['Arial', 'Calibri', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana'];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 28, 32, 36, 48];

export interface DocxToolbar {
  dom: HTMLElement;
  /** Re-sync control state from the current selection. */
  update(): void;
  destroy(): void;
}

/** Set (or, with attrs=null, clear) an attribute-mark across the selection. */
function setMarkAttr(markType: MarkType, attrs: Record<string, unknown> | null): Command {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const { from, to, empty } = state.selection;
    if (dispatch) {
      const tr = state.tr;
      if (empty) {
        if (attrs) tr.addStoredMark(markType.create(attrs));
        else tr.removeStoredMark(markType);
      } else {
        tr.removeMark(from, to, markType);
        if (attrs) tr.addMark(from, to, markType.create(attrs));
      }
      dispatch(tr);
    }
    return true;
  };
}

function markActive(state: EditorState, markType: MarkType): boolean {
  const { from, to, empty, $from } = state.selection;
  if (empty) return Boolean(markType.isInSet(state.storedMarks || $from.marks()));
  return state.doc.rangeHasMark(from, to, markType);
}

/** True when the selection head sits inside a list of `listType`. */
function inList(state: EditorState, listType: NodeType): boolean {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === listType) return true;
  return false;
}

/** Heading level (1–3) of the selection's top block, or 0 for a plain paragraph. */
function currentHeading(state: EditorState): number {
  const node = state.selection.$from.node(1);
  return node && node.type === n.heading ? Number(node.attrs.level) : 0;
}

export function buildDocxToolbar(view: EditorView): DocxToolbar {
  const dom = document.createElement('div');
  dom.className = 'docx-toolbar';

  const run = (cmd: Command): void => {
    cmd(view.state, view.dispatch.bind(view), view);
    view.focus();
  };

  const btn = (act: string, label: string, cmd: () => Command): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'docx-tb-btn';
    b.dataset.act = act;
    b.textContent = label;
    b.title = label;
    b.addEventListener('mousedown', e => e.preventDefault()); // keep editor selection
    b.addEventListener('click', () => run(cmd()));
    return b;
  };

  const boldBtn = btn('bold', t('docxToolbar.bold'), () => toggleMark(m.strong));
  const italicBtn = btn('italic', t('docxToolbar.italic'), () => toggleMark(m.em));
  const underlineBtn = btn('underline', t('docxToolbar.underline'), () => toggleMark(m.underline));

  // Heading select.
  const headingSel = document.createElement('select');
  headingSel.className = 'docx-tb-select';
  headingSel.dataset.act = 'heading';
  for (const [val, key] of [['0', 'headingNormal'], ['1', 'h1'], ['2', 'h2'], ['3', 'h3']] as const) {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = t(`docxToolbar.${key}`);
    headingSel.appendChild(o);
  }
  headingSel.addEventListener('change', () => {
    const lvl = Number(headingSel.value);
    run(lvl === 0 ? setBlockType(n.paragraph) : setBlockType(n.heading, { level: lvl }));
  });

  // Font-family select (first option = inherit/clear).
  const fontSel = document.createElement('select');
  fontSel.className = 'docx-tb-select';
  fontSel.dataset.act = 'font';
  const fontDefault = document.createElement('option');
  fontDefault.value = '';
  fontDefault.textContent = t('docxToolbar.font');
  fontSel.appendChild(fontDefault);
  for (const f of FONTS) {
    const o = document.createElement('option');
    o.value = f;
    o.textContent = f;
    fontSel.appendChild(o);
  }
  fontSel.addEventListener('change', () => {
    run(setMarkAttr(m.fontFamily, fontSel.value ? { family: fontSel.value } : null));
  });

  // Size select (first option = inherit/clear).
  const sizeSel = document.createElement('select');
  sizeSel.className = 'docx-tb-select';
  sizeSel.dataset.act = 'size';
  const sizeDefault = document.createElement('option');
  sizeDefault.value = '';
  sizeDefault.textContent = t('docxToolbar.size');
  sizeSel.appendChild(sizeDefault);
  for (const s of SIZES) {
    const o = document.createElement('option');
    o.value = String(s);
    o.textContent = String(s);
    sizeSel.appendChild(o);
  }
  sizeSel.addEventListener('change', () => {
    run(setMarkAttr(m.fontSize, sizeSel.value ? { size: Number(sizeSel.value) } : null));
  });

  // Font color picker. A native <input type=color> always carries a #rrggbb value;
  // selecting one applies the `color` mark across the selection (or stored mark when empty).
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'docx-tb-color';
  colorInput.dataset.act = 'color';
  colorInput.title = t('docxToolbar.color');
  colorInput.value = '#000000';
  colorInput.addEventListener('input', () => run(setMarkAttr(m.color, { value: colorInput.value })));

  const toggleList = (listType: NodeType): Command =>
    inList(view.state, listType) ? liftListItem(n.list_item) : wrapInList(listType);
  const bulletBtn = btn('bullet', t('docxToolbar.bulletList'), () => toggleList(n.bullet_list));
  const orderedBtn = btn('ordered', t('docxToolbar.orderedList'), () => toggleList(n.ordered_list));

  dom.append(boldBtn, italicBtn, underlineBtn, headingSel, fontSel, sizeSel, colorInput, bulletBtn, orderedBtn);

  const update = (): void => {
    boldBtn.classList.toggle('active', markActive(view.state, m.strong));
    italicBtn.classList.toggle('active', markActive(view.state, m.em));
    underlineBtn.classList.toggle('active', markActive(view.state, m.underline));
    headingSel.value = String(currentHeading(view.state));
    bulletBtn.classList.toggle('active', inList(view.state, n.bullet_list));
    orderedBtn.classList.toggle('active', inList(view.state, n.ordered_list));
    const cMark = (view.state.storedMarks || view.state.selection.$from.marks()).find(mk => mk.type === m.color);
    if (cMark) colorInput.value = cMark.attrs.value as string;
  };

  // Hook the view's dispatch so the toolbar re-syncs after every transaction.
  view.setProps({
    dispatchTransaction(tr): void {
      view.updateState(view.state.apply(tr));
      update();
    },
  });
  update();

  return {
    dom,
    update,
    destroy(): void {
      dom.remove();
    },
  };
}
