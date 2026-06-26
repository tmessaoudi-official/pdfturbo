import { describe, it, expect, vi } from 'vitest';
import { applyBlocks, buildDrawingParagraph, type DocBlock } from '../../src/docx/docModel';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// doc = [text "Hello", existing image (75pt = 952500 EMU, rId1)]
const DOC = `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">`
  + '<w:body>'
  + '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>'
  + '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/>'
  + '<a:graphic><a:graphicData uri="' + A + '/picture"><pic:pic><pic:blipFill>'
  + '<a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>'
  + '</wp:inline></w:drawing></w:r></w:p>'
  + '</w:body></w:document>';

const NEW_IMG_B64 = 'AQID'; // bytes [1,2,3]
function newImage(): DocBlock {
  return { kind: 'image', image: { dataB64: NEW_IMG_B64, mime: 'image/png', widthPt: 75, heightPt: 75 } };
}
function existingImage(): DocBlock {
  return { kind: 'image', image: { dataB64: '', mime: 'image/png', widthPt: 75, heightPt: 75 }, anchorId: 0 };
}
const textPara = (): DocBlock => ({ runs: [{ text: 'Hello' }] });

function parse(xml: string) {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

describe('buildDrawingParagraph', () => {
  it('emits a w:p with a w:drawing, wp:extent(cx,cy), and a:blip @r:embed', () => {
    const dom = parse('<w:document xmlns:w="' + W + '"><w:body/></w:document>');
    const p = buildDrawingParagraph(dom, 'rId9', 952500, 762000, 7);
    expect(p.tagName).toBe('w:p');
    expect(p.getElementsByTagName('w:drawing').length).toBe(1);
    const ext = p.getElementsByTagName('wp:extent')[0];
    expect(ext.getAttribute('cx')).toBe('952500');
    expect(ext.getAttribute('cy')).toBe('762000');
    const blip = p.getElementsByTagName('a:blip')[0];
    const embed = Array.from(blip.attributes).find(a => a.localName === 'embed');
    expect(embed?.value).toBe('rId9');
  });
});

describe('applyBlocks — new-image insert', () => {
  it('materializes a new image anchor BEFORE an existing one (no data loss)', () => {
    const mintImage = vi.fn(() => 'rId2');
    const blocks: DocBlock[] = [textPara(), newImage(), existingImage()];
    const out = applyBlocks(DOC, blocks, undefined, { editImages: true, mintImage });

    const dom = parse(out);
    const drawings = dom.getElementsByTagName('w:drawing');
    expect(drawings.length).toBe(2);            // existing preserved + new added
    expect(mintImage).toHaveBeenCalledTimes(1);

    // the new anchor (r:embed=rId2) comes BEFORE the existing one (r:embed=rId1)
    const blips = Array.from(dom.getElementsByTagName('a:blip'));
    const embeds = blips.map(b => Array.from(b.attributes).find(a => a.localName === 'embed')?.value);
    expect(embeds).toEqual(['rId2', 'rId1']);
  });

  it('materializes a new image anchor AFTER an existing one', () => {
    const mintImage = vi.fn(() => 'rId2');
    const blocks: DocBlock[] = [textPara(), existingImage(), newImage()];
    const out = applyBlocks(DOC, blocks, undefined, { editImages: true, mintImage });
    const dom = parse(out);
    expect(dom.getElementsByTagName('w:drawing').length).toBe(2);
    const blips = Array.from(dom.getElementsByTagName('a:blip'));
    const embeds = blips.map(b => Array.from(b.attributes).find(a => a.localName === 'embed')?.value);
    expect(embeds).toEqual(['rId1', 'rId2']);
  });

  it('is a no-op (no mint, drawing count unchanged) when no new image and no editImages', () => {
    const mintImage = vi.fn(() => 'rId2');
    const blocks: DocBlock[] = [textPara(), existingImage()];
    const out = applyBlocks(DOC, blocks); // no opts
    expect(parse(out).getElementsByTagName('w:drawing').length).toBe(1);
    expect(mintImage).not.toHaveBeenCalled();
  });
});
