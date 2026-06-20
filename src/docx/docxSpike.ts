/**
 * docxSpike — Phase 0 feasibility spike for DOCX read+edit (NOT production).
 *
 * Proves the open→edit→save round-trip on a fully PERMISSIVE, mostly in-repo stack:
 *   - read:  fflate (MIT, already a dep) unzips the .docx OPC zip; the platform
 *            DOMParser (browser + jsdom) parses word/document.xml.
 *   - write: docx (MIT, already a dep) serializes a paragraph model to a valid .docx.
 *
 * Scope is deliberately tiny: paragraphs of plain text. It exists to answer the
 * go/no-go question for docs/plans/docx-editor.plan.md, not to model OOXML.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { Document, Packer, Paragraph, TextRun } from 'docx';

/** Minimal editable model: one string per paragraph (the spike's unit of edit). */
export interface DocxSpikeModel {
  paragraphs: string[];
}

/** Read a .docx: unzip → parse word/document.xml → collect each w:p's concatenated w:t text. */
export function parseDocx(bytes: Uint8Array): DocxSpikeModel {
  const files = unzipSync(bytes);
  const docXml = files['word/document.xml'];
  if (!docXml) throw new Error('not a Word document: word/document.xml missing');
  const xml = strFromU8(docXml);
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) {
    throw new Error('word/document.xml is not well-formed XML');
  }
  const paragraphs: string[] = [];
  const ps = dom.getElementsByTagName('w:p');
  for (let i = 0; i < ps.length; i++) {
    const ts = ps[i].getElementsByTagName('w:t');
    let text = '';
    for (let j = 0; j < ts.length; j++) text += ts[j].textContent ?? '';
    paragraphs.push(text);
  }
  return { paragraphs };
}

/** Write a .docx from the model (one Paragraph + TextRun per entry). */
export async function buildDocx(model: DocxSpikeModel): Promise<Uint8Array> {
  const doc = new Document({
    sections: [
      {
        children: model.paragraphs.map(
          text => new Paragraph({ children: [new TextRun(text)] }),
        ),
      },
    ],
  });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}

/** Edit one paragraph by index, returning a new model (immutable spike helper). */
export function editParagraph(model: DocxSpikeModel, index: number, text: string): DocxSpikeModel {
  const paragraphs = model.paragraphs.slice();
  paragraphs[index] = text;
  return { paragraphs };
}
