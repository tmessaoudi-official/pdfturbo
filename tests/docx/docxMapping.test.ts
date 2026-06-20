/**
 * Phase 2 Slice A Task 6: DocModel ⇄ ProseMirror mapping for the rich-text props
 * (underline/font/size marks, heading nodes, nested bullet/ordered lists) + the
 * save() path that resolves heading/list ids and round-trips through the OPC. jsdom.
 */
import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { docModelToDoc, docToDocModel, mountDocxEditor } from '../../src/docx/docxProseMirror';
import { parseDocModel, type DocModel, type DocParagraph } from '../../src/docx/docModel';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';
import { buildNumberingMap } from '../../src/docx/opcParts';

const rt = (m: DocModel): DocModel => docToDocModel(docModelToDoc(m));

async function plainDocx(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun('Body')] }), new Paragraph({ children: [new TextRun('More')] })] }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

describe('mapping — run marks (Task 6)', () => {
  it('round-trips underline / fontFamily / fontSize marks', () => {
    const paras = [{ runs: [{ text: 'x', underline: true, fontFamily: 'Arial', fontSize: 14 }] }];
    const back = rt({ blocks: paras, paragraphs: paras });
    expect(back.paragraphs[0].runs[0]).toMatchObject({ text: 'x', underline: true, fontFamily: 'Arial', fontSize: 14 });
  });
});

describe('mapping — heading nodes (Task 6)', () => {
  it('round-trips a heading level', () => {
    const paras: DocParagraph[] = [{ runs: [{ text: 'Title' }], heading: 2 }, { runs: [{ text: 'body' }] }];
    const back = rt({ blocks: paras, paragraphs: paras });
    expect(back.paragraphs[0].heading).toBe(2);
    expect(back.paragraphs[1].heading).toBeUndefined();
  });
});

describe('mapping — lists (Task 6)', () => {
  it('groups consecutive same-ordered list paragraphs and round-trips ordered+level', () => {
    const paras: DocParagraph[] = [
      { runs: [{ text: 'a' }], list: { ordered: true, level: 0 } },
      { runs: [{ text: 'b' }], list: { ordered: true, level: 0 } },
    ];
    const doc = docModelToDoc({
      blocks: paras,
      paragraphs: paras,
    });
    // exactly one ordered_list with two items
    let ordered = 0;
    doc.forEach(n => { if (n.type.name === 'ordered_list') ordered++; });
    expect(ordered).toBe(1);
    const back = docToDocModel(doc);
    expect(back.paragraphs.map(p => p.list)).toEqual([
      { ordered: true, level: 0 },
      { ordered: true, level: 0 },
    ]);
  });

  it('round-trips a nested list level', () => {
    const paras: DocParagraph[] = [
      { runs: [{ text: 'top' }], list: { ordered: false, level: 0 } },
      { runs: [{ text: 'sub' }], list: { ordered: false, level: 1 } },
    ];
    const back = rt({
      blocks: paras,
      paragraphs: paras,
    });
    expect(back.paragraphs[0].list).toMatchObject({ level: 0 });
    expect(back.paragraphs[1].list).toMatchObject({ level: 1 });
  });

  it('splits a bullet run and an ordered run into separate list nodes', () => {
    const paras: DocParagraph[] = [
      { runs: [{ text: 'b1' }], list: { ordered: false, level: 0 } },
      { runs: [{ text: 'o1' }], list: { ordered: true, level: 0 } },
    ];
    const doc = docModelToDoc({
      blocks: paras,
      paragraphs: paras,
    });
    const names: string[] = [];
    doc.forEach(n => names.push(n.type.name));
    expect(names).toContain('bullet_list');
    expect(names).toContain('ordered_list');
  });
});

describe('mountDocxEditor — save resolves ids and round-trips heading+list (Task 6)', () => {
  it('bakes a heading and an ordered list into the document, preserving structure', async () => {
    const container = document.createElement('div');
    const h = mountDocxEditor(container, await plainDocx());
    // Replace the whole doc with a model carrying a heading + a 2-item ordered list.
    const paras: DocParagraph[] = [
      { runs: [{ text: 'Heading' }], heading: 1 },
      { runs: [{ text: 'first' }], list: { ordered: true, level: 0 } },
      { runs: [{ text: 'second' }], list: { ordered: true, level: 0 } },
    ];
    const newDoc = docModelToDoc({
      blocks: paras,
      paragraphs: paras,
    });
    h.view.dispatch(h.view.state.tr.replaceWith(0, h.view.state.doc.content.size, newDoc.content));
    const out = h.save();
    h.destroy();

    const opc = openOpc(out);
    const xml = getDocumentXml(opc);
    expect(xml).toContain('w:pStyle'); // heading style applied
    expect(xml).toContain('<w:numPr'); // list applied
    const model = parseDocModel(xml, buildNumberingMap(opc));
    expect(model.paragraphs.find(p => p.heading === 1)).toBeDefined();
    const listed = model.paragraphs.filter(p => p.list?.ordered);
    expect(listed.length).toBe(2);
  });

  it('save() with no heading/list applies no numPr and leaves numbering.xml untouched', async () => {
    const bytes = await plainDocx();
    const before = openOpc(bytes).files['word/numbering.xml']; // the writer bundles one
    const container = document.createElement('div');
    const h = mountDocxEditor(container, bytes);
    const out = h.save(); // no edit, no heading/list
    h.destroy();
    const opc = openOpc(out);
    expect(getDocumentXml(opc)).not.toContain('<w:numPr'); // no list applied
    // numbering part is unmodified (byte-identical pass-through)
    expect(Array.from(opc.files['word/numbering.xml'] ?? [])).toEqual(Array.from(before ?? []));
  });
});
