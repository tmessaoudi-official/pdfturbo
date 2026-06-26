import { describe, it, expect, vi } from 'vitest';
import { applyBlocks, type DocBlock } from '../../src/docx/docModel';

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
function textP(text: string): string { return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`; }
function doc(body: string): string { return `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`; }
function parse(xml: string): Document { return new DOMParser().parseFromString(xml, 'application/xml'); }
function img(anchorId: number, widthPt = 75): DocBlock {
  return { kind: 'image', image: { dataB64: '', mime: 'image/png', widthPt, heightPt: widthPt }, anchorId };
}
const text = (t: string): DocBlock => ({ runs: [{ text: t }] });
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

describe('applyBlocks — image MOVE (full fidelity)', () => {
  it('moves an image DOWN past a paragraph, preserving the paragraph pPr (no rebuild)', () => {
    // [imgA(0), P-with-pPr] → model [P, imgA]
    const xml = doc(imgP('rId1') + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Hello</w:t></w:r></w:p>');
    const out = applyBlocks(xml, [text('Hello'), img(0)], undefined, { editImages: true });
    const d = parse(out);
    const kids = Array.from(d.getElementsByTagName('w:body')[0].children);
    expect(kids[0].getElementsByTagName('w:drawing').length).toBe(0); // first is the paragraph
    expect(kids[1].getElementsByTagName('w:drawing').length).toBe(1); // image moved after it
    expect(d.getElementsByTagName('w:jc').length).toBe(1);            // pPr SURVIVED (not rebuilt)
  });

  it('moves an image across a table (boundary order changes)', () => {
    // [imgA(0), table, P] → model [table, imgA, P]   (image crossed the table)
    const tableXml = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const xml = doc(imgP('rId1') + tableXml + textP('after'));
    const tbl: DocBlock = { kind: 'table', rows: [{ cells: [{ blocks: [text('c')] }] }] };
    const out = applyBlocks(xml, [tbl, img(0), text('after')], undefined, { editImages: true });
    const d = parse(out);
    const kids = Array.from(d.getElementsByTagName('w:body')[0].children);
    expect(kids[0].tagName).toBe('w:tbl');
    expect(kids[1].getElementsByTagName('w:drawing').length).toBe(1); // image now after the table
    expect(embeds(d)).toEqual(['rId1']);
  });

  it('swaps two images', () => {
    const xml = doc(imgP('rId1') + imgP('rId2'));
    const out = applyBlocks(xml, [img(1), img(0)], undefined, { editImages: true }); // reversed
    expect(embeds(parse(out))).toEqual(['rId2', 'rId1']);
  });

  it('move + a new-image insert in one save', () => {
    const mintImage = vi.fn(() => 'rIdNew');
    const xml = doc(imgP('rId1') + textP('x'));
    const newImg: DocBlock = { kind: 'image', image: { dataB64: 'AQID', mime: 'image/png', widthPt: 50, heightPt: 50 } };
    // model: [text, newImg, img(0)]  → existing image moved to end, new image before it
    const out = applyBlocks(xml, [text('x'), newImg, img(0)], undefined, { editImages: true, mintImage });
    expect(embeds(parse(out))).toEqual(['rIdNew', 'rId1']);
    expect(mintImage).toHaveBeenCalledTimes(1);
  });

  it('is byte-identical when no image moved/inserted/deleted', () => {
    const xml = doc(textP('a') + imgP('rId1') + textP('b'));
    const noEdit = applyBlocks(xml, [text('a'), img(0), text('b')]);                       // legacy path
    const sameOrder = applyBlocks(xml, [text('a'), img(0), text('b')], undefined, { editImages: true });
    expect(embeds(parse(sameOrder))).toEqual(['rId1']);
    expect(parse(sameOrder).getElementsByTagName('w:drawing').length).toBe(1);
    expect(noEdit).toContain('w:drawing'); // legacy path also preserves it
  });
});
