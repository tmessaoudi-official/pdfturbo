/**
 * Redaction-leak regression (SPRINT1 P0).
 *
 * The PDF→DOCX/MD/TXT flow extractor reads SOURCE text via pdf.js getTextContent
 * and (pre-fix) ignored redaction overlays entirely — so text painted under a
 * black redaction box still leaked into the exported DOCX/MD/TXT.
 *
 * These tests exercise the pure, redaction-aware extraction path:
 *   - `reconstructPage(items, fonts, w, h, colorMap, redactions)` must DROP any
 *     source text item whose bounding box intersects a redaction rectangle.
 *   - `isItemRedacted` is the pure geometry predicate (top-origin element rect
 *     vs. y-up baseline text item), tested directly.
 *
 * Coordinate contract (verified against exportPipeline.rasterizePageWithRedactions
 * + redactionElement.render):
 *   - Redaction element x/y/width/height are page-point units, TOP-LEFT origin
 *     (y grows downward) — `ctx.fillRect(el.x*SCALE, el.y*SCALE, ...)` on a
 *     viewport-sized canvas.
 *   - pdf.js text item transform[4]=x, transform[5]=y is the baseline origin in
 *     PDF space, BOTTOM-LEFT origin (y grows upward).
 */
import { describe, it, expect } from 'vitest';
import {
  reconstructPage,
  isItemRedacted,
  type RawTextItem,
  type FontInfoMap,
  type RedactionRect,
} from '../../src/utils/flowDoc';

const FONTS: FontInfoMap = { f1: { name: 'Helvetica', family: 'sans-serif' } };

const PAGE_W = 612;
const PAGE_H = 792;

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

describe('isItemRedacted — pure geometry predicate', () => {
  // Secret on the baseline y=700 (PDF y-up). In top-origin space the glyph box
  // top is at PAGE_H - 700 - size = 792 - 700 - 12 = 80, bottom at 92.
  const secret = mkItem('SECRET', 50, 700);

  it('returns true when a redaction rect covers the text box (top-origin)', () => {
    const red: RedactionRect = { x: 40, y: 75, width: 120, height: 25 }; // covers top-origin 75..100
    expect(isItemRedacted(secret, red, PAGE_H)).toBe(true);
  });

  it('returns false when the redaction rect is elsewhere on the page', () => {
    const red: RedactionRect = { x: 40, y: 400, width: 120, height: 25 };
    expect(isItemRedacted(secret, red, PAGE_H)).toBe(false);
  });

  it('returns false when the rect overlaps horizontally but not vertically', () => {
    const red: RedactionRect = { x: 40, y: 200, width: 120, height: 25 };
    expect(isItemRedacted(secret, red, PAGE_H)).toBe(false);
  });
});

describe('reconstructPage — drops text under redaction boxes', () => {
  // Two lines, both at x=50. KEEP line baseline y=700 (top-origin ~80..92),
  // SECRET line baseline y=600 (top-origin ~180..192).
  const items = [
    mkItem('Public heading text', 50, 700),
    mkItem('SECRET password is hunter2', 50, 600),
  ];

  function flatten(redactions?: RedactionRect[]): string {
    const page = reconstructPage(items, FONTS, PAGE_W, PAGE_H, undefined, redactions);
    return page.paragraphs.flatMap(p => p.runs.map(r => r.text)).join(' ');
  }

  it('REPRODUCE: without redaction awareness the secret leaks', () => {
    // No redactions passed → both lines present (this is the pre-fix behaviour).
    const text = flatten();
    expect(text).toContain('SECRET');
    expect(text).toContain('hunter2');
  });

  it('FIX: a redaction over the secret line removes it from the flow model', () => {
    // Cover top-origin band 170..200 → the SECRET line (~180..192) only.
    const red: RedactionRect = { x: 40, y: 170, width: 300, height: 35 };
    const text = flatten([red]);
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('hunter2');
    // The non-redacted heading must survive.
    expect(text).toContain('Public heading text');
  });
});

/**
 * WS5 P0 / WS7 round 1 — a source run drawn with a ROTATED text matrix escaped the redaction filter,
 * and the first fix for it over-dropped ordinary text.
 *
 * pdf.js's TextItem box is `width` along the transform's FIRST column and `height` along its SECOND
 * (`pdf.worker.mjs:35812-35821`). `isItemRedacted` instead extended `+x` by `|width|`, so a sideways
 * run was tested in a box disjoint from its glyphs and never dropped — through DOCX, Markdown, TXT,
 * CSV and XLSX, at every page rotation including 0.
 *
 * **The horizontal fixtures carry MEASURED item shapes** — `1` and `hello world` below are probe
 * output. The rotated and vertical ones use plausible advances rather than measured ones, because
 * the probe cannot produce a rotated Tm or a vertical font from this repo's fonts; what matters
 * there is the SHAPE of the transform, not the exact advance. Said precisely because an earlier
 * version of this sentence claimed every fixture was measured, which was not true. The first version of this guard hardcoded
 * `height: 0` for horizontal text on an inverted reading of the source; pdf.js never emits that, so
 * the "byte-identity control" could not detect the over-drop the fix introduced and the panel had to
 * find it instead. Real values, from a probe over a pdf-lib page:
 *   `{str:"1",           width:6.672,  height:12, transform:[12,0,0,12,100,300]}`
 *   `{str:"hello world", width:57.348, height:12, transform:[12,0,0,12,100,200]}`
 */
