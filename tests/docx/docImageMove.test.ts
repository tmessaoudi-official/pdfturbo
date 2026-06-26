import { describe, it, expect } from 'vitest';
import { applyBlocks } from '../../src/docx/docModel';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS = `xmlns:w="${W}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" `
  + `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" `
  + `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" `
  + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
function imgP(rId: string, cx = 952500): string {
  return `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cx}"/>`
    + `<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:ext cx="${cx}" cy="${cx}"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic>`
    + `</wp:inline></w:drawing></w:r></w:p>`;
}
function doc(body: string): string { return `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`; }
function parse(xml: string): Document { return new DOMParser().parseFromString(xml, 'application/xml'); }
function embeds(d: Document): (string | undefined)[] {
  return Array.from(d.getElementsByTagName('a:blip')).map(b => Array.from(b.attributes).find(a => a.localName === 'embed')?.value);
}

describe('reconcileImageAnchors — map-keyed (regression)', () => {
  it('deletes the dropped image and resizes the survivor by anchorId', () => {
    const xml = doc(imgP('rId1') + imgP('rId2'));
    // model dropped anchorId 0, kept anchorId 1 resized to 150pt (1905000 EMU)
    const out = applyBlocks(xml, [{ kind: 'image', image: { dataB64: '', mime: 'image/png', widthPt: 150, heightPt: 150 }, anchorId: 1 }], undefined, { editImages: true });
    const d = parse(out);
    expect(embeds(d)).toEqual(['rId2']);                 // rId1 removed
    expect(d.getElementsByTagName('wp:extent')[0].getAttribute('cx')).toBe('1905000'); // resized
  });
});
