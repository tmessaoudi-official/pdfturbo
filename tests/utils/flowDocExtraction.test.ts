/**
 * Sprint 2 Workstream B — extraction-side detection tests.
 * B-2: page margins from text bbox (with outlier clamp).
 * B-5: justify alignment + first-line/left indent detection in reconstructPage.
 */
import { describe, it, expect } from 'vitest';
import { reconstructPage, type RawTextItem, type FontInfoMap, type FlowParagraph, type PageMargins } from '../../src/utils/flowDoc';

const FONTS: FontInfoMap = {
  f1: { name: 'Helvetica', family: 'sans-serif' },
};

function mkItem(str: string, x: number, y: number, opts: Partial<RawTextItem> = {}): RawTextItem {
  const size = opts.height ?? 12;
  // width default ~ char count * size * 0.5 unless overridden
  return {
    str,
    dir: 'ltr',
    transform: [size, 0, 0, size, x, y],
    width: opts.width ?? str.length * size * 0.5,
    height: size,
    fontName: 'f1',
    hasEOL: false,
    ...opts,
  };
}

const PAGE_W = 612;
const PAGE_H = 792;

function requireMargins(m: PageMargins | undefined): PageMargins {
  expect(m).toBeDefined();
  return m ?? { top: 0, right: 0, bottom: 0, left: 0 };
}

// ── B-2: page margins from text bounding box ───────────────────────────────────

describe('B-2 — reconstructPage computes page.margins from text bbox', () => {
  it('derives margins (top/left/right/bottom, PDF points) from the text block inset', () => {
    // Text block occupies x in [72, 540], baselines at y=700 (top) and y=100 (bottom).
    // width chosen so right edge = 540: from x=72, width=468.
    const page = reconstructPage(
      [
        mkItem('Top line of body text', 72, 700, { width: 468 }),
        mkItem('Bottom line of body text', 72, 100, { width: 468 }),
      ],
      FONTS, PAGE_W, PAGE_H
    );
    const m = requireMargins(page.margins);
    // left = minX = 72
    expect(m.left).toBeGreaterThanOrEqual(60);
    expect(m.left).toBeLessThanOrEqual(84);
    // right = pageW - maxX = 612 - 540 = 72
    expect(m.right).toBeGreaterThanOrEqual(60);
    expect(m.right).toBeLessThanOrEqual(84);
    // top = pageH - topY. topY ≈ baseline(700)+size(12) = 712 → top ≈ 80
    expect(m.top).toBeGreaterThanOrEqual(60);
    expect(m.top).toBeLessThanOrEqual(100);
    // bottom = bottomBaseline(100) ≈ 100
    expect(m.bottom).toBeGreaterThanOrEqual(80);
    expect(m.bottom).toBeLessThanOrEqual(120);
  });

  it('clamps so an outlier line (running head at the extreme edge) does not yield a negative/over-tight margin', () => {
    // Main body block inset at x>=100; one outlier item starts at x=2 (a margin glyph).
    const page = reconstructPage(
      [
        mkItem('x', 2, 780, { width: 6 }), // outlier near the very top-left corner
        mkItem('Main body line one here', 100, 600, { width: 400 }),
        mkItem('Main body line two here', 100, 580, { width: 400 }),
        mkItem('Main body line three here', 100, 560, { width: 400 }),
      ],
      FONTS, PAGE_W, PAGE_H
    );
    const m = requireMargins(page.margins);
    // Never negative.
    expect(m.left).toBeGreaterThanOrEqual(0);
    expect(m.top).toBeGreaterThanOrEqual(0);
    expect(m.right).toBeGreaterThanOrEqual(0);
    expect(m.bottom).toBeGreaterThanOrEqual(0);
    // The outlier at x=2 must NOT drag the left margin to ~2pt; robust margin reflects body block (~100pt).
    expect(m.left).toBeGreaterThan(40);
  });
});

// ── B-5: justify + indent detection ────────────────────────────────────────────

function findPara(page: { paragraphs: FlowParagraph[] }, pred: (p: FlowParagraph) => boolean): FlowParagraph {
  const found = page.paragraphs.find(pred);
  expect(found).toBeDefined();
  return found ?? { runs: [], heading: 0, alignment: 'left', rtl: false };
}

describe('B-5 — reconstructPage detects justified paragraphs and indentation', () => {
  it('marks a multi-line block flush at both left and right edges as justify', () => {
    // Three lines, all starting at x=72, all ending at x=520 (flush both edges).
    // Deliberately NOT centered on the page (center 296 ≠ page center 306 only by
    // ~10pt would read as centered) — choose a left-biased block.
    const left = 72, right = 520, w = right - left;
    const page = reconstructPage(
      [
        mkItem('Line one flush both edges', left, 600, { width: w }),
        mkItem('Line two flush both edges', left, 585, { width: w }),
        mkItem('Line three flush both edge', left, 570, { width: w }),
      ],
      FONTS, PAGE_W, PAGE_H
    );
    const justified = page.paragraphs.find(p => p.alignment === 'justify');
    expect(justified).toBeDefined();
  });

  it('detects a first-line indent (firstLine > 0) when the first line is inset from the column left', () => {
    // First line indented to x=130, following lines at x=100. Right edges vary (not justified).
    const page = reconstructPage(
      [
        mkItem('Indented first line of para', 130, 600, { width: 300 }),
        mkItem('Continuation line two body', 100, 585, { width: 360 }),
        mkItem('Continuation line three end', 100, 570, { width: 280 }),
      ],
      FONTS, PAGE_W, PAGE_H
    );
    const indented = findPara(page, p => (p.indentFirstLine ?? 0) > 0);
    expect(indented.indentFirstLine ?? 0).toBeGreaterThan(10);
  });

  it('detects a block left indent (indentLeft > 0) when the whole block is inset from the column left', () => {
    // A short body paragraph at the column-left to establish the column baseline,
    // then an indented block where ALL lines start at x=160.
    const page = reconstructPage(
      [
        mkItem('Normal body paragraph at column left edge here', 72, 700, { width: 460 }),
        // Indented block: all lines start at x=160, ragged right (not centered, not justified).
        mkItem('Indented block line one is fairly long here', 160, 600, { width: 380 }),
        mkItem('Indented short', 160, 585, { width: 90 }),
      ],
      FONTS, PAGE_W, PAGE_H
    );
    const indented = findPara(page, p => (p.indentLeft ?? 0) > 0);
    expect(indented.indentLeft ?? 0).toBeGreaterThan(40);
  });
});
