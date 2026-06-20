import { describe, it, expect } from 'vitest';
import { parseDocModel, type DocTable, type DocParagraph } from '../../src/docx/docModel';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
function docXml(bodyInner: string): string {
  return `<?xml version="1.0"?><w:document ${W}><w:body>${bodyInner}</w:body></w:document>`;
}
const para = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('docModel — blocks (paragraph-only back-compat)', () => {
  it('populates blocks alongside paragraphs for a table-free doc', () => {
    const model = parseDocModel(docXml(para('A') + para('B')));
    // paragraphs unchanged (top-level)
    expect(model.paragraphs.map(p => p.runs[0].text)).toEqual(['A', 'B']);
    // blocks mirror paragraphs, all kind paragraph (no DocTable in this case)
    expect(model.blocks).toHaveLength(2);
    const isTable = (b: typeof model.blocks[0]): b is DocTable => (b as DocTable).kind === 'table';
    expect(model.blocks.every(b => !isTable(b))).toBe(true);
    expect((model.blocks[0] as DocParagraph).runs[0].text).toBe('A');
  });
});
