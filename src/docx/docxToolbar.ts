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
import { addRowAfter, deleteRow, addColumnAfter, deleteColumn, mergeCells, splitCell, isInTable } from 'prosemirror-tables';
import { type MarkType, type NodeType } from 'prosemirror-model';
import { docxSchema } from './docxSchema';
import { sanitizeLinkUrl } from '../utils/linkUrl';
import { t } from '../utils/i18n';

const m = docxSchema.marks;
const n = docxSchema.nodes;

const FONTS = ['Arial', 'Calibri', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana'];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 28, 32, 36, 48];
const PT_PER_PX = 0.75;            // 96 DPI → 72 pt/in
const CONTENT_WIDTH_PT = 468;      // usable width on a letter page (8.5in − 2×1in margins)

export interface DocxToolbar {
  dom: HTMLElement;
  /** Re-sync control state from the current selection. */
  update(): void;
  /** Insert a new image at the selection (B insert): a docx_image node with anchorId -1. */
  insertImage(bytes: Uint8Array, mime: 'image/png' | 'image/jpeg', widthPt: number, heightPt: number): void;
  destroy(): void;
}

/** PNG magic `89 50 4E 47`; JPEG `FF D8 FF`. null for anything we can't embed. */
function sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

function imgBytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
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

/** True when the table containing the selection has any merged cell (colspan/rowspan
 * > 1). Slice 3b refuses to restructure merged tables (the save keeps them verbatim),
 * so the row/column buttons are disabled there to avoid a silent no-op on save. */
function currentTableHasMerges(state: EditorState): boolean {
  const $from = state.selection.$from;
  let table = null;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') { table = $from.node(d); break; }
  }
  if (!table) return false;
  let merged = false;
  table.descendants(node => {
    if (node.type.name === 'table_cell' && ((Number(node.attrs.colspan) || 1) > 1 || (Number(node.attrs.rowspan) || 1) > 1)) {
      merged = true;
      return false;
    }
    return true;
  });
  return merged;
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

  // Link control: a 🔗 button + an inline URL input (revealed on click; NOT a blocking
  // window.prompt). With the caret inside a link the button removes it; otherwise it reveals
  // the input, and Enter sanitizes + applies the `link` mark over the selection. C3.
  const linkInput = document.createElement('input');
  linkInput.type = 'url';
  linkInput.className = 'docx-tb-linkinput';
  linkInput.dataset.act = 'linkInput';
  linkInput.placeholder = t('docxToolbar.linkPrompt');
  linkInput.style.display = 'none';
  const applyLink = (): void => {
    const url = sanitizeLinkUrl(linkInput.value);
    if (url) run(setMarkAttr(m.link, { href: url }));
    linkInput.value = '';
    linkInput.style.display = 'none';
  };
  linkInput.addEventListener('mousedown', e => e.stopPropagation());
  linkInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
    else if (e.key === 'Escape') { linkInput.value = ''; linkInput.style.display = 'none'; view.focus(); }
  });
  const linkBtn = document.createElement('button');
  linkBtn.type = 'button';
  linkBtn.className = 'docx-tb-btn';
  linkBtn.dataset.act = 'link';
  linkBtn.textContent = t('docxToolbar.link');
  linkBtn.title = t('docxToolbar.link');
  linkBtn.addEventListener('mousedown', e => e.preventDefault());
  linkBtn.addEventListener('click', () => {
    if (markActive(view.state, m.link)) {
      run(setMarkAttr(m.link, null)); // caret in a link → remove it
    } else if (!view.state.selection.empty) {
      linkInput.style.display = '';
      linkInput.focus();
    }
  });

  // Table-editing controls (Slice 3b). prosemirror-tables commands no-op outside a
  // table; update() also reflects their enabled state from isInTable.
  const addRowBtn = btn('addRowAfter', t('docxToolbar.addRow'), () => addRowAfter);
  const deleteRowBtn = btn('deleteRow', t('docxToolbar.deleteRow'), () => deleteRow);
  const addColBtn = btn('addColumnAfter', t('docxToolbar.addColumn'), () => addColumnAfter);
  const deleteColBtn = btn('deleteColumn', t('docxToolbar.deleteColumn'), () => deleteColumn);
  const tableBtns = [addRowBtn, deleteRowBtn, addColBtn, deleteColBtn];

  // Merge / split (3c/3d). Their enabled state mirrors the command's own applicability
  // (mergeCells → a multi-cell CellSelection; splitCell → a spanned cell), probed by
  // calling the command with no dispatch.
  const mergeBtn = btn('mergeCells', t('docxToolbar.mergeCells'), () => mergeCells);
  const splitBtn = btn('splitCell', t('docxToolbar.splitCell'), () => splitCell);

  // Insert image (B insert): a 📷 button + a hidden file input. On pick: sniff PNG/JPEG,
  // measure natural size via createImageBitmap, scale to pt (clamped to the content width),
  // and insert a docx_image node (anchorId -1) — the save then mints the OPC media part.
  const insertImage = (bytes: Uint8Array, mime: 'image/png' | 'image/jpeg', widthPt: number, heightPt: number): void => {
    const node = n.docx_image.create({ dataB64: imgBytesToB64(bytes), mime, widthPt, heightPt, anchorId: -1 });
    view.dispatch(view.state.tr.replaceSelectionWith(node));
    view.focus();
  };
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg';
  fileInput.dataset.act = 'insertImageFile';
  fileInput.style.display = 'none';
  const handlePick = async (): Promise<void> => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffImageMime(bytes);
    if (!mime) return; // accept filter already restricts to png/jpeg; silently skip others
    let widthPt = 0;
    let heightPt = 0;
    try {
      const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
      widthPt = Math.min(bmp.width * PT_PER_PX, CONTENT_WIDTH_PT);
      heightPt = bmp.width > 0 ? widthPt * (bmp.height / bmp.width) : 0;
      bmp.close();
    } catch { /* dims stay 0 → image still inserts at natural-ish default */ }
    insertImage(bytes, mime, widthPt, heightPt);
  };
  fileInput.addEventListener('change', () => { void handlePick(); });
  const insertImageBtn = document.createElement('button');
  insertImageBtn.type = 'button';
  insertImageBtn.className = 'docx-tb-btn';
  insertImageBtn.dataset.act = 'insertImage';
  insertImageBtn.textContent = t('docxToolbar.insertImage');
  insertImageBtn.title = t('docxToolbar.insertImage');
  insertImageBtn.addEventListener('mousedown', e => e.preventDefault());
  insertImageBtn.addEventListener('click', () => fileInput.click());

  dom.append(boldBtn, italicBtn, underlineBtn, headingSel, fontSel, sizeSel, colorInput, bulletBtn, orderedBtn, linkBtn, linkInput, ...tableBtns, mergeBtn, splitBtn, insertImageBtn, fileInput);

  const update = (): void => {
    boldBtn.classList.toggle('active', markActive(view.state, m.strong));
    italicBtn.classList.toggle('active', markActive(view.state, m.em));
    underlineBtn.classList.toggle('active', markActive(view.state, m.underline));
    headingSel.value = String(currentHeading(view.state));
    bulletBtn.classList.toggle('active', inList(view.state, n.bullet_list));
    orderedBtn.classList.toggle('active', inList(view.state, n.ordered_list));
    linkBtn.classList.toggle('active', markActive(view.state, m.link));
    const structural = isInTable(view.state) && !currentTableHasMerges(view.state);
    for (const b of tableBtns) b.disabled = !structural;
    mergeBtn.disabled = !mergeCells(view.state);
    splitBtn.disabled = !splitCell(view.state);
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
    insertImage,
    destroy(): void {
      dom.remove();
    },
  };
}
