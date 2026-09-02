import { describe, it, expect } from 'vitest';
import {
  reconstructPage,
  translateItemsToCropOrigin,
  assignHeadings,
  extractPsName,
  detectColumnSplit,
  detectListPrefix,
  type RawTextItem,
  type FontInfoMap,
  type FlowDoc,
} from '../../src/utils/flowDoc';
import { flowDocToMarkdown } from '../../src/utils/flowDocWriters';

const FONTS: FontInfoMap = {
  f1: { name: 'Helvetica', family: 'sans-serif' },
  fb: { name: 'Arial-BoldMT', family: 'sans-serif' },
  fi: { name: 'Times-Italic', family: 'serif' },
};

function mkItem(str: string, x: number, y: number, opts: Partial<RawTextItem> = {}): RawTextItem {
  const size = opts.height ?? 12;
  return {
    str,
    dir: 'ltr',
    transform: [size, 0, 0, size, x, y],
    width: str.length * size * 0.5,
    height: size,
    fontName: 'f1',
    hasEOL: false,
    ...opts,
  };
}

const PAGE_W = 612;
const PAGE_H = 792;

describe('reconstructPage — line grouping', () => {
  it('joins same-baseline items into one line with a space across a gap', () => {
    // 'Hello' at x=50 (width 30, ends at 80), 'world' at x=85 → gap 5pt > threshold
    const page = reconstructPage(
      [mkItem('Hello', 50, 700), mkItem('world', 85, 700)],
      FONTS, PAGE_W, PAGE_H
    );
    expect(page.paragraphs).toHaveLength(1);
    expect(page.paragraphs[0].runs.map(r => r.text).join('')).toBe('Hello world');
  });

  it('joins adjacent items without inserting a space', () => {
    // 'Hel' ends at 50+18=68; 'lo' starts exactly at 68 → no gap → no space
    const page = reconstructPage(
      [mkItem('Hel', 50, 700), mkItem('lo', 68, 700)],
      FONTS, PAGE_W, PAGE_H
    );
    expect(page.paragraphs[0].runs.map(r => r.text).join('')).toBe('Hello');
  });

  it('emits lines in reading order even when items arrive out of order', () => {
    const page = reconstructPage(
      [mkItem('second line of text here', 50, 660), mkItem('First line of text here.', 50, 674)],
      FONTS, PAGE_W, PAGE_H
    );
    const text = page.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n');
    expect(text.indexOf('First')).toBeLessThan(text.indexOf('second'));
  });
});

describe('reconstructPage — paragraph segmentation', () => {
  it('keeps normally-leaded lines in one paragraph and splits on a large gap', () => {
    // 14pt leading (12pt font) → same paragraph; 36pt gap → new paragraph
    const page = reconstructPage(
      [
        mkItem('Para one line one with some words.', 50, 700),
        mkItem('Para one line two with some words.', 50, 686),
        mkItem('Para two starts after a large gap.', 50, 650),
      ],
      FONTS, PAGE_W, PAGE_H
    );
    expect(page.paragraphs).toHaveLength(2);
  });
});

describe('reconstructPage — styles', () => {
  it('detects bold and italic from the real font name', () => {
    const page = reconstructPage(
      [
        mkItem('Bold', 50, 700, { fontName: 'fb' }),
        mkItem('Italic', 90, 700, { fontName: 'fi' }),
      ],
      FONTS, PAGE_W, PAGE_H
    );
    const runs = page.paragraphs[0].runs;
    const bold = runs.find(r => r.text.includes('Bold'));
    const italic = runs.find(r => r.text.includes('Italic'));
    expect(bold?.bold).toBe(true);
    expect(bold?.italic).toBe(false);
    expect(italic?.italic).toBe(true);
    expect(italic?.fontFamily).toBe('serif');
  });

  it('flags RTL runs and paragraphs', () => {
    const page = reconstructPage(
      [mkItem('مرحبا بالعالم', 300, 700, { dir: 'rtl' })],
      FONTS, PAGE_W, PAGE_H
    );
    expect(page.paragraphs[0].runs[0].rtl).toBe(true);
    expect(page.paragraphs[0].rtl).toBe(true);
  });
});

