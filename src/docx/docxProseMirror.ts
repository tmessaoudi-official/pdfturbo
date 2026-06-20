/**
 * docxProseMirror — bridge the docx model (docModel.ts) to a ProseMirror editor
 * built on docxSchema (paragraphs, headings, lists; strong/em/underline/font/size).
 *
 * The model is FLAT (one paragraph per OOXML `w:p`, list membership carried as
 * `list:{ordered,level}`), matching OOXML where each list item is a paragraph with
 * `w:numPr`. The PM doc is NESTED (bullet_list/ordered_list/list_item). The two
 * mappers convert between flat↔nested. Saving routes through opcEdit so untouched
 * OOXML (tables, styles) passes through verbatim; heading/list ids are resolved from
 * the package (opcParts) only when the model actually uses them.
 */
import { type Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';

import { docxSchema } from './docxSchema';
import { buildDocxToolbar } from './docxToolbar';
import { findReplacePlugin } from './findReplacePlugin';
import { buildFindReplaceBar, type FindReplaceBar } from './findReplaceBar';
import { cleanWordHtml } from './wordPaste';
import { type DocModel, type DocParagraph, type DocRun, parseDocModel, applyParagraphRuns, type DocApplyIds } from './docModel';
import { openOpc, getDocumentXml, setDocumentXml, packOpc } from './opcEdit';
import { ensureHeadingStyles, ensureListNumbering, buildNumberingMap } from './opcParts';

const m = docxSchema.marks;
const n = docxSchema.nodes;

/** One model run → a ProseMirror text node carrying the corresponding marks. */
function inlineOf(run: DocRun): PMNode {
  const marks = [];
  if (run.bold) marks.push(m.strong.create());
  if (run.italic) marks.push(m.em.create());
  if (run.underline) marks.push(m.underline.create());
  if (run.fontFamily) marks.push(m.fontFamily.create({ family: run.fontFamily }));
  if (run.fontSize) marks.push(m.fontSize.create({ size: run.fontSize }));
  return docxSchema.text(run.text, marks);
}
function inlineFor(para: DocParagraph): PMNode[] {
  return para.runs.filter(r => r.text).map(inlineOf);
}
/** A non-list model paragraph → a `heading` or `paragraph` node. */
function blockFor(para: DocParagraph): PMNode {
  const inline = inlineFor(para);
  if (para.heading) return n.heading.create({ level: para.heading }, inline);
  return n.paragraph.create(null, inline);
}
function listParagraph(para: DocParagraph): PMNode {
  return n.paragraph.create(null, inlineFor(para));
}

/** Build a (possibly nested) list node for items[pos] at `level`, consuming items of
 * the same ordered-ness at this level and recursing for deeper ones. Returns the list
 * node and the index of the first unconsumed item. */
function buildLevel(items: DocParagraph[], pos: number, level: number): { node: PMNode; next: number } {
  const ordered = items[pos].list?.ordered ?? false;
  const listItems: PMNode[] = [];
  let i = pos;
  while (i < items.length) {
    const lst = items[i].list;
    if (!lst || lst.level < level) break; // belongs to a shallower list → caller handles
    if (lst.level === level && lst.ordered !== ordered) break; // sibling list of other kind
    if (lst.level > level) break; // safety: deeper without a same-level parent here
    const children: PMNode[] = [listParagraph(items[i])];
    i += 1;
    // Absorb a deeper run as a nested list inside this item.
    if (i < items.length && (items[i].list?.level ?? -1) > level) {
      const sub = buildLevel(items, i, level + 1);
      children.push(sub.node);
      i = sub.next;
    }
    listItems.push(n.list_item.create(null, children));
  }
  const listType = ordered ? n.ordered_list : n.bullet_list;
  return { node: listType.create(null, listItems), next: i };
}

/** A maximal run of consecutive list paragraphs → one or more sibling list nodes. */
function buildListRun(items: DocParagraph[]): PMNode[] {
  const nodes: PMNode[] = [];
  let pos = 0;
  while (pos < items.length) {
    const r = buildLevel(items, pos, items[pos].list?.level ?? 0);
    nodes.push(r.node);
    pos = r.next === pos ? pos + 1 : r.next; // guard against non-advance
  }
  return nodes;
}

/** DocModel → a ProseMirror document (flat paragraphs → nested headings/lists). */
export function docModelToDoc(model: DocModel): PMNode {
  const blocks: PMNode[] = [];
  let i = 0;
  while (i < model.paragraphs.length) {
    const p = model.paragraphs[i];
    if (!p.list) {
      blocks.push(blockFor(p));
      i += 1;
    } else {
      const run: DocParagraph[] = [];
      while (i < model.paragraphs.length && model.paragraphs[i].list) {
        run.push(model.paragraphs[i]);
        i += 1;
      }
      blocks.push(...buildListRun(run));
    }
  }
  return n.doc.create(null, blocks.length ? blocks : [n.paragraph.create()]);
}

function runsOf(node: PMNode): DocRun[] {
  const runs: DocRun[] = [];
  node.forEach(inline => {
    if (inline.isText && inline.text) {
      const has = (name: string): boolean => inline.marks.some(mk => mk.type.name === name);
      const attr = (name: string, key: string): unknown => inline.marks.find(mk => mk.type.name === name)?.attrs[key];
      const family = attr('fontFamily', 'family');
      const size = attr('fontSize', 'size');
      runs.push({
        text: inline.text,
        bold: has('strong') || undefined,
        italic: has('em') || undefined,
        underline: has('underline') || undefined,
        fontFamily: typeof family === 'string' ? family : undefined,
        fontSize: typeof size === 'number' ? size : undefined,
      });
    }
  });
  return runs;
}
function clampHeading(level: unknown): 1 | 2 | 3 {
  const l = Number(level);
  return (l <= 1 ? 1 : l >= 3 ? 3 : 2) as 1 | 2 | 3;
}

/** Walk a PM block, appending flat model paragraphs; lists recurse with a depth. */
function emitBlock(node: PMNode, depth: number, out: DocParagraph[]): void {
  const name = node.type.name;
  if (name === 'paragraph') {
    out.push({ runs: runsOf(node) });
  } else if (name === 'heading') {
    out.push({ runs: runsOf(node), heading: clampHeading(node.attrs.level) });
  } else if (name === 'bullet_list' || name === 'ordered_list') {
    const ordered = name === 'ordered_list';
    node.forEach(item => {
      // item is a list_item: first paragraph = this list entry, deeper nodes recurse.
      let first = true;
      item.forEach(child => {
        if (child.type.name === 'paragraph' && first) {
          out.push({ runs: runsOf(child), list: { ordered, level: depth } });
          first = false;
        } else {
          emitBlock(child, depth + 1, out);
        }
      });
    });
  }
  // other block types (blockquote, code_block, …) are not modeled → skipped
}

/** A ProseMirror document → DocModel (inverse of docModelToDoc; nested → flat). */
export function docToDocModel(doc: PMNode): DocModel {
  const paragraphs: DocParagraph[] = [];
  doc.forEach(block => emitBlock(block, 0, paragraphs));
  const blocks = paragraphs;
  return { blocks, paragraphs };
}

export interface DocxEditorHandle {
  /** Serialize the current editor content back into .docx bytes (in-place save). */
  save(): Uint8Array;
  /** The current editable model — used by PDF export. */
  getModel(): DocModel;
  /** The underlying ProseMirror view (for wiring toolbars). */
  view: EditorView;
  /** The rich-text toolbar element (the controller mounts it above the editor). */
  toolbarDom?: HTMLElement;
  /** The find/replace bar element (the controller mounts it below the toolbar). */
  findReplaceBar?: HTMLElement;
  /** Tear down the editor view. */
  destroy(): void;
}

/**
 * Open a .docx, render its top-level paragraphs into an editable ProseMirror view
 * mounted in `container`, and return a handle whose save() writes edits back in
 * place (tables/styles preserved; heading/list ids resolved only when used).
 */
export function mountDocxEditor(container: HTMLElement, bytes: Uint8Array): DocxEditorHandle {
  const opc = openOpc(bytes);
  const originalXml = getDocumentXml(opc);
  const model = parseDocModel(originalXml, buildNumberingMap(opc));

  // Forward-declared so the Mod-f/Mod-h keymap (built at state creation, before the
  // view+bar exist) can open the bar once it's wired up.
  let barRef: FindReplaceBar | null = null;

  const state = EditorState.create({
    doc: docModelToDoc(model),
    plugins: [
      findReplacePlugin(),
      // Mod-f / Mod-h open the in-app find/replace bar. This intentionally overrides the
      // browser's native Find — but ONLY while the editor view holds DOM focus, because a
      // prosemirror-keymap handler is dispatched solely on editor-focused keydown. Outside
      // the editor (or with it closed) the browser's Ctrl+F works normally. This matches the
      // in-app-editor norm (Google Docs / VS Code / Notion all capture Ctrl+F when focused).
      keymap({
        'Mod-f': () => {
          barRef?.open(false);
          return true;
        },
        'Mod-h': () => {
          barRef?.open(true);
          return true;
        },
      }),
      keymap({
        Enter: splitListItem(n.list_item),
        Tab: sinkListItem(n.list_item),
        'Shift-Tab': liftListItem(n.list_item),
      }),
      keymap(baseKeymap),
    ],
  });
  // Ctrl/Cmd+Shift+V arms a one-shot plain-text paste (read+cleared by handlePaste).
  let _plainPasteArmed = false;
  const _onKeydown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
      _plainPasteArmed = true;
    }
  };

  const view = new EditorView(container, {
    state,
    transformPastedHTML: (html: string): string => cleanWordHtml(html),
    handlePaste: (v, event): boolean => {
      if (!_plainPasteArmed) return false;
      _plainPasteArmed = false;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      // Drop SOURCE formatting; inserted text inherits the destination context
      // (true "paste and match style"). insertText is jsdom-safe; pasteText is not.
      v.dispatch(v.state.tr.insertText(text));
      return true;
    },
  });
  view.dom.addEventListener('keydown', _onKeydown);
  const toolbar = buildDocxToolbar(view);
  const bar = buildFindReplaceBar(view);
  barRef = bar;
  // Centralise the post-transaction sync so BOTH the toolbar and the find/replace bar
  // refresh (the toolbar set its own dispatchTransaction; this supersedes it). setProps
  // merges, so transformPastedHTML / handlePaste are preserved.
  view.setProps({
    dispatchTransaction(tr): void {
      view.updateState(view.state.apply(tr));
      toolbar.update();
      bar.update();
    },
  });

  return {
    view,
    toolbarDom: toolbar.dom,
    findReplaceBar: bar.dom,
    save(): Uint8Array {
      const edited = docToDocModel(view.state.doc);
      const hasHeading = edited.paragraphs.some(p => p.heading !== undefined);
      const hasList = edited.paragraphs.some(p => p.list !== undefined);
      let ids: DocApplyIds | undefined;
      if (hasHeading || hasList) {
        const heading = hasHeading ? ensureHeadingStyles(opc) : { 1: 'Heading1', 2: 'Heading2', 3: 'Heading3' };
        const list = hasList ? ensureListNumbering(opc) : { bulletNumId: 0, orderedNumId: 0 };
        ids = { heading, bulletNumId: list.bulletNumId, orderedNumId: list.orderedNumId };
      }
      setDocumentXml(opc, applyParagraphRuns(originalXml, edited.paragraphs, ids));
      return packOpc(opc);
    },
    getModel(): DocModel {
      return docToDocModel(view.state.doc);
    },
    destroy(): void {
      view.dom.removeEventListener('keydown', _onKeydown);
      bar.destroy();
      toolbar.destroy();
      view.destroy();
    },
  };
}
