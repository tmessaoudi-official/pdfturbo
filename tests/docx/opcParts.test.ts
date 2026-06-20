/**
 * Phase 2 Slice A: multi-part OPC helpers — ensureHeadingStyles / ensureListNumbering /
 * buildNumberingMap (reuse-if-present, inject-if-missing, create-and-register-if-absent).
 * jsdom. Fixtures are hand-built minimal OPC packages for determinism.
 */
import { describe, it, expect } from 'vitest';
import { strToU8 } from 'fflate';
import {
  getPart,
  hasPart,
  ensureHeadingStyles,
  ensureListNumbering,
  buildNumberingMap,
} from '../../src/docx/opcParts';
import type { OpcPackage } from '../../src/docx/opcEdit';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const CT_BASE =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';
const DOC_RELS_EMPTY =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

function pkg(parts: Record<string, string>): OpcPackage {
  const files: Record<string, Uint8Array> = { 'word/document.xml': strToU8(`<w:document ${W}><w:body/></w:document>`) };
  for (const [k, v] of Object.entries(parts)) files[k] = strToU8(v);
  return { files };
}
function wellFormed(xml: string): boolean {
  return new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror').length === 0;
}

describe('opcParts — ensureHeadingStyles (Task 3)', () => {
  it('reuses existing Heading1–3 styleIds', () => {
    const styles = `<?xml version="1.0"?><w:styles ${W}>` +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>' +
      '</w:styles>';
    const opc = pkg({ 'word/styles.xml': styles });
    const ids = ensureHeadingStyles(opc);
    expect(ids).toEqual({ 1: 'Heading1', 2: 'Heading2', 3: 'Heading3' });
  });

  it('injects minimal styles for missing levels into an existing styles.xml', () => {
    const styles = `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
    const opc = pkg({ 'word/styles.xml': styles });
    const ids = ensureHeadingStyles(opc);
    const out = getPart(opc, 'word/styles.xml') ?? '';
    expect(wellFormed(out)).toBe(true);
    for (const lvl of [1, 2, 3] as const) {
      expect(out).toContain(`w:styleId="${ids[lvl]}"`);
    }
    // all three resolvable as paragraph styles with a heading name
    expect((out.match(/<w:style /g) ?? []).length).toBeGreaterThanOrEqual(4); // Normal + 3 headings
  });

  it('creates styles.xml and registers it when the part is absent', () => {
    const opc = pkg({ '[Content_Types].xml': CT_BASE, 'word/_rels/document.xml.rels': DOC_RELS_EMPTY });
    expect(hasPart(opc, 'word/styles.xml')).toBe(false);
    ensureHeadingStyles(opc);
    expect(hasPart(opc, 'word/styles.xml')).toBe(true);
    expect(wellFormed(getPart(opc, 'word/styles.xml') ?? '')).toBe(true);
    expect(getPart(opc, '[Content_Types].xml')).toContain('/word/styles.xml');
    expect(getPart(opc, 'word/_rels/document.xml.rels')).toContain('styles.xml');
    expect(getPart(opc, 'word/_rels/document.xml.rels')).toContain('relationships/styles');
  });
});

describe('opcParts — ensureListNumbering + buildNumberingMap (Task 4)', () => {
  const bulletAbs = `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/></w:lvl></w:abstractNum>`;
  const decAbs = `<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>`;

  it('reuses an existing bullet and decimal numId', () => {
    const numbering = `<?xml version="1.0"?><w:numbering ${W}>${bulletAbs}${decAbs}` +
      '<w:num w:numId="10"><w:abstractNumId w:val="1"/></w:num>' +
      '<w:num w:numId="20"><w:abstractNumId w:val="2"/></w:num>' +
      '</w:numbering>';
    const opc = pkg({ 'word/numbering.xml': numbering });
    const ids = ensureListNumbering(opc);
    expect(ids.bulletNumId).toBe(10);
    expect(ids.orderedNumId).toBe(20);
  });

  it('injects the missing (decimal) kind alongside an existing bullet', () => {
    const numbering = `<?xml version="1.0"?><w:numbering ${W}>${bulletAbs}<w:num w:numId="10"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
    const opc = pkg({ 'word/numbering.xml': numbering });
    const ids = ensureListNumbering(opc);
    expect(ids.bulletNumId).toBe(10);
    expect(ids.orderedNumId).not.toBe(10);
    const out = getPart(opc, 'word/numbering.xml') ?? '';
    expect(wellFormed(out)).toBe(true);
    // abstractNum must precede num in document order
    expect(out.lastIndexOf('<w:abstractNum ')).toBeLessThan(out.indexOf('<w:num '));
    expect(out).toContain('w:val="decimal"');
  });

  it('creates numbering.xml and registers it when absent', () => {
    const opc = pkg({ '[Content_Types].xml': CT_BASE, 'word/_rels/document.xml.rels': DOC_RELS_EMPTY });
    expect(hasPart(opc, 'word/numbering.xml')).toBe(false);
    const ids = ensureListNumbering(opc);
    expect(hasPart(opc, 'word/numbering.xml')).toBe(true);
    expect(ids.bulletNumId).not.toBe(ids.orderedNumId);
    expect(wellFormed(getPart(opc, 'word/numbering.xml') ?? '')).toBe(true);
    expect(getPart(opc, '[Content_Types].xml')).toContain('/word/numbering.xml');
    expect(getPart(opc, 'word/_rels/document.xml.rels')).toContain('relationships/numbering');
  });

  it('buildNumberingMap maps numId → bullet/decimal', () => {
    const numbering = `<?xml version="1.0"?><w:numbering ${W}>${bulletAbs}${decAbs}` +
      '<w:num w:numId="10"><w:abstractNumId w:val="1"/></w:num>' +
      '<w:num w:numId="20"><w:abstractNumId w:val="2"/></w:num>' +
      '</w:numbering>';
    const map = buildNumberingMap(pkg({ 'word/numbering.xml': numbering }));
    expect(map.get(10)).toBe('bullet');
    expect(map.get(20)).toBe('decimal');
  });

  it('buildNumberingMap is empty when there is no numbering part', () => {
    expect(buildNumberingMap(pkg({})).size).toBe(0);
  });
});
