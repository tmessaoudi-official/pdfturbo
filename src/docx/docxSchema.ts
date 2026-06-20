/**
 * docxSchema — the ProseMirror schema for the DOCX rich-text editor. Extends the
 * MIT prosemirror-schema-basic (which already provides a `heading` node, levels 1–6,
 * and strong/em/code/link marks) with:
 *   - bullet/ordered lists via prosemirror-schema-list (MIT)
 *   - an `underline` mark and `fontFamily` / `fontSize` attribute-marks
 * Everything maps cleanly to OOXML run/paragraph properties on save (docxProseMirror).
 */
import { Schema, type DOMOutputSpec, type Mark } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { tableNodes } from 'prosemirror-tables';

// list_item content = a paragraph followed by any block (allows nested lists).
// schema.spec.{nodes,marks} are OrderedMaps (the prosemirror-example-setup pattern).
let nodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');
nodes = nodes.append(
  tableNodes({
    tableGroup: 'block',     // tables are top-level + nestable block content
    cellContent: 'block+',   // cells hold paragraphs, headings, lists, nested tables
    cellAttributes: {},      // 3a models no extra cell attrs (colspan/rowspan/colwidth are built in)
  }),
);

const marks = basicSchema.spec.marks.append({
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM(): DOMOutputSpec {
      return ['u', 0];
    },
  },
  fontFamily: {
    attrs: { family: {} },
    parseDOM: [
      {
        style: 'font-family',
        getAttrs: (value: string): { family: string } => ({ family: value.replace(/["']/g, '').trim() }),
      },
    ],
    toDOM(mark: Mark): DOMOutputSpec {
      return ['span', { style: `font-family: ${mark.attrs.family as string}` }, 0];
    },
  },
  fontSize: {
    attrs: { size: {} },
    parseDOM: [
      {
        style: 'font-size',
        getAttrs: (value: string): { size: number } | false => {
          const pt = parseFloat(value);
          return Number.isFinite(pt) && pt > 0 ? { size: pt } : false;
        },
      },
    ],
    toDOM(mark: Mark): DOMOutputSpec {
      return ['span', { style: `font-size: ${mark.attrs.size as number}pt` }, 0];
    },
  },
});

export const docxSchema = new Schema({ nodes, marks });
