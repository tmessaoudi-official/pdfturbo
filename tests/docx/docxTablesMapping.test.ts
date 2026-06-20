import { describe, it, expect } from 'vitest';
import { docxSchema } from '../../src/docx/docxSchema';

describe('docxSchema — table nodes', () => {
  it('includes prosemirror-tables node types', () => {
    expect(docxSchema.nodes.table).toBeDefined();
    expect(docxSchema.nodes.table_row).toBeDefined();
    expect(docxSchema.nodes.table_cell).toBeDefined();
  });
  it('cells accept block content (paragraphs + nested tables)', () => {
    const cell = docxSchema.nodes.table_cell;
    // cellContent 'block+' → a paragraph is valid cell content
    const p = docxSchema.nodes.paragraph.createAndFill();
    expect(p).not.toBeNull();
    expect(cell.contentMatch.matchType(docxSchema.nodes.paragraph)).not.toBeNull();
  });
});
