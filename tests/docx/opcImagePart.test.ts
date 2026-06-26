import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { openOpc } from '../../src/docx/opcEdit';
import { ensureImagePart, getPart } from '../../src/docx/opcParts';

const CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '</Types>';

const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';

function freshOpc() {
  return openOpc(
    zipSync({
      '[Content_Types].xml': strToU8(CT),
      '_rels/.rels': strToU8(RELS),
      'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'),
      'word/_rels/document.xml.rels': strToU8(RELS),
    }),
  );
}

// arbitrary bytes — ensureImagePart keys the extension off the mime, not the content
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);

describe('ensureImagePart', () => {
  it('writes word/media/image1.png, a png Default, an image Relationship, and returns its rId', () => {
    const opc = freshOpc();
    const { rId, target } = ensureImagePart(opc, PNG_BYTES, 'image/png');

    expect(opc.files['word/media/image1.png']).toEqual(PNG_BYTES);
    expect(target).toBe('media/image1.png');

    const ct = getPart(opc, '[Content_Types].xml') ?? '';
    expect(ct).toContain('Extension="png"');
    expect(ct).toContain('ContentType="image/png"');

    const rels = getPart(opc, 'word/_rels/document.xml.rels') ?? '';
    expect(rels).toContain(`Id="${rId}"`);
    expect(rels).toContain('Target="media/image1.png"');
    expect(rels).toContain('relationships/image');
    expect(rId).toMatch(/^rId\d+$/);
    expect(rId).not.toBe('rId1');
  });

  it('mints a fresh part + rId on a second call (jpeg → image2.jpg), png Default untouched', () => {
    const opc = freshOpc();
    const first = ensureImagePart(opc, PNG_BYTES, 'image/png');
    const second = ensureImagePart(opc, JPG_BYTES, 'image/jpeg');

    expect(opc.files['word/media/image2.jpg']).toEqual(JPG_BYTES);
    expect(second.target).toBe('media/image2.jpg');
    expect(second.rId).not.toBe(first.rId);

    const ct = getPart(opc, '[Content_Types].xml') ?? '';
    // png Default added once, jpg Default present (image/jpeg → .jpg), no duplicate png Default
    expect((ct.match(/Extension="png"/g) ?? []).length).toBe(1);
    expect(ct).toContain('Extension="jpg"');
    expect(ct).toContain('ContentType="image/jpeg"');
  });

  it('adds the Content-Types Default only once across two PNG inserts', () => {
    const opc = freshOpc();
    ensureImagePart(opc, PNG_BYTES, 'image/png');
    ensureImagePart(opc, PNG_BYTES, 'image/png');
    const ct = strFromU8(opc.files['[Content_Types].xml']);
    expect((ct.match(/Extension="png"/g) ?? []).length).toBe(1);
    expect(opc.files['word/media/image1.png']).toBeTruthy();
    expect(opc.files['word/media/image2.png']).toBeTruthy();
  });
});