describe('reconstructPage — alignment', () => {
  it('detects a centered line', () => {
    // text from 250 → 250+110=360, center 305 ≈ page center 306
    const page = reconstructPage(
      [mkItem('Centered headline here', 250, 700, { width: 110 })],
      FONTS, PAGE_W, PAGE_H
    );
    expect(page.paragraphs[0].alignment).toBe('center');
  });

  it('defaults to left alignment for body text', () => {
    const page = reconstructPage(
      [mkItem('Plain left-margin body text line.', 50, 700)],
      FONTS, PAGE_W, PAGE_H
    );
    expect(page.paragraphs[0].alignment).toBe('left');
  });
});

describe('assignHeadings — document-wide font-size clustering', () => {
  it('marks the dominant size as body and larger sizes as headings', () => {
    const body = (s: string, y: number) => mkItem(s, 50, y);
    const page = reconstructPage(
      [
        mkItem('Document Title', 50, 740, { height: 24, transform: [24, 0, 0, 24, 50, 740] }),
        body('Body paragraph one with plenty of words to dominate.', 700),
        body('Body paragraph two with plenty of words to dominate.', 660),
        body('Body paragraph three with plenty of words to dominate.', 620),
      ],
      FONTS, PAGE_W, PAGE_H
    );
    const doc: FlowDoc = { pages: [page] };
    assignHeadings(doc);
    const [title, ...rest] = doc.pages[0].paragraphs;
    expect(title.heading).toBe(1);
    for (const p of rest) expect(p.heading).toBe(0);
  });

  it('assigns up to six heading levels for six distinct larger sizes (H1–H6)', () => {
    const hsize = (s: number, str: string, y: number) =>
      mkItem(str, 50, y, { height: s, transform: [s, 0, 0, s, 50, y] });
    const bodyLine = (y: number) =>
      mkItem('Body text with plenty of words to dominate the weighted size.', 50, y, {
        height: 10, transform: [10, 0, 0, 10, 50, y],
      });
    const page = reconstructPage(
      [
        hsize(30, 'HOne', 740),
        hsize(24, 'HTwo', 700),
        hsize(20, 'HThree', 660),
        hsize(17, 'HFour', 620),
        hsize(14, 'HFive', 580),
        hsize(12, 'HSix', 540),
        bodyLine(500), bodyLine(470), bodyLine(440), bodyLine(410),
      ],
      FONTS, PAGE_W, PAGE_H
    );
    const doc: FlowDoc = { pages: [page] };
    assignHeadings(doc);
    const lvl = (t: string) =>
      doc.pages[0].paragraphs.find(p => p.runs.some(r => r.text.includes(t)))?.heading;
    expect(lvl('HOne')).toBe(1);
    expect(lvl('HTwo')).toBe(2);
    expect(lvl('HThree')).toBe(3);
    expect(lvl('HFour')).toBe(4);
    expect(lvl('HFive')).toBe(5);
    expect(lvl('HSix')).toBe(6);
  });
});

