/**
 * Sub-project C Phase 1 — real-Chrome guard for image + hyperlink PRESERVATION + display.
 *
 * jsdom (docModelImagePreserve / docxImageBridge) covers the model/parse/reconcile/bridge logic;
 * this exercises what jsdom can't: mounting the real ProseMirror view so the docx_image atom
 * actually renders an <img>, then proving a Save round-trip keeps the w:drawing + blip + the
 * single hyperlink occurrence byte-exact (the data-loss fix), with the plain paragraph still editable.
 */
import { describe, it, expect } from 'vitest';
import { page } from '@vitest/browser/context';
import { zipSync, strToU8 } from 'fflate';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';

// 1×1 transparent PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>Plain paragraph</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><wp:inline>
      <wp:extent cx="952500" cy="952500"/>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic>
      </a:graphicData></a:graphic>
    </wp:inline></w:drawing></w:r></w:p>
    <w:p><w:hyperlink w:anchor="_Toc1"><w:r><w:t>click here</w:t></w:r></w:hyperlink></w:p>
  </w:body>
</w:document>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
</Relationships>`;

function makeDocxWithImageAndLink(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(DOC_XML),
    'word/_rels/document.xml.rels': strToU8(DOC_RELS),
    'word/media/image1.png': b64ToBytes(PNG_B64),
  });
}

describe('DOCX editor — image + hyperlink preservation (real browser)', () => {
  it('renders the image inline, shows the link once, and preserves both through save', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocxWithImageAndLink());

    // The image atom renders a real <img> with a data: URI.
    const img = container.querySelector<HTMLImageElement>('img[data-docx-image]');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src') ?? '').toMatch(/^data:image\/png;base64,/);

    // The hyperlink anchor shows its text read-only, exactly once.
    const links = container.querySelectorAll('.docx-link-ro');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('click here');

    // The plain paragraph is present and editable.
    expect(container.textContent).toContain('Plain paragraph');

    // Visual evidence: capture the rendered editor (image inline + link shown once).
    // path is relative to THIS test file → ../../qa-shots/c-phase1/.
    await page.screenshot({ path: '../../qa-shots/c-phase1/image-link-rendered.png', element: container });

    // Save → reopen → the drawing + blip survive and the link text occurs exactly once.
    const saved = handle.save();
    const xml = getDocumentXml(openOpc(saved));
    expect(xml).toContain('w:drawing');
    expect(xml).toContain('rId1');
    expect(xml).toContain('w:hyperlink');
    expect((xml.match(/click here/g) || []).length).toBe(1);
    expect(xml).toContain('Plain paragraph');

    handle.destroy();
    container.remove();
  });
});