describe('isItemRedacted — run footprint from the transform (WS5 P0 / WS7)', () => {
  const PAGE_TOP = 800;
  /** 12pt horizontal text rotated 90° CCW by the Tm: glyphs run UP from (300,100), x∈[288,300]. */
  const sideways = (): RawTextItem => ({
    str: 'SECRETWORD',
    transform: [0, 12, -12, 0, 300, 100],
    width: 70,      // advance, along the FIRST column — here +y
    height: 12,     // glyph size, along the SECOND column — here -x. NOT zero.
    fontName: 'F1',
  } as unknown as RawTextItem);

  it('drops a sideways run whose glyphs are under the box — THE LEAK CASE', () => {
    // Covers the glyphs (x 288..300) WITHOUT touching the phantom strip the old maths tested
    // (x 300..370), or it would pass for the wrong reason.
    expect(isItemRedacted(sideways(), { x: 280, y: PAGE_TOP - 175, width: 18, height: 80 }, PAGE_TOP)).toBe(true);
  });

  it('does NOT drop it where the old maths looked — the +x strip beside the glyphs', () => {
    expect(isItemRedacted(sideways(), { x: 320, y: PAGE_TOP - 175, width: 40, height: 80 }, PAGE_TOP)).toBe(false);
  });

  it('does NOT over-drop a SHORT horizontal run — the regression the panel caught', () => {
    // `1` at 12pt: glyphs end at x = 100 + 6.672. A redaction starting 2pt clear of that must not
    // touch it. Taking max(|width|,|height|) as the advance inflated the run to a full em (12pt),
    // swallowing this box and silently deleting text from every flow export.
    const one = { str: '1', transform: [12, 0, 0, 12, 100, 300], width: 6.672, height: 12, fontName: 'F1' } as unknown as RawTextItem;
    expect(isItemRedacted(one, { x: 108.7, y: PAGE_TOP - 312, width: 30, height: 14 }, PAGE_TOP)).toBe(false);
    // …and it IS dropped when the box genuinely covers it.
    expect(isItemRedacted(one, { x: 98, y: PAGE_TOP - 312, width: 20, height: 14 }, PAGE_TOP)).toBe(true);
  });

  it('covers the DESCENDER, so a box under the baseline still drops the run', () => {
    // pdf.js reports an item from its BASELINE, so a box spanning [baseline, baseline+size] stops
    // where the descenders of g/j/p/q/y begin. A redaction covering only that strip left the whole
    // run in the DOCX/MD/TXT/CSV/XLSX exports while SECURITY.md said horizontal text was covered.
    const horiz = { str: 'pygmy', transform: [12, 0, 0, 12, 100, 200], width: 30, height: 12, fontName: 'F1' } as unknown as RawTextItem;
    // y-up 197..200 is below the baseline (200) and inside the descender band.
    expect(isItemRedacted(horiz, { x: 95, y: PAGE_TOP - 200, width: 40, height: 3 }, PAGE_TOP)).toBe(true);
    // Well below it is still clear — the over-approximation is a quarter em, not unbounded.
    expect(isItemRedacted(horiz, { x: 95, y: PAGE_TOP - 180, width: 40, height: 3 }, PAGE_TOP)).toBe(false);
  });

  it('scales the descender by the FONT SIZE, not by the run advance', () => {
    // On a horizontal item `size` and `extent2` are both the font size, so the existing descender
    // case cannot tell them apart — sabotage showed it passing either way. This item has them
    // differ the way a vertical run does (glyph size 12, advance 70): a quarter of the advance is
    // 17.5pt of extra footprint where a quarter of the em is 3pt.
    const vertical = { str: 'x', transform: [12, 0, 0, 12, 300, 700], width: 12, height: 70, fontName: 'F1' } as unknown as RawTextItem;
    // 6-10pt beyond the run's origin edge: inside a 17.5pt band, outside a 3pt one.
    expect(isItemRedacted(vertical, { x: 295, y: 106, width: 20, height: 4 }, PAGE_TOP)).toBe(false);
    // …and 2pt beyond is still covered, so the band exists.
    expect(isItemRedacted(vertical, { x: 295, y: 99, width: 20, height: 2 }, PAGE_TOP)).toBe(true);
  });

  it('is UNCHANGED for ordinary horizontal text — the byte-identity control, measured shapes', () => {
    const horiz = { str: 'hello world', transform: [12, 0, 0, 12, 100, 200], width: 57.348, height: 12, fontName: 'F1' } as unknown as RawTextItem;
    expect(isItemRedacted(horiz, { x: 90, y: PAGE_TOP - 215, width: 80, height: 20 }, PAGE_TOP)).toBe(true);
    expect(isItemRedacted(horiz, { x: 0, y: PAGE_TOP - 215, width: 50, height: 20 }, PAGE_TOP)).toBe(false);   // left of it
    expect(isItemRedacted(horiz, { x: 90, y: PAGE_TOP - 150, width: 80, height: 20 }, PAGE_TOP)).toBe(false);  // below the baseline
  });

  // VERTICAL-WRITING runs are UNCERTIFIED-BY-EXECUTION and deliberately not asserted here. pdf.js
  // swaps the two roles for a vertical font (`width` becomes the glyph size, `height` the advance)
  // AND advances downward, so the sign along the second column is the open question — and no
  // vertical font exists anywhere in this repo to measure it with. An earlier version of this file
  // claimed to cover it using a rotated Tm with `width: 0`, which is not a vertical-writing item at
  // all: it passed for an unrelated reason. Recorded as a bound in CLAUDE.md rather than guessed.
});
