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
  color: {
    attrs: { value: {} },
    parseDOM: [
      {
        style: 'color',
        getAttrs: (value: string): { value: string } | false => {
          const hex = cssColorToHex(value);
          return hex ? { value: hex } : false;
        },
      },
    ],
    toDOM(mark: Mark): DOMOutputSpec {
      return ['span', { style: `color: ${mark.attrs.value as string}` }, 0];
    },
  },
});

/** Normalize a CSS color (`#rgb`, `#rrggbb`, `rgb(r,g,b)`) to `#rrggbb`, or null if unparseable. */
export function cssColorToHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const long = /^#([0-9a-f]{6})$/.exec(v);
  if (long) return `#${long[1]}`;
  const rgbm = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(v);
  if (rgbm) {
    const h = (n: string): string => Math.min(255, parseInt(n, 10)).toString(16).padStart(2, '0');
    return `#${h(rgbm[1])}${h(rgbm[2])}${h(rgbm[3])}`;
  }
  return null;
}

export const docxSchema = new Schema({ nodes, marks });
