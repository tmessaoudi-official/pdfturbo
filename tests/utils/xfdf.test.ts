/**
 * XFDF codec (#57). Pure string ↔ annotation-record round-trip. Records are in
 * PDF default user space (points, y-up, origin bottom-left) — the export/import
 * wiring does the display↔PDF coordinate flip; the codec only serialises.
 */
import { describe, it, expect } from 'vitest';
import { buildXfdf, parseXfdf, type XfdfAnnot } from '../../src/utils/xfdf';

const SAMPLE: XfdfAnnot[] = [
  { type: 'highlight', page: 0, rect: [72, 700, 272, 720], color: '#FFFF00', opacity: 0.4 },
  { type: 'text', page: 0, rect: [300, 650, 320, 670], color: '#FFFDE7', contents: 'A sticky note' },
  { type: 'freetext', page: 1, rect: [50, 100, 250, 140], color: '#000000', contents: 'Free text\nline 2', fontSize: 14 },
];

// G21: shape subtypes. square/circle use rect; line carries start/end; ink carries gesture paths.
const SHAPES: XfdfAnnot[] = [
  { type: 'square', page: 0, rect: [10, 20, 110, 70], color: '#ef4444', width: 2 },
  { type: 'circle', page: 1, rect: [40, 50, 240, 150], color: '#22c55e', width: 3 },
  { type: 'line', page: 0, rect: [10, 20, 110, 70], color: '#3b82f6', width: 1.5, line: [10, 20, 110, 70] },
  { type: 'ink', page: 2, rect: [0, 0, 100, 100], color: '#000000', width: 2, inkList: [[5, 5, 50, 80, 95, 10]] },
];

describe('XFDF codec (#57)', () => {
  it('builds well-formed XFDF with the Adobe namespace and an <annots> block', () => {
    const xml = buildXfdf(SAMPLE);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('xmlns="http://ns.adobe.com/xfdf/"');
    expect(xml).toContain('<annots>');
    expect(xml).toContain('<highlight ');
    expect(xml).toContain('<text ');
    expect(xml).toContain('<freetext ');
    // page is 0-based; rect is comma-joined PDF user-space coords
    expect(xml).toContain('page="0"');
    expect(xml).toContain('rect="72,700,272,720"');
  });

  it('round-trips every supported annotation type without loss', () => {
    const out = parseXfdf(buildXfdf(SAMPLE));
    expect(out).toEqual(SAMPLE);
  });

  it('escapes XML metacharacters in contents and round-trips them', () => {
    const tricky: XfdfAnnot[] = [
      { type: 'text', page: 0, rect: [0, 0, 10, 10], color: '#FFFFFF', contents: 'a < b & c > "d" \'e\'' },
    ];
    const out = parseXfdf(buildXfdf(tricky));
    expect(out[0].contents).toBe('a < b & c > "d" \'e\'');
  });

  it('ignores unknown annotation subtypes (forward-compatible)', () => {
    // polygon/polyline/stamp remain a documented #57b ceiling — never mapped.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xfdf xmlns="http://ns.adobe.com/xfdf/"><annots>
  <highlight page="0" rect="1,2,3,4" color="#FF0000"/>
  <polygon page="0" rect="0,0,5,5" color="#00FF00"/>
  <stamp page="0" rect="0,0,9,9"/>
</annots></xfdf>`;
    const out = parseXfdf(xml);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('highlight');
    expect(out[0].color).toBe('#FF0000');
  });

  it('returns an empty array for malformed or annots-free XFDF', () => {
    expect(parseXfdf('not xml at all <<<')).toEqual([]);
    expect(parseXfdf('<?xml version="1.0"?><xfdf xmlns="http://ns.adobe.com/xfdf/"/>')).toEqual([]);
  });
});

describe('XFDF codec — shape subtypes (G21)', () => {
  it('serialises square/circle/line/ink with their geometry attributes', () => {
    const xml = buildXfdf(SHAPES);
    expect(xml).toContain('<square ');
    expect(xml).toContain('<circle ');
    expect(xml).toContain('<line ');
    expect(xml).toContain('<ink ');
    // square/circle carry rect; line carries start/end; ink carries a <gesture>
    expect(xml).toContain('rect="10,20,110,70"');
    expect(xml).toContain('start="10,20"');
    expect(xml).toContain('end="110,70"');
    expect(xml).toContain('<gesture>5,5;50,80;95,10</gesture>');
    // stroke width rides the `width` attribute
    expect(xml).toContain('width="3"');
  });

  it('round-trips square/circle/line/ink without loss', () => {
    const out = parseXfdf(buildXfdf(SHAPES));
    expect(out).toEqual(SHAPES);
  });
});
