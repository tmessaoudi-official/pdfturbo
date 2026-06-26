/**
 * B sub-slice 4 — real-Chrome guard for image drag-to-reorder.
 * A drag of the image body past a table relocates the w:drawing after save; a sub-threshold click
 * does not move it; the drop-indicator line appears during a drag (eyes-on shot).
 */
import { describe, it, expect } from 'vitest';
import { page } from '@vitest/browser/context';
import { zipSync, strToU8 } from 'fflate';
import { mountDocxEditor } from '../../src/docx/docxProseMirror';
import { docxSchema } from '../../src/docx/docxSchema';
import { openOpc, getDocumentXml } from '../../src/docx/opcEdit';

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
function pointer(type: string, x: number, y: number): PointerEvent {
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }) as unknown as PointerEvent;
}
function countDrawings(xml: string): number { return xml.split('<w:drawing').length - 1; }

describe('DOCX editor — image drag-to-reorder (real browser)', () => {
  it('dragging the image below the table relocates the w:drawing on save', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const handle = mountDocxEditor(host, makeDocx());
    const img = host.querySelector('img[data-docx-image]') as HTMLImageElement;
    const r = img.getBoundingClientRect();
    const farBelow = host.getBoundingClientRect().bottom + 40; // past every block
    img.dispatchEvent(pointer('pointerdown', r.left + 5, r.top + 5));
    document.dispatchEvent(pointer('pointermove', r.left + 5, farBelow));
    await page.screenshot({ path: '../../qa-shots/b-drag/dragging.png', element: host }).catch(() => {});
    document.dispatchEvent(pointer('pointerup', r.left + 5, farBelow));
    const xml = getDocumentXml(openOpc(handle.save()));
    expect(countDrawings(xml)).toBe(1);
    expect(xml.indexOf('<w:drawing')).toBeGreaterThan(xml.indexOf('after')); // relocated last
    handle.destroy(); host.remove();
  });

  it('a sub-threshold click does NOT move the image', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const handle = mountDocxEditor(host, makeDocx());
    const xmlBefore = getDocumentXml(openOpc(handle.save()));
    const img = host.querySelector('img[data-docx-image]') as HTMLImageElement;
    const r = img.getBoundingClientRect();
    img.dispatchEvent(pointer('pointerdown', r.left + 5, r.top + 5));
    document.dispatchEvent(pointer('pointermove', r.left + 7, r.top + 6)); // < 5px
    document.dispatchEvent(pointer('pointerup', r.left + 7, r.top + 6));
    const xmlAfter = getDocumentXml(openOpc(handle.save()));
    expect(xmlAfter.indexOf('<w:drawing')).toBe(xmlBefore.indexOf('<w:drawing')); // unmoved
    handle.destroy(); host.remove();
  });

  it('shows the drop-indicator line + dims the image during a drag (eyes-on)', async () => {
    // Visible 120×80 image + two paragraphs so the dim + blue line are clearly in frame.
    const canvas = document.createElement('canvas');
    canvas.width = 120; canvas.height = 80;
    const cx = canvas.getContext('2d');
    if (cx === null) throw new Error('no 2d ctx');
    cx.fillStyle = '#2b6cb0'; cx.fillRect(0, 0, 120, 80);
    cx.fillStyle = '#fff'; cx.font = '20px sans-serif'; cx.fillText('IMG', 36, 46);
    const dataB64 = canvas.toDataURL('image/png').split(',')[1];

    const host = document.createElement('div'); document.body.appendChild(host);
    const handle = mountDocxEditor(host, makeDocx());
    const view = handle.view;
    // Swap the fixture's 1×1 image for the visible one.
    let pos = -1; view.state.doc.descendants((n, p) => { if (n.type.name === 'docx_image') pos = p; });
    const orig = view.state.doc.nodeAt(pos) as NonNullable<ReturnType<typeof view.state.doc.nodeAt>>;
    const big = docxSchema.nodes.docx_image.create({ dataB64, mime: 'image/png', widthPt: 90, heightPt: 60, anchorId: 0 });
    view.dispatch(view.state.tr.replaceWith(pos, pos + orig.nodeSize, big));

    const img = host.querySelector('img[data-docx-image]') as HTMLImageElement;
    const r = img.getBoundingClientRect();
    const afterEl = Array.from(host.querySelectorAll('p')).find(p => p.textContent === 'after');
    const dropY = afterEl ? afterEl.getBoundingClientRect().top : host.getBoundingClientRect().bottom;
    img.dispatchEvent(pointer('pointerdown', r.left + 5, r.top + 5));
    document.dispatchEvent(pointer('pointermove', r.left + 5, dropY)); // in-frame, before "after"
    expect(host.querySelector('.docx-image-dragging')).not.toBeNull();
    expect(document.querySelector('.docx-image-drop-line')).not.toBeNull();
    await page.screenshot({ path: '../../qa-shots/b-drag/drop-indicator.png', element: host }).catch(() => {});
    document.dispatchEvent(pointer('pointerup', r.left + 5, dropY));
    handle.destroy(); host.remove();
  });
});