describe('assignHeadings — bold/all-caps body-size promotion (G11)', () => {
  // All fixtures share a 12pt non-bold body so the weighted bodySize is 12 and
  // the candidate lines below sit AT body size (so the size pass leaves them 0).
  const bodyLine = (str: string, y: number) => mkItem(str, 50, y);
  const lvlOf = (doc: FlowDoc, t: string) =>
    doc.pages[0].paragraphs.find(p => p.runs.some(r => r.text.includes(t)))?.heading;

  it('promotes an ALL-CAPS short body-size line (a) and a fully-bold short body-size line (b); leaves a long bold para (c), a normal body line (d), and keeps a larger size heading at its level (e)', () => {
    const page = reconstructPage(
      [
        // (e) real larger-size heading (18pt > 12 * 1.15) → size pass gives H1
        mkItem('Larger Size Heading', 50, 760, { height: 18, transform: [18, 0, 0, 18, 50, 760] }),
        // (a) ALL-CAPS short body-size line → promoted
        bodyLine('EXECUTIVE SUMMARY', 730),
        // (b) fully-bold short body-size line (Arial-BoldMT) → promoted
        mkItem('Introduction Heading', 50, 700, { fontName: 'fb' }),
        // (c) long fully-bold body-size paragraph (>8 words) → NOT promoted
        mkItem(
          'This is a long bold sentence that runs well beyond eight words so it is body text.',
          50, 670, { fontName: 'fb' },
        ),
        // (d) + body weight: several plain mixed-case body lines dominate the size map
        bodyLine('Plain body paragraph with plenty of words to dominate the weighted size map.', 640),
        bodyLine('Another plain body paragraph with plenty of words to dominate the size map.', 610),
        bodyLine('A third plain body paragraph with plenty of words to keep body dominant here.', 580),
      ],
      FONTS, PAGE_W, PAGE_H
    );
    const doc: FlowDoc = { pages: [page] };
    assignHeadings(doc);
    // (e) larger size keeps its size-derived H1
    expect(lvlOf(doc, 'Larger Size Heading')).toBe(1);
    // (a) all-caps promoted to the level BELOW the size headings (1 size heading → H2)
    expect(lvlOf(doc, 'EXECUTIVE SUMMARY')).toBe(2);
    // (b) fully-bold promoted to the same below-size level
    expect(lvlOf(doc, 'Introduction Heading')).toBe(2);
    // (c) long bold paragraph stays body
    expect(lvlOf(doc, 'long bold sentence')).toBe(0);
    // (d) normal body line stays body
    expect(lvlOf(doc, 'Plain body paragraph')).toBe(0);
  });

  it('defaults promotions to H3 when there are no size-based headings', () => {
    const page = reconstructPage(
      [
        bodyLine('OVERVIEW', 740), // all-caps short body-size → promoted, no size headings → H3
        bodyLine('Plain body paragraph with plenty of words to dominate the weighted size map.', 700),
        bodyLine('Another plain body paragraph with plenty of words to dominate the size map.', 670),
      ],
      FONTS, PAGE_W, PAGE_H
    );
    const doc: FlowDoc = { pages: [page] };
    assignHeadings(doc);
    expect(lvlOf(doc, 'OVERVIEW')).toBe(3);
    expect(lvlOf(doc, 'Plain body paragraph')).toBe(0);
  });

  it('does not promote a short all-caps acronym-only line below the 3-letter floor', () => {
    const page = reconstructPage(
      [
        bodyLine('OK', 740), // 2 letters → below floor → stays body
        bodyLine('Plain body paragraph with plenty of words to dominate the weighted size map.', 700),
        bodyLine('Another plain body paragraph with plenty of words to dominate the size map.', 670),
      ],
      FONTS, PAGE_W, PAGE_H
    );
    const doc: FlowDoc = { pages: [page] };
    assignHeadings(doc);
    expect(lvlOf(doc, 'OK')).toBe(0);
  });
});

describe('reconstructPage — list nesting depth (Gap 4)', () => {
  it('derives listDepth from the item x-indent', () => {
    const items = [
      mkItem('• alpha', 100, 700),
      mkItem('• beta', 100, 670),
      mkItem('• gamma', 100, 640),
      mkItem('• nested', 112, 610), // one font-size (12pt) further right → depth 1
    ];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H);
    const lists = page.paragraphs.filter(p => p.listType === 'bullet');
    expect(lists.length).toBe(4);
    expect(lists.filter(p => (p.listDepth ?? 0) === 0).length).toBe(3);
    const nested = lists.find(p => p.runs.some(r => r.text.includes('nested')));
    expect(nested?.listDepth).toBe(1);
  });
});

// ── New: extractPsName ────────────────────────────────────────────────────────

describe('extractPsName', () => {
  it('strips the ABCDEF+ subset-tag prefix from an internal font id', () => {
    expect(extractPsName('g_d0_ABCDEF+Arial-BoldMT')).toBe('Arial-BoldMT');
  });

  it('returns the raw id when no + prefix is present', () => {
    expect(extractPsName('g_d0_f1')).toBe('g_d0_f1');
  });

  it('handles bare PostScript names with no prefix at all', () => {
    expect(extractPsName('Helvetica')).toBe('Helvetica');
  });
});

// ── New: PS-name merge key ────────────────────────────────────────────────────

describe('reconstructPage — PS name in run merge key', () => {
  it('keeps adjacent runs with different PostScript names separate', () => {
    // f_serif1 = 'Times-Roman', f_serif2 = 'Georgia' — same CSS family, same style, different PS name
    const fonts: FontInfoMap = {
      f_serif1: { name: 'Times-Roman', family: 'serif' },
      f_serif2: { name: 'Georgia', family: 'serif' },
    };
    const items = [
      mkItem('First', 50, 700, { fontName: 'f_serif1' }),
      mkItem('Second', 100, 700, { fontName: 'f_serif2' }),
    ];
    const page = reconstructPage(items, fonts, PAGE_W, PAGE_H);
    // Without psName in merge key these collapse to 1 run; with it they stay as 2
    expect(page.paragraphs[0].runs).toHaveLength(2);
  });
});

