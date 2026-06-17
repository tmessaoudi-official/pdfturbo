/**
 * G12 (2026-06-17) — typed overlay text must INTERLEAVE into the source page's
 * paragraphs at its reading-order position, not be APPENDED at the end. A sticky
 * note typed in the MIDDLE of a page used to export at the bottom of that page in
 * the DOCX (wrong reading order).
 *
 * Reading order = DESCENDING PDF y-up (top of page = larger y = first). Source
 * paragraphs carry `p.y` in PDF user space (G9); overlay paragraphs get a `y` in
 * the SAME space via `textElementsToFlowParagraphs(els, pageHeight)`
 * (`pdfY = pageHeight - el.y`). `interleaveByReadingOrder` is the pure merge+sort.
 */
import { describe, it, expect } from 'vitest';
import {
  interleaveByReadingOrder,
  textElementsToFlowParagraphs,
  type FlowParagraph,
} from '../../src/utils/flowDoc';

/** Tiny FlowParagraph factory keyed by a label (the first run's text) + y. */
function para(label: string, y?: number): FlowParagraph {
  return {
    runs: [{ text: label, bold: false, italic: false, fontSize: 12, fontFamily: 'sans-serif', rtl: false }],
    heading: 0,
    alignment: 'left',
    rtl: false,
    ...(y === undefined ? {} : { y }),
  };
}
const labelOf = (p: FlowParagraph) => p.runs[0].text;

describe('interleaveByReadingOrder (pure)', () => {
  it('lands an overlay paragraph BETWEEN source paragraphs by descending y', () => {
    // Source paragraphs top→bottom: y=700 (top), 400 (mid), 100 (bottom).
    const source = [para('top', 700), para('mid', 400), para('bottom', 100)];
    // Overlay at PDF y≈450 → reads between top (700) and mid (400).
    const overlay = [para('overlay', 450)];
    const merged = interleaveByReadingOrder(source, overlay);
    expect(merged.map(labelOf)).toEqual(['top', 'overlay', 'mid', 'bottom']);
  });

  it('CONTROL: no overlay → source order is returned unchanged (same array reference)', () => {
    const source = [para('top', 700), para('mid', 400), para('bottom', 100)];
    const merged = interleaveByReadingOrder(source, []);
    expect(merged).toBe(source); // identity — guarantees byte-identical no-overlay pages
  });

  it('overlay above the top source paragraph reads FIRST', () => {
    const source = [para('top', 700), para('bottom', 100)];
    const overlay = [para('header', 800)];
    expect(interleaveByReadingOrder(source, overlay).map(labelOf)).toEqual(['header', 'top', 'bottom']);
  });

  it('overlay below the bottom source paragraph reads LAST', () => {
    const source = [para('top', 700), para('bottom', 100)];
    const overlay = [para('footer', 50)];
    expect(interleaveByReadingOrder(source, overlay).map(labelOf)).toEqual(['top', 'bottom', 'footer']);
  });

  it('STABLE on ties: equal-y source then overlay keeps source first', () => {
    const source = [para('src', 300)];
    const overlay = [para('ovr', 300)];
    expect(interleaveByReadingOrder(source, overlay).map(labelOf)).toEqual(['src', 'ovr']);
  });

  it('y-less paragraphs sink to the end (stable among themselves)', () => {
    const source = [para('hasY', 500), para('noY1'), para('noY2')];
    const overlay = [para('ovr', 600)];
    expect(interleaveByReadingOrder(source, overlay).map(labelOf)).toEqual(['ovr', 'hasY', 'noY1', 'noY2']);
  });
});

describe('textElementsToFlowParagraphs — pageHeight → PDF y-up `y`', () => {
  it('sets y = pageHeight - el.y when pageHeight is provided', () => {
    // el.y is editor display space (top-left origin, y-down). pageHeight 800,
    // el.y 350 → pdfY 450.
    const p = textElementsToFlowParagraphs([{ text: 'note', x: 10, y: 350, fontSize: 12 }], 800);
    expect(p).toHaveLength(1);
    expect(p[0].y).toBe(450);
  });

  it('omits y entirely when pageHeight is NOT provided (blank-page caller unchanged)', () => {
    const p = textElementsToFlowParagraphs([{ text: 'note', x: 10, y: 350, fontSize: 12 }]);
    expect(p).toHaveLength(1);
    expect('y' in p[0]).toBe(false);
  });

  it('multi-line: each emitted line gets a DESCENDING y so lines stay ordered', () => {
    const p = textElementsToFlowParagraphs([{ text: 'l1\nl2\nl3', x: 0, y: 100, fontSize: 20 }], 800);
    expect(p.map((x) => x.runs[0].text)).toEqual(['l1', 'l2', 'l3']);
    expect(p[0].y).toBeGreaterThan(p[1].y as number);
    expect(p[1].y).toBeGreaterThan(p[2].y as number);
  });

  it('interleaves correctly when fed a real source+overlay reading-order scenario', () => {
    // Source mid-page paragraph at PDF y=450; overlay typed at editor y=350 on an
    // 800-tall page → PDF y=450 → tie → stable (source first), but an overlay at
    // editor y=200 → PDF y=600 reads ABOVE it.
    const source = [para('top', 700), para('mid', 450), para('bottom', 100)];
    const overlay = textElementsToFlowParagraphs([{ text: 'middleNote', x: 0, y: 200, fontSize: 12 }], 800);
    const merged = interleaveByReadingOrder(source, overlay);
    expect(merged.map(labelOf)).toEqual(['top', 'middleNote', 'mid', 'bottom']);
  });
});
