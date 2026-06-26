import { describe, it, expect } from 'vitest';
import { parseDocModel, isDocImageBlock } from '../../src/docx/docModel';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const NS = `${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const drawing = () =>
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="952500" cy="952500"/></wp:inline></w:drawing></w:r></w:p>`;
const doc = (body: string): string => `<w:document ${NS}><w:body>${body}</w:body></w:document>`;

describe('C2 anchorId stamping', () => {
  it('numbers top-level drawing anchors 0..n in order; hyperlink anchors get none', () => {
    const xml = doc(
      `<w:p><w:r><w:t>text</w:t></w:r></w:p>` +
      drawing() +
      `<w:p><w:hyperlink w:anchor="_Toc1"><w:r><w:t>jump</w:t></w:r></w:hyperlink></w:p>` +
      drawing(),
    );
    const m = parseDocModel(xml);
    const imgs = m.blocks.filter(isDocImageBlock);
    expect(imgs.map(b => b.anchorId)).toEqual([0, undefined, 1]); // drawing, hyperlink, drawing
  });
});