// ── New: colorMap → FlowRun.color ─────────────────────────────────────────────

describe('reconstructPage — colorMap propagation', () => {
  it('sets FlowRun.color from the colorMap when a matching position exists', () => {
    const colorMap = new Map([['50,700', 'FF0000']]);
    const items = [mkItem('RedText', 50, 700)];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H, colorMap);
    expect(page.paragraphs[0].runs[0].color).toBe('FF0000');
  });

  it('leaves FlowRun.color undefined when no matching position in colorMap', () => {
    const colorMap = new Map([['999,999', 'FF0000']]);
    const items = [mkItem('Black', 50, 700)];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H, colorMap);
    expect(page.paragraphs[0].runs[0].color).toBeUndefined();
  });

  it('omits colorMap argument gracefully (undefined)', () => {
    const items = [mkItem('Plain', 50, 700)];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H);
    expect(page.paragraphs[0].runs[0].color).toBeUndefined();
  });
});

// ── New: detectColumnSplit ────────────────────────────────────────────────────

describe('detectColumnSplit', () => {
  it('returns null when all words are on the same side with no middle gap', () => {
    const words = [
      { x: 50, width: 100 },
      { x: 50, width: 120 },
      { x: 50, width: 90 },
      { x: 50, width: 80 },
    ];
    expect(detectColumnSplit(words, PAGE_W)).toBeNull();
  });

  it('returns a midpoint inside the gap for a classic 2-column layout', () => {
    // Left column ends ~230pt, right column starts ~350pt → 120pt gap (>5% of 612).
    // y values span two baselines so the multi-baseline guard passes.
    const words = [
      { x: 50, width: 180, y: 700 },
      { x: 50, width: 160, y: 680 },
      { x: 350, width: 180, y: 700 },
      { x: 350, width: 160, y: 680 },
    ];
    const split = detectColumnSplit(words, PAGE_W);
    expect(split).not.toBeNull();
    expect(split).toBeGreaterThan(230);
    expect(split).toBeLessThan(350);
  });

  it('returns null when the gap is narrower than 5% of page width (~30pt)', () => {
    // Left ends at 250, right starts at 255 → 5pt gap < 30.6pt threshold
    const words = [
      { x: 50, width: 200 },
      { x: 50, width: 200 },
      { x: 255, width: 200 },
      { x: 255, width: 200 },
    ];
    expect(detectColumnSplit(words, PAGE_W)).toBeNull();
  });

  it('returns null for fewer than 4 words', () => {
    const words = [{ x: 50, width: 180 }, { x: 400, width: 180 }];
    expect(detectColumnSplit(words, PAGE_W)).toBeNull();
  });
});

// ── New: detectListPrefix ─────────────────────────────────────────────────────

