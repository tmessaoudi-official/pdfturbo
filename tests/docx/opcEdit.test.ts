/**
 * Phase 1 increment 1a: in-place OPC editing with verbatim pass-through.
 * The critical Phase-1 guarantee (per the spike verdict): editing one paragraph
 * must NOT drop unmodeled OOXML (tables, styles). We edit word/document.xml in
 * place and re-zip — we do NOT rebuild via the `docx` writer.
 */
import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell } from 'docx';
import { openOpc, getDocumentXml, setDocumentXml, packOpc, replaceTextInXml } from '../../src/docx/opcEdit';
import { parseDocx } from '../../src/docx/docxSpike';

/** A .docx containing a paragraph AND a table (a structure the docx-rebuild path can model, but which we must preserve WITHOUT rebuilding). */
async function makeDocxWithTable(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun('Edit me')] }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('Cell A')] }),
                  new TableCell({ children: [new Paragraph('Cell B')] }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

describe('opcEdit — in-place OPC editing (pass-through)', () => {
  it('opens, exposes, and re-zips an OPC package losslessly', async () => {
    const bytes = await makeDocxWithTable();
    const opc = openOpc(bytes);
    expect(getDocumentXml(opc)).toContain('Edit me');
    const repacked = packOpc(opc);
    // Re-zipping without changes still yields a readable docx.
    expect(parseDocx(repacked).paragraphs).toContain('Edit me');
  });

  it('edits one paragraph IN PLACE while PRESERVING the untouched table (no docx-rebuild)', async () => {
    const bytes = await makeDocxWithTable();
    const opc = openOpc(bytes);
    const xml = getDocumentXml(opc);
    expect(xml).toContain('<w:tbl'); // sanity: the fixture really has a table

    const editedXml = replaceTextInXml(xml, 'Edit me', 'EDITED');
    setDocumentXml(opc, editedXml);
    const repacked = packOpc(opc);

    // The edit applied …
    const model = parseDocx(repacked);
    expect(model.paragraphs).toContain('EDITED');
    expect(model.paragraphs).not.toContain('Edit me');
    // … AND the table survived (pass-through — the whole point).
    expect(getDocumentXml(openOpc(repacked))).toContain('<w:tbl');
    expect(model.paragraphs).toEqual(expect.arrayContaining(['Cell A', 'Cell B']));
  });

  it('returns the XML unchanged when the target text is not present', async () => {
    const opc = openOpc(await makeDocxWithTable());
    const xml = getDocumentXml(opc);
    expect(replaceTextInXml(xml, 'nonexistent', 'X')).toBe(xml);
  });
});
