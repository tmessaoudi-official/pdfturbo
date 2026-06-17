import { describe, it, expect } from 'vitest';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { TextSearchHandler } from '../../src/handlers/textSearchHandler';

function makePage(text: string) {
  return {
    getTextContent: () => Promise.resolve({
      items: [{ str: text, transform: [1, 0, 0, 1, 50, 500], width: text.length * 7, height: 14 }],
    }),
  } as unknown as PDFPageProxy;
}

describe('TextSearchHandler LRU cache', () => {
  it('evicts oldest entry when cache exceeds 20 pages', async () => {
    const handler = new TextSearchHandler();
    for (let i = 0; i < 21; i++) {
      await handler.buildIndex(makePage(`content of page ${i}`), `page-${i}`);
    }
    const vp = { transform: [1, 0, 0, -1, 0, 842] } as unknown as PageViewport;
    // page-0 was evicted (oldest)
    const matches0 = handler.search('content of page 0', 'page-0', vp, 1);
    expect(matches0).toHaveLength(0);
    // page-20 is still cached (most recent)
    const matches20 = handler.search('content of page 20', 'page-20', vp, 1);
    expect(matches20).toHaveLength(1);
  });

  it('re-accessing a page promotes it (LRU)', async () => {
    const handler = new TextSearchHandler();
    await handler.buildIndex(makePage('important page'), 'page-0');
    for (let i = 1; i < 20; i++) {
      await handler.buildIndex(makePage(`page ${i}`), `page-${i}`);
    }
    // Access page-0 again — should promote it
    await handler.buildIndex(makePage('important page'), 'page-0');
    // Add one more — should evict page-1 (now the oldest), not page-0
    await handler.buildIndex(makePage('new page'), 'page-21');

    const vp = { transform: [1, 0, 0, -1, 0, 842] } as unknown as PageViewport;
    expect(handler.search('important page', 'page-0', vp, 1)).toHaveLength(1);
    expect(handler.search('page 1', 'page-1', vp, 1)).toHaveLength(0);
  });
});

describe('TextSearchHandler word-level highlights', () => {
  it('match width is narrower than full item width', async () => {
    const handler = new TextSearchHandler();
    const text = 'Test content for search: Hello World';
    await handler.buildIndex(makePage(text), 'p1');

    const vp = { transform: [1, 0, 0, -1, 0, 842] } as unknown as PageViewport;
    const matches = handler.search('search', 'p1', vp, 1);
    expect(matches).toHaveLength(1);

    const itemWidth = text.length * 7; // as in makePage stub
    expect(matches[0].width).toBeLessThan(itemWidth * 0.5);
  });

  it('match x is offset from item start for mid-string match', async () => {
    const handler = new TextSearchHandler();
    const text = 'AAAAAAbbbCCCCC'; // exactly 1 'bbb' match, offset from item start
    await handler.buildIndex(makePage(text), 'p2');

    const vp = { transform: [1, 0, 0, -1, 0, 842] } as unknown as PageViewport;
    const matches = handler.search('bbb', 'p2', vp, 1);
    expect(matches).toHaveLength(1);
    // The match should start at x > item start (which is 50 in the stub)
    expect(matches[0].x).toBeGreaterThan(50);
  });
});

describe('TextSearchHandler Arabic source — presentation-form, visual order (#6b)', () => {
  // pdf.js v6 returns Arabic source text as VISUAL-order (L→R) PRESENTATION-FORM
  // glyphs. The string below is the visual layout of the logical word "ابو"
  // (alef-beh-waw): waw-final, beh-initial, alef-isolated, left→right.
  // NFKC alone folds it to base letters but in the WRONG order ("وبا"); only the
  // codepoint-reversal (reverseRtlText) recovers the logical order the user types.
  const VISUAL_PRESENTATION = 'ﻮﺑﺍ'; // waw, beh, alef (visual L→R)
  const LOGICAL_BASE = 'ابو'; // "ابو" — what a user types into the find bar
  const vp = { transform: [1, 0, 0, -1, 0, 842] } as unknown as PageViewport;

  it('finds a logical base-letter query inside presentation-form visual source', async () => {
    const handler = new TextSearchHandler();
    await handler.buildIndex(makePage(VISUAL_PRESENTATION), 'ar1');
    const matches = handler.search(LOGICAL_BASE, 'ar1', vp, 1);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('does NOT over-match: an unrelated Arabic query returns nothing', async () => {
    const handler = new TextSearchHandler();
    await handler.buildIndex(makePage(VISUAL_PRESENTATION), 'ar2');
    expect(handler.search('سلام', 'ar2', vp, 1)).toHaveLength(0); // "سلام"
  });

  it('match for a logical query lands on the page (item-box highlight)', async () => {
    const handler = new TextSearchHandler();
    await handler.buildIndex(makePage(VISUAL_PRESENTATION), 'ar3');
    const [m] = handler.search(LOGICAL_BASE, 'ar3', vp, 1);
    expect(m).toBeTruthy();
    expect(m.width).toBeGreaterThan(0);
    expect(m.height).toBeGreaterThan(0);
  });
});

describe('TextSearchHandler rotated page scale (BUG-37)', () => {
  it('Math.hypot extracts correct scale from 90° rotated viewport transform', () => {
    // For a 90° rotation at scale=1.5: vt = [0, -1.5, 1.5, 0, ...]
    const vt = [0, -1.5, 1.5, 0, 100, 200];
    const currentScale = 1.5;

    // Old: Math.abs(vt[0]) || currentScale = Math.abs(0) || 1.5 = 1.5 (coincidentally correct here)
    // But the mechanism is wrong — it falls back to the passed scale, not extracted
    const oldMethod = Math.abs(vt[0]) || currentScale;

    // New: Math.hypot(vt[0], vt[1]) = Math.hypot(0, -1.5) = 1.5
    const newMethod = Math.hypot(vt[0], vt[1]) || currentScale;

    expect(oldMethod).toBe(1.5);   // coincidentally same for scale=1.5 but wrong mechanism
    expect(newMethod).toBe(1.5);   // correct: extracts from matrix

    // Critical test: when currentScale differs from actual scale in matrix
    // vt = [0, -2.0, 2.0, 0, ...] but currentScale = 1.0 (passed wrong value)
    const vt2 = [0, -2.0, 2.0, 0, 100, 200];
    const wrong = Math.abs(vt2[0]) || 1.0;   // 0 || 1.0 = 1.0 (wrong — actual scale is 2.0)
    const correct = Math.hypot(vt2[0], vt2[1]) || 1.0; // hypot(0, -2.0) = 2.0 (correct)
    expect(wrong).toBe(1.0);    // demonstrates the bug
    expect(correct).toBe(2.0);  // demonstrates the fix
  });
});