describe('detectListPrefix', () => {
  it('detects a unicode bullet and strips it', () => {
    const r = detectListPrefix('• Apple pie');
    expect(r).not.toBeNull();
    expect(r?.type).toBe('bullet');
    expect(r?.stripped).toBe('Apple pie');
  });

  it('detects a dash bullet and strips it', () => {
    const r = detectListPrefix('- Item text');
    expect(r).not.toBeNull();
    expect(r?.type).toBe('bullet');
    expect(r?.stripped).toBe('Item text');
  });

  it('detects a numeric ordered marker and strips it', () => {
    const r = detectListPrefix('3. Third item');
    expect(r).not.toBeNull();
    expect(r?.type).toBe('ordered');
    expect(r?.stripped).toBe('Third item');
  });

  it('returns null for plain body text', () => {
    expect(detectListPrefix('This is regular paragraph text.')).toBeNull();
  });

  // Gap 4 (Sprint 3): widen ordered markers to decimal-paren / parenthesized /
  // lettered forms, each carrying a docx LevelFormat hint. Letter/roman markers
  // are matched ONLY in a parenthesis form (`a)`, `(a)`) — never bare-dot
  // (`a.`, `A.`) — to avoid author-initial ("A. Smith") and sentence-start
  // false positives.
  it('detects close-paren decimal `1)` as decimal with %1) text', () => {
    const r = detectListPrefix('1) First');
    expect(r).toMatchObject({ type: 'ordered', stripped: 'First', format: 'decimal', ordinalText: '%1)' });
  });
  it('detects parenthesized decimal `(1)` as decimal with (%1) text', () => {
    const r = detectListPrefix('(1) First');
    expect(r).toMatchObject({ type: 'ordered', stripped: 'First', format: 'decimal', ordinalText: '(%1)' });
  });
  it('detects close-paren lower-alpha `a)` as lowerLetter', () => {
    const r = detectListPrefix('a) sub-item');
    expect(r).toMatchObject({ type: 'ordered', stripped: 'sub-item', format: 'lowerLetter', ordinalText: '%1)' });
  });
  it('detects parenthesized lower-alpha `(a)` as lowerLetter', () => {
    const r = detectListPrefix('(a) sub-item');
    expect(r).toMatchObject({ type: 'ordered', stripped: 'sub-item', format: 'lowerLetter', ordinalText: '(%1)' });
  });
  it('detects close-paren upper-alpha `A)` as upperLetter', () => {
    const r = detectListPrefix('A) Section');
    expect(r).toMatchObject({ type: 'ordered', stripped: 'Section', format: 'upperLetter', ordinalText: '%1)' });
  });
  it('plain decimal `3.` keeps the legacy %1. text template', () => {
    const r = detectListPrefix('3. Third item');
    expect(r).toMatchObject({ type: 'ordered', format: 'decimal', ordinalText: '%1.' });
  });
  it('does NOT treat bare-dot letters as lists (author initials / sentence starts)', () => {
    expect(detectListPrefix('a. some clause')).toBeNull();
    expect(detectListPrefix('A. Smith wrote this')).toBeNull();
    expect(detectListPrefix('I. introduction')).toBeNull();
  });
});

// ── New: reconstructPage — 2-column XY-cut ───────────────────────────────────

describe('reconstructPage — 2-column XY-cut', () => {
  it('reads left column paragraphs before right column paragraphs', () => {
    // Left col: x≈50, ends at 210; right col: x≈350; gap 210-350 ≈ 140pt > 5% of 612
    const items = [
      mkItem('RightTop', 350, 700, { width: 160 }),
      mkItem('LeftTop', 50, 700, { width: 160 }),
      mkItem('RightBot', 350, 660, { width: 160 }),
      mkItem('LeftBot', 50, 660, { width: 160 }),
    ];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H);
    const texts = page.paragraphs.map(p => p.runs.map(r => r.text).join('').trim());
    const leftIdx = texts.findIndex(t => t.includes('LeftTop'));
    const rightIdx = texts.findIndex(t => t.includes('RightTop'));
    expect(leftIdx).toBeLessThan(rightIdx);
  });

  it('preserves single-column behaviour when words span the full width', () => {
    // Words spread evenly — no horizontal gap in the middle zone
    const items = [
      mkItem('Alpha', 50, 700, { width: 100 }),
      mkItem('Beta', 200, 700, { width: 100 }),
      mkItem('Gamma', 350, 700, { width: 100 }),
      mkItem('Delta', 500, 700, { width: 80 }),
    ];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H);
    // All on same baseline → 1 paragraph with all text
    expect(page.paragraphs).toHaveLength(1);
  });
});

// ── New: reconstructPage — list detection ────────────────────────────────────

describe('reconstructPage — list detection', () => {
  it('marks a bullet paragraph and strips the marker from the first run', () => {
    const items = [mkItem('• First item text', 50, 700, { width: 120 })];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H);
    const p = page.paragraphs[0];
    expect(p.listType).toBe('bullet');
    expect(p.runs.map(r => r.text).join('')).not.toMatch(/^[•]/);
  });

  it('marks a numeric ordered paragraph and strips the marker', () => {
    const items = [mkItem('1. Numbered item', 50, 700, { width: 120 })];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H);
    const p = page.paragraphs[0];
    expect(p.listType).toBe('ordered');
    expect(p.runs.map(r => r.text).join('')).not.toMatch(/^\d+\./);
  });

  it('leaves listType undefined for regular paragraphs', () => {
    const items = [mkItem('Regular paragraph text here.', 50, 700)];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H);
    expect(page.paragraphs[0].listType).toBeUndefined();
  });
});

