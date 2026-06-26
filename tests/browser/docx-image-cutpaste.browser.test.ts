/**
 * B sub-slice 3 — real-Chrome guard for image cut & paste.
 * Copy→paste must yield TWO w:drawing after save (proves the save did NOT bail to verbatim on a
 * duplicate anchorId — the whole bug this slice fixes). Cut→paste must yield exactly ONE, relocated.
 */
import { describe, it, expect } from 'vitest';
import { page } from '@vitest/browser/context';
import { zipSync, strToU8 } from 'fflate';
import { NodeSelection } from 'prosemirror-state';
import { Slice, Fragment } from 'prosemirror-model';
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
  + `<w:p><w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;
function makeDocx(): Uint8Array {
  return zipSync({ '[Content_Types].xml': strToU8(CT), '_rels/.rels': strToU8(ROOT), 'word/document.xml': strToU8(DOC), 'word/_rels/document.xml.rels': strToU8(DREL), 'word/media/image1.png': b64(PNG_B64) });
}
function imgPos(view: { state: { doc: { descendants: (f: (n: { type: { name: string } }, p: number) => void) => void } } }): number {
  let pos = -1; view.state.doc.descendants((n, p) => { if (n.type.name === 'docx_image') pos = p; }); return pos;
}
function countDrawings(xml: string): number { return xml.split('<w:drawing').length - 1; }

describe('DOCX editor — image cut & paste (real browser)', () => {
  it('copy→paste yields TWO drawings after save (no verbatim bail on dup anchorId)', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const handle = mountDocxEditor(host, makeDocx());
    const view = handle.view;
    const pos = imgPos(view);
    const node = view.state.doc.nodeAt(pos);
    expect(node).not.toBeNull();
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    // Simulate a paste of a COPY: PM would carry the same anchorId; transformPasted resets it to -1.
    const reset = view.someProp('transformPasted') as ((s: Slice) => Slice);
    const slice = reset(new Slice(Fragment.fromArray([node as NonNullable<typeof node>]), 0, 0));
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, slice.content));
    const xml = getDocumentXml(openOpc(handle.save()));
    expect(countDrawings(xml)).toBe(2);
    handle.destroy(); host.remove();
  });

  it('cut→paste keeps exactly ONE drawing, relocated after the text', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const handle = mountDocxEditor(host, makeDocx());
    const view = handle.view;
    const pos = imgPos(view);
    const node = view.state.doc.nodeAt(pos) as NonNullable<ReturnType<typeof view.state.doc.nodeAt>>;
    const reset = view.someProp('transformPasted') as ((s: Slice) => Slice);
    const slice = reset(new Slice(Fragment.fromArray([node]), 0, 0));
    // cut = delete the original, paste the transformed copy at the end (move via clipboard)
    let tr = view.state.tr.delete(pos, pos + node.nodeSize);
    tr = tr.insert(tr.doc.content.size, slice.content);
    view.dispatch(tr);
    const xml = getDocumentXml(openOpc(handle.save()));
    expect(countDrawings(xml)).toBe(1);
    expect(xml.indexOf('<w:drawing')).toBeGreaterThan(xml.indexOf('after')); // relocated after the text
    handle.destroy(); host.remove();
  });

  it('copy→paste duplicates the image inline (eyes-on before/after)', async () => {
    // A visible 120×80 colored PNG so the screenshots show a real image, not a 1×1 dot.
    const canvas = document.createElement('canvas');
    canvas.width = 120; canvas.height = 80;
    const cx = canvas.getContext('2d');
    if (cx === null) throw new Error('no 2d ctx');
    cx.fillStyle = '#2b6cb0'; cx.fillRect(0, 0, 120, 80);
    cx.fillStyle = '#ffffff'; cx.font = '20px sans-serif'; cx.fillText('IMG', 36, 46);
    const dataUrl = canvas.toDataURL('image/png');
    const dataB64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

    const host = document.createElement('div'); document.body.appendChild(host);
    const handle = mountDocxEditor(host, makeDocx());
    const view = handle.view;
    // Replace the fixture's 1×1 image with the visible one for a clear shot.
    const pos = imgPos(view);
    const orig = view.state.doc.nodeAt(pos) as NonNullable<ReturnType<typeof view.state.doc.nodeAt>>;
    const big = docxSchema.nodes.docx_image.create({ dataB64, mime: 'image/png', widthPt: 90, heightPt: 60, anchorId: 0 });
    view.dispatch(view.state.tr.replaceWith(pos, pos + orig.nodeSize, big));
    await page.screenshot({ path: '../../qa-shots/b-cutpaste/before-one-image.png', element: host }).catch(() => {});

    // Copy → paste: transformPasted resets anchorId, a second image appears inline.
    const node2 = view.state.doc.nodeAt(imgPos(view)) as NonNullable<ReturnType<typeof view.state.doc.nodeAt>>;
    const reset = view.someProp('transformPasted') as ((s: Slice) => Slice);
    const slice = reset(new Slice(Fragment.fromArray([node2]), 0, 0));
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, slice.content));
    await page.screenshot({ path: '../../qa-shots/b-cutpaste/after-two-images.png', element: host }).catch(() => {});

    expect(host.querySelectorAll('img[data-docx-image]').length).toBe(2);
    handle.destroy(); host.remove();
  });
});
