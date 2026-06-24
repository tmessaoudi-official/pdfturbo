import { describe, it, expect } from 'vitest';
import { extractDocImages } from '../../src/docx/docxImages';

// A 1×1 transparent PNG (base64) → bytes, for a realistic media part.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const RELS = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

const docWithImage = (blipRel = 'rId1') => `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Intro</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><wp:inline>
      <wp:extent cx="914400" cy="457200"/>
      <a:graphic><a:graphicData><pic:pic xmlns:pic="x">
        <pic:blipFill><a:blip r:embed="${blipRel}"/></pic:blipFill>
      </pic:pic></a:graphicData></a:graphic>
    </wp:inline></w:drawing></w:r></w:p>
  </w:body>
</w:document>`;

function filesWith(docXml: string, media?: Uint8Array): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {
    'word/document.xml': enc(docXml),
    'word/_rels/document.xml.rels': enc(RELS),
  };
  if (media) files['word/media/image1.png'] = media;
  return files;
}

describe('extractDocImages', () => {
  it('extracts one PNG image anchored at its block index with EMU→pt size', () => {
    const imgs = extractDocImages(filesWith(docWithImage(), b64ToBytes(PNG_B64)));
    expect(imgs.length).toBe(1);
    expect(imgs[0].mime).toBe('image/png');
    expect(imgs[0].blockIndex).toBe(1); // second top-level w:p
    expect(imgs[0].widthPt).toBeCloseTo(72, 1);  // 914400 EMU / 12700
    expect(imgs[0].heightPt).toBeCloseTo(36, 1); // 457200 / 12700
    expect(imgs[0].dataB64.length).toBeGreaterThan(0);
  });

  it('skips an image whose relationship is missing', () => {
    expect(extractDocImages(filesWith(docWithImage('rIdBOGUS'), b64ToBytes(PNG_B64)))).toEqual([]);
  });

  it('skips when the media bytes are absent', () => {
    expect(extractDocImages(filesWith(docWithImage()))).toEqual([]); // no media file
  });

  it('returns [] for a document with no drawings', () => {
    const plain = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>`;
    expect(extractDocImages({ 'word/document.xml': enc(plain) })).toEqual([]);
  });

  it('never throws on a malformed package', () => {
    expect(() => extractDocImages({})).not.toThrow();
    expect(extractDocImages({})).toEqual([]);
  });
});
