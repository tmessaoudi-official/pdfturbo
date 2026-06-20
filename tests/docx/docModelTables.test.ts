import { describe, it, expect } from 'vitest';
import { parseDocModel, isDocTable, type DocTable, type DocParagraph } from '../../src/docx/docModel';

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
    expect(model.blocks.every(b => !isDocTable(b))).toBe(true);
    expect((model.blocks[0] as DocParagraph).runs[0].text).toBe('A');
  });
});

const cell = (text: string): string => `<w:tc><w:tcPr/><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const row = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
const table = (...rows: string[]): string => `<w:tbl><w:tblPr/><w:tblGrid/>${rows.join('')}</w:tbl>`;

describe('docModel — table parsing', () => {
  it('parses a top-level table into a DocTable block in document order', () => {
    const xml = docXml(para('intro') + table(row(cell('A1'), cell('B1')), row(cell('A2'), cell('B2'))) + para('outro'));
    const model = parseDocModel(xml);
    // blocks: paragraph, table, paragraph
    expect(model.blocks.map(b => (b.kind === 'table' ? 'T' : 'P'))).toEqual(['P', 'T', 'P']);
    // paragraphs field excludes cell paragraphs
    expect(model.paragraphs.map(p => p.runs[0].text)).toEqual(['intro', 'outro']);
    const t = model.blocks[1] as DocTable;
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].cells).toHaveLength(2);
    const cellPara = t.rows[0].cells[0].blocks[0] as DocParagraph;
    expect(cellPara.runs[0].text).toBe('A1');
  });
});
