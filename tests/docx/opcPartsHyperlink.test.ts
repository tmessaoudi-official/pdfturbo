import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { openOpc } from '../../src/docx/opcEdit';
import { buildHyperlinkMap, ensureHyperlinkRel } from '../../src/docx/opcParts';

const RELS = (extra = '') => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
  ${extra}
</Relationships>`;

function opcWith(rels: string) {
  return openOpc(
    zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
      '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'),
      'word/_rels/document.xml.rels': strToU8(rels),
    }),
  );
}

describe('opcParts hyperlink rels', () => {
  it('buildHyperlinkMap returns external hyperlink rels (rId -> Target)', () => {
    const map = buildHyperlinkMap(opcWith(RELS()));
    expect(map.get('rId5')).toBe('https://example.com');
    expect(map.has('rId1')).toBe(false); // not a hyperlink rel
  });

  it('ensureHyperlinkRel reuses an existing External rel with the same Target', () => {
    const opc = opcWith(RELS());
    expect(ensureHyperlinkRel(opc, 'https://example.com')).toBe('rId5');
  });

  it('ensureHyperlinkRel creates a fresh relationship for a new URL', () => {
    const opc = opcWith(RELS());
    const id = ensureHyperlinkRel(opc, 'https://new.test');
    expect(id).toMatch(/^rId\d+$/);
    expect(id).not.toBe('rId5');
    // a second call for the same URL now reuses it
    expect(ensureHyperlinkRel(opc, 'https://new.test')).toBe(id);
    expect(buildHyperlinkMap(opc).get(id)).toBe('https://new.test');
  });
});