describe('reconstructColumn — wrapped list-item continuation merge (Gap 4)', () => {
  // A list item whose wrap splits into a separate paragraph (baseline gap >
  // PARA_GAP×size) used to become a marker-less plain paragraph between items —
  // which resets the writer's numbering instance (item 2 restarts at 1). The
  // continuation (hanging-indented, single-line, body-sized) should merge back
  // into the prior list item so numbering stays contiguous.
  it('merges a hanging-indent continuation line into the prior list item', () => {
    const items = [
      mkItem('1. First item that runs long', 72, 700),
      // No marker, indented under the item TEXT (x=92 > marker x=72), gap 28pt
      // (> 1.6×12=19.2) so step-2 splits it into its own paragraph.
      mkItem('continuation of the first item', 92, 672),
      mkItem('2. Second item', 72, 632),
    ];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H);
    const ordered = page.paragraphs.filter(p => p.listType === 'ordered');
    expect(ordered).toHaveLength(2);
    // The continuation is absorbed into item 1, NOT left as an orphan plain para.
    const item1Text = ordered[0].runs.map(r => r.text).join('');
    expect(item1Text).toContain('continuation of the first item');
    // No marker-less body paragraph survives between the two list items.
    const plainBetween = page.paragraphs.some(p => !p.listType && p.runs.map(r => r.text).join('').includes('continuation'));
    expect(plainBetween).toBe(false);
  });

  it('does NOT merge a genuine body paragraph that starts at the column-left edge', () => {
    const items = [
      mkItem('1. Only list item', 72, 700),
      // Starts at the SAME left edge as the marker (x=72) → a new body paragraph,
      // not a hanging continuation. Must stay separate.
      mkItem('A following body paragraph at the column left edge', 72, 660),
    ];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H);
    const item1 = page.paragraphs.find(p => p.listType === 'ordered');
    expect(item1?.runs.map(r => r.text).join('')).not.toContain('following body paragraph');
    expect(page.paragraphs.some(p => !p.listType && p.runs.map(r => r.text).join('').includes('following body paragraph'))).toBe(true);
  });

  it('keeps ordered numbering contiguous across a wrapped item (end-to-end markdown)', () => {
    const items = [
      mkItem('1. First item that runs long', 72, 700),
      mkItem('continuation of the first item', 92, 672),
      mkItem('2. Second item', 72, 632),
    ];
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H);
    const md = flowDocToMarkdown({ pages: [page] });
    // Item 2 must be "2." — before the merge the orphan continuation reset the
    // instance and it rendered as "1." again.
    expect(md).toMatch(/^1\. .*First item/m);
    expect(md).toMatch(/^2\. Second item/m);
    expect(md).not.toMatch(/^1\. Second item/m);
  });
});

/**
 * C22 — the text-item half of the crop-frame normalisation. Its siblings (rules, images, colour
 * keys) are carried by `walkPageOps`' base transform, pinned in tests/export/opStreamWalker.test.ts.
 */
describe('translateItemsToCropOrigin', () => {
  const item = (x: number, y: number): RawTextItem => mkItem('W', x, y);

  it('moves only the translation part of the transform', () => {
    const src = item(100, 300);
    src.transform = [14, 1, 2, 14, 100, 300]; // a skewed/scaled run, to prove a,b,c,d are invariant
    const [out] = translateItemsToCropOrigin([src], 50, 70) as RawTextItem[];
    expect(out.transform).toEqual([14, 1, 2, 14, 50, 230]);
  });

  it('never mutates the input — pdf.js owns those objects and they are read again', () => {
    const src = item(100, 300);
    translateItemsToCropOrigin([src], 50, 70);
    expect(src.transform[4]).toBe(100);
    expect(src.transform[5]).toBe(300);
  });

  it('returns the SAME array at a zero origin (the ~85% case allocates nothing)', () => {
    const items = [item(10, 20)];
    expect(translateItemsToCropOrigin(items, 0, 0)).toBe(items);
  });

  it('passes marked-content boundaries through untouched — they carry no geometry', () => {
    const marker = { type: 'beginMarkedContentProps' as const, id: 'mc0' };
    const out = translateItemsToCropOrigin([marker, item(100, 300)], 50, 70);
    expect(out[0]).toBe(marker);
    expect((out[1] as RawTextItem).transform[4]).toBe(50);
  });
});
