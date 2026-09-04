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
 * WS5 P0 — a source run drawn with a ROTATED text matrix escaped the redaction filter entirely.
 *
 * `isItemRedacted` extended the run +x by `|item.width|` from `transform[4]`. But pdf.js sets
 * `width` to the advance ALONG THE TEXT DIRECTION and carries the direction in `transform`
 * (`pdf.worker.mjs:35814-35819`: for HORIZONTAL text `width = hypot(trm[0],trm[1])` and `height = 0`;
 * for VERTICAL text `width = 0` and `height = hypot(trm[2],trm[3])` — exactly one is non-zero). So a
 * sideways run was tested in a box DISJOINT from its glyphs and was never dropped.
 *
 * One predicate feeds three channels — the heuristic flow, the struct-tree flow and the table
 * extractor — so the leak reached DOCX, Markdown, TXT, CSV and XLSX. It is orthogonal to the page's
 * own `/Rotate` and to the CropBox origin: it leaks at every rotation, including 0.
 */
describe('isItemRedacted — rotated and vertical runs (WS5 P0)', () => {
  const PAGE_TOP = 800;
  /** 12pt text rotated 90° CCW: glyphs run UP the page from (300,100), occupying x∈[288,300]. */
  const sideways = (): RawTextItem => ({
    str: 'SECRETWORD',
    transform: [0, 12, -12, 0, 300, 100],
    width: 70,     // advance along the TEXT direction (here: +y)
    height: 0,
    fontName: 'F1',
  } as unknown as RawTextItem);

  it('drops a sideways run whose glyphs are under the box — THE LEAK CASE', () => {
    // The box must cover the glyphs (x 288..300) WITHOUT touching the phantom strip the old maths
    // tested (x 300..370), or it passes for the wrong reason: a box at x 285..305 overlaps BOTH and
    // was green before the fix too. That first attempt is why this one stops at 298.
    const red = { x: 280, y: PAGE_TOP - 175, width: 18, height: 80 };
    expect(isItemRedacted(sideways(), red, PAGE_TOP)).toBe(true);
  });

  it('does NOT drop it where the old maths looked — the +x strip beside the glyphs', () => {
    // The pre-fix predicate tested x∈[300,370]; a box THERE covers no glyph at all, so a filter that
    // still fired here would be matching the phantom box rather than the text.
    const red = { x: 320, y: PAGE_TOP - 175, width: 40, height: 80 };
    expect(isItemRedacted(sideways(), red, PAGE_TOP)).toBe(false);
  });

  it('drops a VERTICAL-writing run, whose advance arrives in height, not width', () => {
    const vertical = {
      str: '縦書き', transform: [0, 12, -12, 0, 300, 100], width: 0, height: 70, fontName: 'F1',
    } as unknown as RawTextItem;
    // The box must sit at the FAR END of the run, not over its origin. The run spans user-space
    // y 100..170, i.e. y-down 630..700; a box at 630..645 covers only the end. Sabotage found this:
    // a box over the origin stayed green even with the advance forced to zero, so it proved nothing
    // about reading `height`. With the advance dropped the run collapses to its origin and this
    // case goes red, which is what makes it a guard.
    const red = { x: 280, y: 630, width: 18, height: 15 };
    expect(isItemRedacted(vertical, red, PAGE_TOP)).toBe(true);
  });

  it('is UNCHANGED for ordinary horizontal text — the byte-identity control', () => {
    const horiz = {
      str: 'hello', transform: [12, 0, 0, 12, 100, 700], width: 40, height: 0, fontName: 'F1',
    } as unknown as RawTextItem;
    // Covering box → dropped.
    expect(isItemRedacted(horiz, { x: 90, y: PAGE_TOP - 715, width: 60, height: 20 }, PAGE_TOP)).toBe(true);
    // Box to the left of the run, not touching it → kept.
    expect(isItemRedacted(horiz, { x: 0, y: PAGE_TOP - 715, width: 50, height: 20 }, PAGE_TOP)).toBe(false);
    // Box below the baseline → kept.
    expect(isItemRedacted(horiz, { x: 90, y: PAGE_TOP - 650, width: 60, height: 20 }, PAGE_TOP)).toBe(false);
  });
});
