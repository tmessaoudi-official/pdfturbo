import { describe, it, expect } from 'vitest';
import {
  isDocImageBlock,
  isDocTable,
  parseDocModel,
  applyBlocks,
  type DocBlock,
} from '../../src/docx/docModel';

const NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:wp="http://wp" xmlns:a="http://a" xmlns:r="http://r"`;
const doc = (body: string): string =>
  `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`;

describe('DocImageBlock model', () => {
  it('narrows image blocks and is disjoint from tables/paragraphs', () => {
    const img: DocBlock = { kind: 'image', linkText: 'x' };
    const tbl: DocBlock = { kind: 'table', rows: [] };
    const para: DocBlock = { runs: [{ text: 'hi' }] };
    expect(isDocImageBlock(img)).toBe(true);
    expect(isDocImageBlock(tbl)).toBe(false);
    expect(isDocImageBlock(para)).toBe(false);
    expect(isDocTable(img)).toBe(false);
  });
});

describe('anchor detection in parse', () => {
  it('parses an image paragraph as a DocImageBlock (not a text paragraph)', () => {
    const m = parseDocModel(
      doc(
        `<w:p><w:r><w:t>before</w:t></w:r></w:p>` +
          `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/><a:blip r:embed="rId1"/></wp:inline></w:drawing></w:r></w:p>`,
      ),
    );
    expect(m.blocks).toHaveLength(2);
    expect(isDocImageBlock(m.blocks[1])).toBe(true);
    expect(m.paragraphs).toHaveLength(1); // image block excluded from the paragraphs view
  });

  it('parses a hyperlink paragraph as a DocImageBlock carrying its link text', () => {
    const m = parseDocModel(doc(`<w:p><w:hyperlink r:id="rId9"><w:r><w:t>click here</w:t></w:r></w:hyperlink></w:p>`));
    expect(m.blocks).toHaveLength(1);
    const b = m.blocks[0];
    expect(isDocImageBlock(b)).toBe(true);
    if (isDocImageBlock(b)) expect(b.linkText).toBe('click here');
  });
});

describe('reconciler preservation (the P0 fix)', () => {
  it('preserves a w:drawing through save (no destruction)', () => {
    const xml = doc(
      `<w:p><w:r><w:t>x</w:t></w:r></w:p>` +
        `<w:p><w:r><w:drawing><wp:inline><a:blip r:embed="rId1"/></wp:inline></w:drawing></w:r></w:p>`,
    );
    const saved = applyBlocks(xml, parseDocModel(xml).blocks);
    expect(saved).toContain('drawing');
    expect(saved).toContain('rId1');
  });

  it('does not duplicate hyperlink text on save', () => {
    const xml = doc(`<w:p><w:hyperlink r:id="rId9"><w:r><w:t>click here</w:t></w:r></w:hyperlink></w:p>`);
    const saved = applyBlocks(xml, parseDocModel(xml).blocks);
    expect(saved).toContain('w:hyperlink');
    expect((saved.match(/click here/g) || []).length).toBe(1);
  });

  it('is byte-identical for a doc with no drawing/hyperlink (no regression)', () => {
    const xml = doc(
      `<w:p><w:r><w:t>hello</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>`,
    );
    const before = applyBlocks(xml, parseDocModel(xml).blocks);
    expect(applyBlocks(xml, parseDocModel(xml).blocks)).toBe(before);
    expect(before).not.toContain('drawing');
  });
});
