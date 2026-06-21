/**
 * Phase 1 #1b: docx model ⇄ ProseMirror mapping + the mounted editor, saving
 * through opcEdit (in-place, pass-through). jsdom (ProseMirror runs in jsdom).
 */
import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell } from 'docx';
import { parseDocModel, applyParagraphTexts, applyParagraphRuns, paragraphText, type DocModel } from '../../src/docx/docModel';
import { docModelToDoc, docToDocModel, mountDocxEditor } from '../../src/docx/docxProseMirror';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';
import { parseDocx } from '../../src/docx/docxSpike';

async function makeStyledDocx(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun({ text: 'Plain' })] }),
          new Paragraph({ children: [new TextRun({ text: 'BoldWord', bold: true }), new TextRun({ text: ' ital', italics: true })] }),
          new Table({
            rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('Cell A')] })] })],
          }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

describe('docModel — parse top-level paragraphs with formatting', () => {
  it('reads bold/italic runs and ignores table-internal paragraphs', async () => {
    const xml = getDocumentXml(openOpc(await makeStyledDocx()));
    const model = parseDocModel(xml);
    expect(model.paragraphs.map(paragraphText)).toEqual(['Plain', 'BoldWord ital']); // table cell NOT included
    expect(model.paragraphs[1].runs[0]).toMatchObject({ text: 'BoldWord', bold: true });
    expect(model.paragraphs[1].runs[1]).toMatchObject({ text: ' ital', italic: true });
  });
});

describe('docModel — applyParagraphTexts (in-place, pass-through)', () => {
  it('edits a top-level paragraph while preserving the table', async () => {
    const xml = getDocumentXml(openOpc(await makeStyledDocx()));
    const edited = applyParagraphTexts(xml, ['PLAIN-EDITED', 'BoldWord ital']);
    expect(edited).toContain('<w:tbl'); // table survived
    expect(parseDocModel(edited).paragraphs.map(paragraphText)).toEqual(['PLAIN-EDITED', 'BoldWord ital']);
  });

  it('appends a new paragraph when there are more texts than originals', async () => {
    const xml = getDocumentXml(openOpc(await makeStyledDocx()));
    const edited = applyParagraphTexts(xml, ['a', 'b', 'c-new']);
    expect(parseDocModel(edited).paragraphs.map(paragraphText)).toEqual(['a', 'b', 'c-new']);
    expect(edited).toContain('<w:tbl');
  });

  it('removes trailing paragraphs when there are fewer texts', async () => {
    const xml = getDocumentXml(openOpc(await makeStyledDocx()));
    const edited = applyParagraphTexts(xml, ['only']);
    expect(parseDocModel(edited).paragraphs.map(paragraphText)).toEqual(['only']);
    expect(edited).toContain('<w:tbl'); // table is not a top-level paragraph → untouched
  });
});

describe('docModel — applyParagraphRuns (per-run formatting, in place)', () => {
  it('writes multiple bold/italic runs back while preserving the table', async () => {
    const xml = getDocumentXml(openOpc(await makeStyledDocx()));
    const out = applyParagraphRuns(xml, [
      { runs: [{ text: 'Hello ' }, { text: 'bold', bold: true }, { text: ' and ' }, { text: 'ital', italic: true }] },
      { runs: [{ text: 'BoldWord ital' }] },
    ]);
    expect(out).toContain('<w:tbl'); // table passes through verbatim
    const model = parseDocModel(out);
    expect(model.paragraphs[0].runs.map(r => r.text)).toEqual(['Hello ', 'bold', ' and ', 'ital']);
    expect(model.paragraphs[0].runs[1].bold).toBe(true);
    expect(model.paragraphs[0].runs[1].italic).toBeUndefined();
    expect(model.paragraphs[0].runs[3].italic).toBe(true);
    expect(model.paragraphs[0].runs[3].bold).toBeUndefined();
  });

  it('preserves an unmodeled run property (highlight) from the original first run', async () => {
    // w:color IS modeled now (Workstream A) → it round-trips through the model. Use a
    // still-unmodeled property (w:highlight) to guard the cloned-base-rPr pass-through.
    const doc = new Document({
      sections: [{ children: [new Paragraph({ children: [new TextRun({ text: 'X', highlight: 'green' })] })] }],
    });
    const xml = getDocumentXml(openOpc(new Uint8Array(await Packer.toBuffer(doc))));
    const out = applyParagraphRuns(xml, [{ runs: [{ text: 'edited', bold: true }] }]);
    expect(out).toContain('<w:highlight'); // unmodeled highlight cloned from base rPr survives
    const model = parseDocModel(out);
    expect(model.paragraphs[0].runs[0]).toMatchObject({ text: 'edited', bold: true });
  });

  it('round-trips a modeled font through parse → apply (font now lives in the model)', async () => {
    const doc = new Document({
      sections: [{ children: [new Paragraph({ children: [new TextRun({ text: 'X', font: 'Courier New' })] })] }],
    });
    const xml = getDocumentXml(openOpc(new Uint8Array(await Packer.toBuffer(doc))));
    const parsed = parseDocModel(xml);
    expect(parsed.paragraphs[0].runs[0].fontFamily).toBe('Courier New');
    const out = applyParagraphRuns(xml, parsed.paragraphs); // re-apply the parsed model
    expect(out).toContain('Courier New');
  });
});

