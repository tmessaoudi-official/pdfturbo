/**
 * Sub-project B sub-slice 2 — real-Chrome guard for image MOVE/reorder.
 *
 * jsdom (docImageMove, docxImageMove) covers the engine + command. This exercises the real editor:
 * select an image, move it past a table via the command, and confirm the move round-trips through the
 * in-place save (w:drawing relocated after the w:tbl). Plus an eyes-on screenshot of the ▲/▼ controls.
 */
import { describe, it, expect } from 'vitest';
import { page } from 'vitest/browser';
import { zipSync, strToU8 } from 'fflate';
import { NodeSelection } from 'prosemirror-state';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';
import { moveImage } from '../../src/docx/docxImageMove';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function b64(b: string): Uint8Array { const s = atob(b); const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
const CT = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const ROOT = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DREL = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`;
const DOC = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>`
  + `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><a:graphic><a:graphicData><pic:pic><pic:spPr><a:xfrm><a:ext cx="952500" cy="952500"/></a:xfrm></pic:spPr><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  + `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
  + `<w:p><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;
function makeDocx(): Uint8Array {
  return zipSync({ '[Content_Types].xml': strToU8(CT), '_rels/.rels': strToU8(ROOT), 'word/document.xml': strToU8(DOC), 'word/_rels/document.xml.rels': strToU8(DREL), 'word/media/image1.png': b64(PNG_B64) });
}
function imgPos(view: { state: { doc: { descendants: (f: (n: { type: { name: string } }, p: number) => void) => void } } }): number {
  let pos = -1; view.state.doc.descendants((n, p) => { if (n.type.name === 'docx_image') pos = p; }); return pos;
}

describe('DOCX editor — image move (real browser)', () => {
  it('moves an image past a table and the move round-trips through save', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocx());
    const view = handle.view;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPos(view))));
    expect(moveImage(1)(view.state, view.dispatch.bind(view))).toBe(true); // move down past the table
    const xml = getDocumentXml(openOpc(handle.save()));
    const drawingIdx = xml.indexOf('w:drawing');
    const tblIdx = xml.indexOf('<w:tbl');
    expect(drawingIdx).toBeGreaterThan(tblIdx); // image now AFTER the table
    handle.destroy();
    container.remove();
  });

  it('shows ▲/▼ on the selected image (eyes-on)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountDocxEditor(container, makeDocx());
    const view = handle.view;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPos(view))));
    expect(container.querySelector('.docx-image-move.up')).not.toBeNull();
    await page.screenshot({ path: '../../qa-shots/b-move/move-controls.png', element: container }).catch(() => {});
    handle.destroy();
    container.remove();
  });
});
