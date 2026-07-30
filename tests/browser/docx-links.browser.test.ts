/**
 * Sub-project C Phase 2a — real-Chrome guard for EDITABLE external hyperlinks.
 *
 * jsdom (docModelLinks / opcPartsHyperlink / docxToolbar) covers the model/parse/save/rels/UI;
 * this exercises the real ProseMirror view: an external link renders as editable linked text,
 * an internal-anchor link stays read-only, and a save round-trips the w:hyperlink + rels.
 */
import { describe, it, expect } from 'vitest';
import { page } from 'vitest/browser';
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { TextSelection } from 'prosemirror-state';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
const DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>plain text</w:t></w:r></w:p>
    <w:p><w:r><w:t>see </w:t></w:r><w:hyperlink r:id="rId7"><w:r><w:t>the site</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:hyperlink w:anchor="_Toc1"><w:r><w:t>jump to top</w:t></w:r></w:hyperlink></w:p>
  </w:body>
</w:document>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
</Relationships>`;

function makeDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(DOC_XML),
    'word/_rels/document.xml.rels': strToU8(DOC_RELS),
  });
}
function relsOf(bytes: Uint8Array): string {
  return strFromU8(openOpc(bytes).files['word/_rels/document.xml.rels']);
}

describe('DOCX editor — editable external hyperlinks (real browser)', () => {
  it('renders an external link as editable linked text and round-trips it on save', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocx());

    // External link → an editable <a href> (the link mark), NOT the read-only atom.
    const a = container.querySelector<HTMLAnchorElement>('.ProseMirror a[href]');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.textContent).toBe('the site');

    // Internal-anchor link stays read-only (the opaque atom).
    expect(container.querySelectorAll('.docx-link-ro')).toHaveLength(1);

    // Save → external w:hyperlink round-trips (one occurrence, correct rId→Target); internal preserved.
    const xml = getDocumentXml(openOpc(handle.save()));
    expect((xml.match(/<w:hyperlink/g) || []).length).toBe(2); // external + internal-anchor
    expect(xml).toContain('the site');
    expect((xml.match(/the site/g) || []).length).toBe(1); // no duplication
    expect(xml).toContain('w:anchor="_Toc1"');
    expect(relsOf(handle.save())).toContain('https://example.com');

    handle.destroy();
    container.remove();
  });

  it('adds a link to plain text via the toolbar and creates a relationship on save', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocx());
    const view = handle.view;
    const toolbar = handle.toolbarDom as HTMLElement;
    document.body.appendChild(toolbar);

    // Select the first paragraph's "plain text" (positions 1..11).
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 11)));
    const linkBtn = toolbar.querySelector<HTMLButtonElement>('[data-act="link"]');
    const input = toolbar.querySelector<HTMLInputElement>('[data-act="linkInput"]');
    if (!linkBtn || !input) throw new Error('link controls missing');
    linkBtn.click();
    input.value = 'https://added.test';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const saved = handle.save();
    const xml = getDocumentXml(openOpc(saved));
    expect(xml).toContain('plain text');
    expect((xml.match(/<w:hyperlink/g) || []).length).toBe(3); // the new one + the 2 originals
    expect(relsOf(saved)).toContain('https://added.test');

    await page.screenshot({ path: '../../qa-shots/c-phase2a/links.png', element: container }).catch(() => {});
    handle.destroy();
    container.remove();
    toolbar.remove();
  });
});
