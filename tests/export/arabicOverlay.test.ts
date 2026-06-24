import { describe, it, expect } from 'vitest';
import { PDFName, type PDFOperator } from '@cantoo/pdf-lib';
import { buildArabicRunOps, effectiveArabicWidth } from '../../src/export/arabicOverlay';

const KEY = PDFName.of('F1');
const COLOR = { r: 0, g: 0, b: 0 };
// PDFOperator.name is private; the operator token is the trailing word of its serialized form
// (e.g. "1 0 0 1 10 20 Tm" → "Tm", "<0041> Tj" → "Tj", "q" → "q").
const opNames = (ops: PDFOperator[]) => ops.map((o) => o.toString().trim().split(/\s+/).pop() ?? '');

describe('buildArabicRunOps', () => {
  it('emits the plain CID sequence (byte-identical to the prior emission) when no style is set', () => {
    const ops = buildArabicRunOps(KEY, '00410042', 10, 20, 14, COLOR);
    // q BT rg Tf Tm Tj ET Q — no stroke/Tc/Tz
    expect(opNames(ops)).toEqual(['q', 'BT', 'rg', 'Tf', 'Tm', 'Tj', 'ET', 'Q']);
  });

  it('adds stroke operators (RG, w, Tr) when strokeWidth > 0', () => {
    const ops = buildArabicRunOps(KEY, '0041', 10, 20, 14, COLOR, { strokeWidth: 1.5 });
    const names = opNames(ops);
    expect(names).toContain('RG'); // stroke colour (= fill)
    expect(names).toContain('w');  // line width
    expect(names).toContain('Tr'); // render mode (FillAndOutline)
  });

  it('adds Tc when charSpacing is non-zero', () => {
    expect(opNames(buildArabicRunOps(KEY, '0041', 10, 20, 14, COLOR, { charSpacing: 2 }))).toContain('Tc');
    expect(opNames(buildArabicRunOps(KEY, '0041', 10, 20, 14, COLOR, { charSpacing: 0 }))).not.toContain('Tc');
  });

  it('adds Tz when horizontalScale != 100', () => {
    expect(opNames(buildArabicRunOps(KEY, '0041', 10, 20, 14, COLOR, { horizontalScale: 150 }))).toContain('Tz');
    expect(opNames(buildArabicRunOps(KEY, '0041', 10, 20, 14, COLOR, { horizontalScale: 100 }))).not.toContain('Tz');
  });
});

describe('effectiveArabicWidth', () => {
  it('returns the base width with no adjustments', () => {
    expect(effectiveArabicWidth(100, 5)).toBe(100);
  });
  it('adds charSpacing across (glyphCount - 1) gaps', () => {
    expect(effectiveArabicWidth(100, 5, 2)).toBe(108); // 100 + 2*4
  });
  it('scales by horizontalScale percent', () => {
    expect(effectiveArabicWidth(100, 5, 0, 150)).toBe(150);
  });
  it('combines charSpacing then horizontal scale', () => {
    expect(effectiveArabicWidth(100, 5, 2, 50)).toBe(54); // (100 + 8) * 0.5
  });
  it('never applies negative gaps for a single glyph', () => {
    expect(effectiveArabicWidth(20, 1, 5)).toBe(20);
  });
});