describe('docModel ⇄ ProseMirror mapping', () => {
  it('round-trips text and bold/italic marks through a ProseMirror doc', () => {
    const paras = [
      { runs: [{ text: 'hello ' }, { text: 'bold', bold: true }] },
      { runs: [{ text: 'italic', italic: true }] },
    ];
    const model: DocModel = {
      blocks: paras,
      paragraphs: paras,
    };
    const back = docToDocModel(docModelToDoc(model));
    expect(back.paragraphs.map(paragraphText)).toEqual(['hello bold', 'italic']);
    expect(back.paragraphs[0].runs.find(r => r.text === 'bold')?.bold).toBe(true);
    expect(back.paragraphs[1].runs[0].italic).toBe(true);
  });

  it('represents an empty document as a single empty paragraph (valid PM doc)', () => {
    const doc = docModelToDoc({ blocks: [], paragraphs: [] });
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild?.type.name).toBe('paragraph');
  });
});

describe('mountDocxEditor — editable view + in-place save', () => {
  it('renders the document text into an editable view', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const h = mountDocxEditor(container, await makeStyledDocx());
    expect(h.view.dom.textContent).toContain('Plain');
    expect(h.view.dom.textContent).toContain('BoldWord');
    h.destroy();
  });

  it('save() with no edit round-trips and preserves the table', async () => {
    const container = document.createElement('div');
    const h = mountDocxEditor(container, await makeStyledDocx());
    const out = h.save();
    h.destroy();
    expect(getDocumentXml(openOpc(out))).toContain('<w:tbl');
    const reopened = parseDocx(out); // reads ALL paragraphs incl. table cells
    expect(reopened.paragraphs).toEqual(expect.arrayContaining(['Plain', 'BoldWord ital', 'Cell A']));
  });

  it('save() preserves per-run bold AND italic (no flatten to one run)', async () => {
    const container = document.createElement('div');
    const h = mountDocxEditor(container, await makeStyledDocx());
    const out = h.save(); // no edit
    h.destroy();
    const model = parseDocModel(getDocumentXml(openOpc(out)));
    const p = model.paragraphs.find(pp => paragraphText(pp) === 'BoldWord ital');
    expect(p?.runs.find(r => r.text.includes('BoldWord'))?.bold).toBe(true);
    expect(p?.runs.find(r => r.text.includes('ital'))?.italic).toBe(true);
    expect(getDocumentXml(openOpc(out))).toContain('<w:tbl');
  });

  it('save() reflects a programmatic edit and still preserves the table', async () => {
    const container = document.createElement('div');
    const h = mountDocxEditor(container, await makeStyledDocx());
    // Replace the first text node ("Plain") via a ProseMirror transaction.
    const from = 1; // inside the first paragraph, before "Plain"
    const to = from + 'Plain'.length;
    h.view.dispatch(h.view.state.tr.insertText('CHANGED', from, to));
    const out = h.save();
    h.destroy();
    const model = parseDocModel(getDocumentXml(openOpc(out)));
    expect(model.paragraphs.map(paragraphText)).toContain('CHANGED');
    expect(model.paragraphs.map(paragraphText)).not.toContain('Plain');
    expect(getDocumentXml(openOpc(out))).toContain('<w:tbl');
  });

  it('getModel() returns the current paragraphs+runs model', async () => {
    const container = document.createElement('div');
    const h = mountDocxEditor(container, await makeStyledDocx());
    const model = h.getModel();
    h.destroy();
    expect(model.paragraphs.length).toBeGreaterThan(0);
    expect(model.paragraphs.some(p => p.runs.some(r => r.text.length > 0))).toBe(true);
    expect(model.paragraphs.map(paragraphText)).toContain('Plain');
  });
});
