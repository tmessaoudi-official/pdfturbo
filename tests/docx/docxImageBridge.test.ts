import { describe, it, expect } from 'vitest';
import { docModelToDoc, docToDocModel } from '../../src/docx/docxProseMirror';
import { docxSchema } from '../../src/docx/docxSchema';
import { isDocImageBlock, type DocModel } from '../../src/docx/docModel';

describe('docx atom nodes', () => {
  it('exposes docx_image and docx_link atom nodes', () => {
    expect(docxSchema.nodes.docx_image).toBeDefined();
    expect(docxSchema.nodes.docx_image.spec.atom).toBe(true);
    expect(docxSchema.nodes.docx_link).toBeDefined();
    expect(docxSchema.nodes.docx_link.spec.atom).toBe(true);
  });
});

describe('image/link block <-> PM atom bridge', () => {
  it('round-trips an image block through PM as a docx_image atom', () => {
    const model: DocModel = {
      blocks: [{ kind: 'image', image: { dataB64: 'AAAA', mime: 'image/png', widthPt: 10, heightPt: 5 } }],
      paragraphs: [],
    };
    const doc = docModelToDoc(model);
    expect(doc.firstChild?.type.name).toBe('docx_image');
    const back = docToDocModel(doc);
    const b = back.blocks[0];
    expect(isDocImageBlock(b)).toBe(true);
    if (isDocImageBlock(b)) {
      expect(b.image?.dataB64).toBe('AAAA');
      expect(b.image?.widthPt).toBe(10);
    }
  });

  it('round-trips a link block as a docx_link atom', () => {
    const model: DocModel = { blocks: [{ kind: 'image', linkText: 'click here' }], paragraphs: [] };
    const doc = docModelToDoc(model);
    expect(doc.firstChild?.type.name).toBe('docx_link');
    const back = docToDocModel(doc);
    const b = back.blocks[0];
    expect(isDocImageBlock(b)).toBe(true);
    if (isDocImageBlock(b)) expect(b.linkText).toBe('click here');
  });
});
