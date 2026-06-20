/**
 * docxProseMirror — bridge the docx model (docModel.ts) to a ProseMirror editor.
 *
 * Mapping (pure, testable without a DOM): DocModel ⇄ a ProseMirror doc using the
 * MIT prosemirror-schema-basic schema (paragraphs + strong/em marks). The editor
 * view is mounted lazily; saving routes through opcEdit so untouched OOXML
 * (tables, styles) passes through verbatim — we never rebuild via the docx writer.
 */
import { schema } from 'prosemirror-schema-basic';
import { type Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';

import { type DocModel, parseDocModel, applyParagraphRuns } from './docModel';
import { openOpc, getDocumentXml, setDocumentXml, packOpc } from './opcEdit';

/** DocModel → a ProseMirror document (doc › paragraph › text with strong/em marks). */
export function docModelToDoc(model: DocModel): PMNode {
  const paragraphs = model.paragraphs.map(p => {
    const inline = p.runs
      .filter(r => r.text)
      .map(r => {
        const marks = [];
        if (r.bold) marks.push(schema.marks.strong.create());
        if (r.italic) marks.push(schema.marks.em.create());
        return schema.text(r.text, marks);
      });
    return schema.node('paragraph', null, inline);
  });
  return schema.node('doc', null, paragraphs.length ? paragraphs : [schema.node('paragraph')]);
}

/** A ProseMirror document → DocModel (inverse of docModelToDoc). */
export function docToDocModel(doc: PMNode): DocModel {
  const paragraphs: DocModel['paragraphs'] = [];
  doc.forEach(block => {
    const runs: DocModel['paragraphs'][number]['runs'] = [];
    block.forEach(inline => {
      if (inline.isText && inline.text) {
        runs.push({
          text: inline.text,
          bold: inline.marks.some(m => m.type.name === 'strong') || undefined,
          italic: inline.marks.some(m => m.type.name === 'em') || undefined,
        });
      }
    });
    paragraphs.push({ runs });
  });
  return { paragraphs };
}

export interface DocxEditorHandle {
  /** Serialize the current editor content back into .docx bytes (in-place save). */
  save(): Uint8Array;
  /** The underlying ProseMirror view (for wiring toolbars later). */
  view: EditorView;
  /** Tear down the editor view. */
  destroy(): void;
}

/**
 * Open a .docx, render its top-level paragraphs into an editable ProseMirror view
 * mounted in `container`, and return a handle whose save() writes edits back in
 * place (tables/styles preserved). Browser + jsdom.
 */
export function mountDocxEditor(container: HTMLElement, bytes: Uint8Array): DocxEditorHandle {
  const opc = openOpc(bytes);
  const originalXml = getDocumentXml(opc);
  const model = parseDocModel(originalXml);

  const state = EditorState.create({
    doc: docModelToDoc(model),
    plugins: [keymap(baseKeymap)],
  });
  const view = new EditorView(container, { state });

  return {
    view,
    save(): Uint8Array {
      const edited = docToDocModel(view.state.doc);
      setDocumentXml(opc, applyParagraphRuns(originalXml, edited.paragraphs));
      return packOpc(opc);
    },
    destroy(): void {
      view.destroy();
    },
  };
}
