import { describe, it, expect } from 'vitest';
import { parseDocModel, applyBlocks, isDocImageBlock, type DocApplyIds, type DocBlock } from '../../src/docx/docModel';

const NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://r"`;
const doc = (body: string): string =>
  `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`;
const linkMap = new Map([['rId9', 'https://example.com']]);

describe('C3 parse — external hyperlinks become editable linkUrl runs', () => {
  it('attributes linkUrl to the runs inside an external w:hyperlink (paragraph not opaque)', () => {
    const m = parseDocModel(
      doc(`<w:p><w:r><w:t>see </w:t></w:r><w:hyperlink r:id="rId9"><w:r><w:t>here</w:t></w:r></w:hyperlink></w:p>`),
      undefined,
      linkMap,
    );
    expect(isDocImageBlock(m.blocks[0])).toBe(false);
    const p = m.paragraphs[0];
    expect(p.runs.map(rn => rn.text)).toEqual(['see ', 'here']);
    expect(p.runs[0].linkUrl).toBeUndefined();
    expect(p.runs[1].linkUrl).toBe('https://example.com');
  });

  it('keeps an internal-anchor-only hyperlink paragraph opaque (preserved, read-only)', () => {
    const m = parseDocModel(doc(`<w:p><w:hyperlink w:anchor="_Toc1"><w:r><w:t>jump</w:t></w:r></w:hyperlink></w:p>`));
    expect(isDocImageBlock(m.blocks[0])).toBe(true);
  });
});

describe('C3 save — group linkUrl runs into a single w:hyperlink', () => {
  it('groups consecutive same-linkUrl runs into one w:hyperlink with the rId', () => {
    const xml = doc(`<w:p><w:r><w:t>x</w:t></w:r></w:p>`);
    const blocks: DocBlock[] = [
      { runs: [{ text: 'a' }, { text: 'b', linkUrl: 'https://e.com' }, { text: 'c', linkUrl: 'https://e.com' }] },
    ];
    const ids: DocApplyIds = {
      heading: { 1: 'Heading1', 2: 'Heading2', 3: 'Heading3' },
      bulletNumId: 0,
      orderedNumId: 0,
      links: new Map([['https://e.com', 'rId7']]),
    };
    const saved = applyBlocks(xml, blocks, ids);
    expect((saved.match(/<w:hyperlink/g) || []).length).toBe(1);
    expect(saved).toContain('rId7');
    expect(saved).toContain('>b<');
    expect(saved).toContain('>c<');
    expect(saved).toContain('>a<');
  });

  it('is byte-identical when no run has a linkUrl (no-link control)', () => {
    const xml = doc(`<w:p><w:r><w:t>hello</w:t></w:r></w:p>`);
    const before = applyBlocks(xml, parseDocModel(xml).blocks);
    expect(applyBlocks(xml, parseDocModel(xml).blocks)).toBe(before);
    expect(before).not.toContain('w:hyperlink');
  });
});
