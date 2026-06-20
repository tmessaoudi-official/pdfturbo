/**
 * Phase 0 spike evidence: prove the DOCX open→edit→save round-trip end-to-end,
 * fully client-side (jsdom), on a permissive stack (fflate MIT + docx MIT).
 * This is the go/no-go test for docs/plans/docx-editor.plan.md.
 */
import { describe, it, expect } from 'vitest';
import { parseDocx, buildDocx, editParagraph } from '../../src/docx/docxSpike';

describe('DOCX Phase 0 spike — round-trip', () => {
  it('jsdom provides DOMParser (client-side XML parsing is available)', () => {
    expect(typeof DOMParser).toBe('function');
  });

  it('build → parse recovers the original paragraph text', async () => {
    const bytes = await buildDocx({ paragraphs: ['Hello world', 'Second line', 'Troisième ligne — éàç'] });
    expect(bytes.length).toBeGreaterThan(0);
    const model = parseDocx(bytes);
    expect(model.paragraphs).toEqual(['Hello world', 'Second line', 'Troisième ligne — éàç']);
  });

  it('open → EDIT → save → re-open preserves the edit and the untouched paragraphs', async () => {
    const original = await buildDocx({ paragraphs: ['Keep me', 'Edit me', 'Keep me too'] });
    const model = parseDocx(original);

    const edited = editParagraph(model, 1, 'EDITED CONTENT');
    const rebuilt = await buildDocx(edited);

    const reopened = parseDocx(rebuilt);
    expect(reopened.paragraphs).toEqual(['Keep me', 'EDITED CONTENT', 'Keep me too']);
  });

  it('produces a structurally valid OPC zip (has the core OOXML parts)', async () => {
    const bytes = await buildDocx({ paragraphs: ['x'] });
    // A real .docx unzips and exposes word/document.xml; parseDocx throws otherwise.
    expect(() => parseDocx(bytes)).not.toThrow();
  });
});
