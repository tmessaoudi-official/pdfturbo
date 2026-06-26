/**
 * Sub-project C Phase 2b — real-Chrome guard for image RESIZE + DELETE via the docx_image NodeView.
 *
 * jsdom (docModelImageEdit) covers the model/pre-pass; this exercises what jsdom can't: mounting the
 * real ProseMirror view so the NodeView renders handles, a pointer drag resizes the <img> (pixels),
 * and a save round-trips the wp:extent change / w:drawing removal.
 */
import { describe, it, expect } from 'vitest';
import { page } from '@vitest/browser/context';
import { zipSync, strToU8 } from 'fflate';
import { NodeSelection } from 'prosemirror-state';
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
const DOC_ONE_IMG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/>
      <a:graphic><a:graphicData><pic:pic><pic:spPr><a:xfrm><a:ext cx="952500" cy="952500"/></a:xfrm></pic:spPr>
      <pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>
    </wp:inline></w:drawing></w:r></w:p>
  </w:body></w:document>`;
const DOC_RELS_IMG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;
function makeDocxOneImage(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(DOC_ONE_IMG),
    'word/_rels/document.xml.rels': strToU8(DOC_RELS_IMG),
    'word/media/image1.png': b64ToBytes(PNG_B64),
  });
}

function imgPosOf(view: { state: { doc: { descendants: (f: (n: { type: { name: string } }, p: number) => void) => void } } }): number {
  let pos = -1;
  view.state.doc.descendants((n, p) => { if (n.type.name === 'docx_image') pos = p; });
  return pos;
}

describe('DOCX editor — image resize/delete (real browser)', () => {
  it('shows handles on select and resizes via a corner drag; save updates wp:extent', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocxOneImage());
    const view = handle.view;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPosOf(view))));

    const handleEl = container.querySelector('[data-docx-resize="se"]') as HTMLElement;
    expect(handleEl).not.toBeNull();
    const img = container.querySelector('img[data-docx-image]') as HTMLImageElement;
    const w0 = img.getBoundingClientRect().width;

    const r = handleEl.getBoundingClientRect();
    handleEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.x, clientY: r.y, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: r.x + 60, clientY: r.y + 60, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: r.x + 60, clientY: r.y + 60, bubbles: true }));

    const imgAfter = container.querySelector('img[data-docx-image]') as HTMLImageElement;
    expect(imgAfter.getBoundingClientRect().width).toBeGreaterThan(w0);
    const xml = getDocumentXml(openOpc(handle.save()));
    expect(xml).not.toContain('cx="952500"'); // extent changed
    await page.screenshot({ path: '../../qa-shots/c-phase2b/resize.png', element: container }).catch(() => {});
    handle.destroy();
    container.remove();
  });

  it('Shift drag resizes height independently (free aspect)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocxOneImage());
    const view = handle.view;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPosOf(view))));

    const handleEl = container.querySelector('[data-docx-resize="se"]') as HTMLElement;
    const img = container.querySelector('img[data-docx-image]') as HTMLImageElement;
    const b0 = img.getBoundingClientRect();
    const r = handleEl.getBoundingClientRect();
    handleEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.x, clientY: r.y, shiftKey: true, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: r.x, clientY: r.y + 50, shiftKey: true, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: r.x, clientY: r.y + 50, shiftKey: true, bubbles: true }));

    const b1 = (container.querySelector('img[data-docx-image]') as HTMLImageElement).getBoundingClientRect();
    expect(b1.height).toBeGreaterThan(b0.height);          // height grew
    expect(Math.abs(b1.width - b0.width)).toBeLessThan(2);  // width ~unchanged → aspect changed
    handle.destroy();
    container.remove();
  });

  it('deletes the image (Delete selection) → save drops the w:drawing', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocxOneImage());
    const view = handle.view;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPosOf(view))).deleteSelection());
    const xml = getDocumentXml(openOpc(handle.save()));
    expect(xml).not.toContain('w:drawing');
    handle.destroy();
    container.remove();
  });
});
