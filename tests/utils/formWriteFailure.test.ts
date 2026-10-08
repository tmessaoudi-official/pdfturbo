/**
 * TEST-2 (review 2026-10-07). An edit inside a Form XObject is written by `setFormXObjectContent`, which swallowed
 * every error — so when the write threw, the caller still returned `true` and the editor recorded a true-edit that
 * never reached the file (no overlay fallback, the original text still drawn). Every entry point that writes a form
 * must report the write's outcome: `false` sends the caller to its overlay fallback, exactly as a miss does.
 *
 * The form text is drawn with an explicit `rg`, so the colour edit has an operator to change. The failure is
 * injected at the one call that replaces the stream, `doc.context.assign`, and restored before the stream is read
 * back — pdf-lib's own save routes through `assign` too.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { adaptFontkit } from '../../src/utils/fontkitAdapter';
import { addDecorationAt, changeColorAt, changeSizeAt, deleteTextAt, replaceTextAt } from '../../src/utils/contentStreamEditor';
import { makeXObjectTextPdf } from './_xobjectFixture';

const AT = { x: 50, y: 300 };
const SUBSET_AT = { x: 30, y: 150 };

/** The standard-font form: Path 1 for the in-place replace, every other edit by its own path. */
const standardForm = async () => PDFDocument.load(await makeXObjectTextPdf({ fill: '0 0 1' }));

/**
 * A form drawing "Editable" in an embedded SUBSET font (hex codes, a ToUnicode): the in-place replace takes Path 2,
 * glyph reuse, whose write is a different site from Path 1's.
 */
async function subsetForm(): Promise<PDFDocument> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(adaptFontkit(fontkit));
  const font = await pdf.embedFont(new Uint8Array(readFileSync('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf')), { subset: true });
  const page = pdf.addPage([400, 200]);
  const hex = font.encodeText('Editable').toString();
  const ctx = pdf.context;
  const bytes = (text: string) => Uint8Array.from(text, c => c.charCodeAt(0) & 0xff);
  const form = ctx.stream(bytes(`q BT /F1 24 Tf 1 0 0 1 ${SUBSET_AT.x} ${SUBSET_AT.y} Tm ${hex} Tj ET Q`), {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 400, 200], Resources: { Font: { F1: font.ref } },
  });
  page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Fx0: ctx.register(form) } }));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(bytes('q /Fx0 Do Q'))));
  return PDFDocument.load(await pdf.save({ useObjectStreams: false }));
}

const EDITS: [string, () => Promise<PDFDocument>, (doc: PDFDocument) => Promise<unknown> | unknown][] = [
  ['deleteTextAt', standardForm, doc => deleteTextAt(doc, 0, AT)],
  ['changeSizeAt', standardForm, doc => changeSizeAt(doc, 0, AT, 20)],
  ['changeColorAt', standardForm, doc => changeColorAt(doc, 0, AT, { r: 1, g: 0, b: 0 })],
  ['addDecorationAt', standardForm, doc => addDecorationAt(doc, 0, AT, 'underline')],
  ['replaceTextAt (Path 1, byte swap)', standardForm, doc => replaceTextAt(doc, 0, AT, 'Changed')],
  ['replaceTextAt (Path 2, subset glyphs)', subsetForm, doc => replaceTextAt(doc, 0, SUBSET_AT, 'tableEdi', 1)],
  ['replaceTextAt (Path 3 redraw)', standardForm, doc => replaceTextAt(doc, 0, AT, 'Changed', 3, { bold: true })],
];

/** The form's stream object as /Fx0 names it now. */
function formStream(doc: PDFDocument): PDFRawStream {
  const res = doc.getPage(0).node.Resources() as PDFDict;
  const xobjects = doc.context.lookup(res.get(PDFName.of('XObject'))) as PDFDict;
  return doc.context.lookup(xobjects.get(PDFName.of('Fx0'))) as PDFRawStream;
}

describe('a failed form write is reported, never claimed (TEST-2)', () => {
  it.each(EDITS)('%s returns false and leaves the form stream as it was', async (_name, load, edit) => {
    const doc = await load();
    const before = formStream(doc);
    const assign = doc.context.assign;
    doc.context.assign = () => { throw new Error('injected form-write failure'); };
    let result: unknown;
    try {
      result = await edit(doc);
    } finally {
      doc.context.assign = assign;
    }
    expect(result).toBe(false);
    expect(formStream(doc)).toBe(before);
  });

  // Control: the same edits on a healthy context write the form and say so, so a fix that always answers false fails.
  // `true`, not merely truthy: each of these edits keeps its original font, so none reports a substitution.
  it.each(EDITS)('control: %s writes the form and returns a success', async (_name, load, edit) => {
    const doc = await load();
    const before = formStream(doc);
    const result = await edit(doc);
    expect(result).toBe(true);
    expect(formStream(doc)).not.toBe(before);
  });
});
