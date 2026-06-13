import { describe, it, expect } from 'vitest';
import {
  reconstructPage,
  assignHeadings,
  extractPsName,
  detectColumnSplit,
  detectListPrefix,
  type RawTextItem,
  type FontInfoMap,
  type FlowDoc,
} from '../../src/utils/flowDoc';

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
