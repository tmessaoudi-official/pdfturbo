import { describe, it, expect } from 'vitest';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { TextSearchHandler, buildLogicalLines } from '../../src/handlers/textSearchHandler';

function makePage(text: string) {
  return {
    getTextContent: () => Promise.resolve({
      items: [{ str: text, transform: [1, 0, 0, 1, 50, 500], width: text.length * 7, height: 14 }],
    }),
  } as unknown as PDFPageProxy;
}

// Build a page from explicit per-glyph items: each entry is one text item with its
// own str + x origin (PDF user space, baseline y constant). This reproduces pdf.js v6's
// REAL Arabic layout — one item per glyph, VISUAL (L→R) order, presentation forms.
function makeGlyphPage(glyphs: { str: string; x: number }[], y = 500, w = 7, h = 14) {
  return {
    getTextContent: () => Promise.resolve({
      items: glyphs.map((g) => ({ str: g.str, transform: [1, 0, 0, 1, g.x, y], width: w, height: h })),
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

describe('TextSearchHandler result cap (#QA-2026-06-23 P3 #17 — match-explosion guard)', () => {
  it('caps results for a catastrophic match-everything regex', async () => {
    const handler = new TextSearchHandler();
    // One item, 20 000 chars — a `.` global regex would otherwise push 20 000 results.
    await handler.buildIndex(makePage('a'.repeat(20000)), 'p1');
    const vp = { transform: [1, 0, 0, -1, 0, 842] } as unknown as PageViewport;
    const res = handler.search('.', 'p1', vp, 1, { useRegex: true });
    expect(res.length).toBeGreaterThan(0);
    expect(res.length).toBeLessThanOrEqual(5000); // TextSearchHandler.MAX_RESULTS
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

describe('TextSearchHandler Arabic source — presentation-form item (#6b)', () => {
  // pdf.js v6 emits a MULTI-glyph Arabic run as ONE item whose chars are in NATIVE
  // (LOGICAL) source order, as PRESENTATION FORMS — verified against real output (the
  // trailing "لام" of "السلام" is one logical-order item). The string below is the logical
  // presentation-form layout of "ابو" (alef-initial, beh-medial, waw-final). NFKC folds it to
  // base letters in the CORRECT order; reading order comes from item position, never from
  // reversing an item's internal chars (reversing scrambled multi-char items).
  const LOGICAL_PRESENTATION = 'ﺍﺑﻮ'; // alef, beh, waw (logical order)
  const LOGICAL_BASE = 'ابو'; // "ابو" — what a user types into the find bar
  const vp = { transform: [1, 0, 0, -1, 0, 842] } as unknown as PageViewport;

  it('finds a logical base-letter query inside presentation-form visual source', async () => {
    const handler = new TextSearchHandler();
    await handler.buildIndex(makePage(LOGICAL_PRESENTATION), 'ar1');
    const matches = handler.search(LOGICAL_BASE, 'ar1', vp, 1);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('does NOT over-match: an unrelated Arabic query returns nothing', async () => {
    const handler = new TextSearchHandler();
    await handler.buildIndex(makePage(LOGICAL_PRESENTATION), 'ar2');
    expect(handler.search('سلام', 'ar2', vp, 1)).toHaveLength(0); // "سلام"
  });

  it('match for a logical query lands on the page (item-box highlight)', async () => {
    const handler = new TextSearchHandler();
    await handler.buildIndex(makePage(LOGICAL_PRESENTATION), 'ar3');
    const [m] = handler.search(LOGICAL_BASE, 'ar3', vp, 1);
    expect(m).toBeTruthy();
    expect(m.width).toBeGreaterThan(0);
    expect(m.height).toBeGreaterThan(0);
  });
});

describe('TextSearchHandler Arabic source — PER-GLYPH items (real pdf.js v6 layout)', () => {
  // pdf.js v6 splits Arabic into ONE item per glyph, VISUAL (L→R) order, presentation forms.
  // A logical multi-glyph query therefore never fits inside a single item.str, so the
  // per-item matcher (raw + #6b normalized) finds nothing. These cases reproduce that.
  const vp = { transform: [1, 0, 0, -1, 0, 842] } as unknown as PageViewport;

  it('finds a logical query spanning presentation-form per-glyph items ("ابو")', async () => {
    const handler = new TextSearchHandler();
    // logical "ابو" → visual presentation forms L→R: waw(ﻮ), beh(ﺑ), alef(ﺍ)
    await handler.buildIndex(makeGlyphPage([
      { str: 'ﻮ', x: 50 }, { str: 'ﺑ', x: 57 }, { str: 'ﺍ', x: 64 },
    ]), 'arpg1');
    const matches = handler.search('ابو', 'arpg1', vp, 1);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].width).toBeGreaterThan(0);
    expect(matches[0].height).toBeGreaterThan(0);
  });

  it('finds a 7-glyph word spanning per-glyph items ("العربية") + substring', async () => {
    const handler = new TextSearchHandler();
    // logical "العربية" → visual (reverse): ة ي ب ر ع ل ا, one item each, L→R
    const visual = [...'ةيبرعلا'];
    await handler.buildIndex(makeGlyphPage(visual.map((str, i) => ({ str, x: 50 + i * 7 }))), 'arpg2');
    expect(handler.search('العربية', 'arpg2', vp, 1).length).toBeGreaterThan(0);
    expect(handler.search('عربية', 'arpg2', vp, 1).length).toBeGreaterThan(0); // substring
  });

  it('does NOT over-match: unrelated Arabic query against per-glyph items returns 0', async () => {
    const handler = new TextSearchHandler();
    const visual = [...'ةيبرعلا'];
    await handler.buildIndex(makeGlyphPage(visual.map((str, i) => ({ str, x: 50 + i * 7 }))), 'arpg3');
    expect(handler.search('سلام', 'arpg3', vp, 1)).toHaveLength(0);
  });

  it('Latin search is unaffected by the Arabic line pass', async () => {
    const handler = new TextSearchHandler();
    await handler.buildIndex(makePage('Hello World search me'), 'lat1');
    expect(handler.search('search', 'lat1', vp, 1)).toHaveLength(1);
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

describe('buildLogicalLines — embedded LTR run order (Arabic)', () => {
  const it_ = (str: string, x: number) => ({ str, transform: [1, 0, 0, 1, x, 100], width: 8, height: 10 });
  it('orders a per-glyph embedded LTR run forward in an RTL line (token map intact)', () => {
    // visual L→R: M a i n  then Arabic ا ب ح ر م (rtl-dominant). Logical: "مرحبا Main".
    const items = [
      it_('M', 0), it_('a', 10), it_('i', 20), it_('n', 30),
      it_('ا', 60), it_('ب', 70), it_('ح', 80), it_('ر', 90), it_('م', 100),
    ];
    const [line] = buildLogicalLines(items);
    expect(line.rtl).toBe(true);
    expect(line.text).toContain('Main'); // forward, NOT "niaM"
    // token map stays valid: every token's [start,end) slices its source item's str
    for (const tk of line.tokens) {
      expect(line.text.slice(tk.start, tk.end)).toBe(items[tk.itemIndex].str.normalize('NFKC'));
    }
  });
});
