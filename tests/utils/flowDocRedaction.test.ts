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
