/**
 * Sprint 3 batch 2 — Gap 2: hyperlink extraction (Link annotation → DOCX/MD link).
 * Covers reconstructPage bbox-tagging of words that fall under a link rectangle.
 */
import { describe, it, expect } from 'vitest';
import { reconstructPage, type RawTextItem, type FontInfoMap, type FlowLinkRect } from '../../src/utils/flowDoc';

const FONTS: FontInfoMap = { f1: { name: 'Helvetica', family: 'sans-serif' } };
const PAGE_W = 600;
const PAGE_H = 800;

function mkItem(str: string, x: number, y: number, size = 12): RawTextItem {
  return {
    str,
    dir: 'ltr',
    transform: [size, 0, 0, size, x, y],
    width: str.length * size * 0.5,
    height: size,
    fontName: 'f1',
    hasEOL: false,
  };
}

describe('reconstructPage — hyperlink tagging (Gap 2)', () => {
  it('tags only the words whose centre falls inside a link rect', () => {
    // "Visit" centre ≈ x115 (outside), "site" centre ≈ x152 (inside the rect).
    const items = [mkItem('Visit', 100, 700), mkItem('site', 140, 700)];
    const links: FlowLinkRect[] = [{ url: 'https://example.com', x0: 138, y0: 695, x1: 175, y1: 715 }];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H, undefined, undefined, links);
    const runs = page.paragraphs.flatMap(p => p.runs);
    expect(runs.some(r => r.linkUrl === 'https://example.com' && r.text.includes('site'))).toBe(true);
    expect(runs.some(r => !r.linkUrl && r.text.includes('Visit'))).toBe(true);
  });

  it('does not merge a linked run with an adjacent plain run', () => {
    const items = [mkItem('Plain', 100, 700), mkItem('Linked', 140, 700)];
    const links: FlowLinkRect[] = [{ url: 'u', x0: 138, y0: 695, x1: 220, y1: 715 }];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H, undefined, undefined, links);
    const runs = page.paragraphs.flatMap(p => p.runs);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.find(r => r.text.includes('Linked'))?.linkUrl).toBe('u');
    expect(runs.find(r => r.text.includes('Plain'))?.linkUrl).toBeUndefined();
  });

  it('leaves all runs unlinked when no links are passed', () => {
    const page = reconstructPage([mkItem('Hello', 100, 700)], FONTS, PAGE_W, PAGE_H);
    expect(page.paragraphs.flatMap(p => p.runs).every(r => !r.linkUrl)).toBe(true);
  });
});
