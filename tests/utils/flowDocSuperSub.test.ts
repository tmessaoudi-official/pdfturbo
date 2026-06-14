/**
 * Batch-3 (c) — super/subscript detection.
 *
 * Within a line, a glyph that is BOTH notably smaller than the line's body text
 * AND vertically offset from the body baseline is a super/subscript:
 *   raised (y-up, higher baseline) → superscript;  lowered → subscript.
 * Detected per-line (size ratio + baseline delta) and surfaced as
 * FlowRun.vertAlign so the DOCX writer can emit superScript/subScript.
 */
import { describe, it, expect } from 'vitest';
import { reconstructPage, type RawTextItem, type FontInfoMap } from '../../src/utils/flowDoc';

function mkItem(str: string, x: number, y: number, size = 12): RawTextItem {
  return {
    str, dir: 'ltr',
    transform: [size, 0, 0, size, x, y],
    width: str.length * size * 0.5, height: size,
    fontName: 'f1', hasEOL: false,
  } as RawTextItem;
}

const fonts: FontInfoMap = { f1: { name: 'Helvetica', loadedName: 'f1' } } as unknown as FontInfoMap;

function runsOf(items: RawTextItem[]) {
  const page = reconstructPage(items, fonts, 600, 800);
  return page.paragraphs.flatMap((p) => p.runs);
}

describe('reconstructPage — super/subscript', () => {
  it('flags a small raised glyph as superscript (E = mc²)', () => {
    // body "E=mc" size 12 baseline 700; the "2" size 7 raised to 705.
    const runs = runsOf([
      mkItem('E=mc', 50, 700, 12),
      mkItem('2', 95, 705, 7),
    ]);
    const sup = runs.find((r) => r.vertAlign === 'super');
    expect(sup?.text.trim()).toBe('2');
  });

  it('flags a small lowered glyph as subscript (H₂O)', () => {
    const runs = runsOf([
      mkItem('H', 50, 700, 12),
      mkItem('2', 60, 696, 7),
      mkItem('O', 68, 700, 12),
    ]);
    const sub = runs.find((r) => r.vertAlign === 'sub');
    expect(sub?.text.trim()).toBe('2');
  });

  it('does NOT flag uniform-size text', () => {
    const runs = runsOf([mkItem('normal text here', 50, 700, 12)]);
    expect(runs.every((r) => r.vertAlign === undefined)).toBe(true);
  });

  it('does NOT flag a small-but-baseline-aligned glyph (just small font)', () => {
    // smaller size but SAME baseline → not super/sub (e.g. a footnote-size word).
    const runs = runsOf([
      mkItem('BIG', 50, 700, 14),
      mkItem('small', 90, 700, 8),
    ]);
    expect(runs.every((r) => r.vertAlign === undefined)).toBe(true);
  });
});
