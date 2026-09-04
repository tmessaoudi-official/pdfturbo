/**
 * XFDF ↔ element-model mapping (#57). The codec (xfdf.ts) handles the XML; this
 * covers the coordinate flip (editor display space, top-left/y-down ↔ PDF user
 * space, bottom-left/y-up) and the type mapping. Round-trip through PDF user
 * space must preserve geometry and payload for the supported types.
 */
import { describe, it, expect } from 'vitest';
import { elementToXfdfAnnot, xfdfAnnotToElement, pageHeightPt } from '../../src/export/xfdfMapping';
import type { DocumentPage } from '../../src/core/documentModel';
import type { ElementJSON } from '../../src/elements/annotationElement';

const H = 800;

const HIGHLIGHT: ElementJSON = { id: 1, type: 'highlight', x: 50, y: 100, width: 200, height: 20, pageId: 'p1', color: '#FFFF00', opacity: 0.4 };
const COMMENT: ElementJSON = { id: 2, type: 'comment', x: 300, y: 50, width: 24, height: 24, pageId: 'p1', color: '#FFFDE7', text: 'a note' };
const TEXT: ElementJSON = { id: 3, type: 'text', x: 10, y: 20, width: 150, height: 30, pageId: 'p1', color: '#000000', text: 'hi there', fontSize: 14 };

describe('XFDF element mapping (#57)', () => {
  it('flips a highlight to PDF user space and back without loss', () => {
    const a = elementToXfdfAnnot(HIGHLIGHT, 0, H);
    if (!a) throw new Error('expected a highlight annot');
    expect(a).toEqual({ type: 'highlight', page: 0, rect: [50, 680, 250, 700], color: '#FFFF00', opacity: 0.4 });
    expect(xfdfAnnotToElement(a, 'p1', H)).toMatchObject({ type: 'highlight', x: 50, y: 100, width: 200, height: 20, pageId: 'p1', color: '#FFFF00', opacity: 0.4 });
  });

  it('maps a comment ↔ XFDF text (sticky note)', () => {
    const a = elementToXfdfAnnot(COMMENT, 2, H);
    if (!a) throw new Error('expected a text annot');
    expect(a).toEqual({ type: 'text', page: 2, rect: [300, 726, 324, 750], color: '#FFFDE7', contents: 'a note' });
    expect(xfdfAnnotToElement(a, 'pX', H)).toMatchObject({ type: 'comment', x: 300, y: 50, width: 24, height: 24, pageId: 'pX', text: 'a note' });
  });

  it('maps a text element ↔ XFDF freetext, preserving font size and body', () => {
    const a = elementToXfdfAnnot(TEXT, 0, H);
    if (!a) throw new Error('expected a freetext annot');
    expect(a).toEqual({ type: 'freetext', page: 0, rect: [10, 750, 160, 780], color: '#000000', contents: 'hi there', fontSize: 14 });
    expect(xfdfAnnotToElement(a, 'p1', H)).toMatchObject({ type: 'text', x: 10, y: 20, width: 150, height: 30, pageId: 'p1', text: 'hi there', fontSize: 14 });
  });

  // #QA-2026-06-23 P3 (#7): a foreign/malformed XFDF may carry an inverted rect
  // (urx<llx or ury<lly). xfdfAnnotToElement must normalize it to a positive-size
  // element at the correct top-left, not emit negative width/height.
  it('normalizes an inverted/negative-size rect to positive geometry', () => {
    const inverted = { type: 'highlight' as const, page: 0, rect: [250, 700, 50, 680] as [number, number, number, number], color: '#FFFF00', opacity: 0.4 };
    expect(xfdfAnnotToElement(inverted, 'p1', H)).toMatchObject({ type: 'highlight', x: 50, y: 100, width: 200, height: 20 });
  });

  it('returns null for unsupported element types (skipped, never mis-mapped)', () => {
    const sig: ElementJSON = { id: 9, type: 'signature', x: 0, y: 0, width: 10, height: 10, pageId: 'p1' };
    expect(elementToXfdfAnnot(sig, 0, H)).toBeNull();
  });
});

describe('XFDF shape mapping (G21)', () => {
  const RECT: ElementJSON = { id: 10, type: 'shape', shapeType: 'rect', x: 50, y: 100, width: 200, height: 40, pageId: 'p1', strokeColor: '#ef4444', strokeWidth: 2 };
  const ELLIPSE: ElementJSON = { id: 11, type: 'shape', shapeType: 'ellipse', x: 60, y: 120, width: 100, height: 80, pageId: 'p1', strokeColor: '#22c55e', strokeWidth: 3 };
  const ARROW: ElementJSON = { id: 12, type: 'shape', shapeType: 'arrow', x: 10, y: 20, width: 100, height: 50, pageId: 'p1', strokeColor: '#3b82f6', strokeWidth: 1.5, x1: 10, y1: 20, x2: 110, y2: 70 };
  const FREEHAND: ElementJSON = { id: 13, type: 'shape', shapeType: 'freehand', x: 5, y: 10, width: 90, height: 75, pageId: 'p1', strokeColor: '#000000', strokeWidth: 2, points: [{ x: 5, y: 85 }, { x: 50, y: 10 }, { x: 95, y: 40 }] };

  it('maps shape rect ↔ XFDF square (bbox + stroke) and back', () => {
    const a = elementToXfdfAnnot(RECT, 0, H);
    if (!a) throw new Error('expected a square annot');
    expect(a).toEqual({ type: 'square', page: 0, rect: [50, 660, 250, 700], color: '#ef4444', width: 2 });
    const el = xfdfAnnotToElement(a, 'p1', H);
    expect(el).toMatchObject({ type: 'shape', shapeType: 'rect', x: 50, y: 100, width: 200, height: 40, pageId: 'p1', strokeColor: '#ef4444', strokeWidth: 2 });
  });

  it('maps shape ellipse ↔ XFDF circle (bbox + stroke) and back', () => {
    const a = elementToXfdfAnnot(ELLIPSE, 1, H);
    if (!a) throw new Error('expected a circle annot');
    expect(a).toEqual({ type: 'circle', page: 1, rect: [60, 600, 160, 680], color: '#22c55e', width: 3 });
    const el = xfdfAnnotToElement(a, 'p1', H);
    expect(el).toMatchObject({ type: 'shape', shapeType: 'ellipse', x: 60, y: 120, width: 100, height: 80, pageId: 'p1', strokeColor: '#22c55e', strokeWidth: 3 });
  });

  it('maps shape arrow ↔ XFDF line (endpoints flipped) and back', () => {
    const a = elementToXfdfAnnot(ARROW, 0, H);
    if (!a) throw new Error('expected a line annot');
    // endpoints flip independently: y_user = H - y_display
    expect(a).toEqual({ type: 'line', page: 0, rect: [10, 730, 110, 780], color: '#3b82f6', width: 1.5, line: [10, 780, 110, 730] });
    const el = xfdfAnnotToElement(a, 'p1', H) as unknown as { shapeType: string; x1: number; y1: number; x2: number; y2: number; strokeColor: string };
    expect(el).toMatchObject({ type: 'shape', shapeType: 'arrow', strokeColor: '#3b82f6' });
    expect(el.x1).toBeCloseTo(10, 5); expect(el.y1).toBeCloseTo(20, 5);
    expect(el.x2).toBeCloseTo(110, 5); expect(el.y2).toBeCloseTo(70, 5);
  });

  it('maps shape freehand ↔ XFDF ink (points flipped) and back', () => {
    const a = elementToXfdfAnnot(FREEHAND, 0, H);
    if (!a) throw new Error('expected an ink annot');
    expect(a.type).toBe('ink');
    expect(a.inkList).toEqual([[5, 715, 50, 790, 95, 760]]);
    const el = xfdfAnnotToElement(a, 'p1', H) as unknown as { shapeType: string; points: Array<{ x: number; y: number }> };
    expect(el).toMatchObject({ type: 'shape', shapeType: 'freehand' });
    expect(el.points).toHaveLength(3);
    expect(el.points[0].x).toBeCloseTo(5, 5); expect(el.points[0].y).toBeCloseTo(85, 5);
    expect(el.points[1].x).toBeCloseTo(50, 5); expect(el.points[1].y).toBeCloseTo(10, 5);
    expect(el.points[2].x).toBeCloseTo(95, 5); expect(el.points[2].y).toBeCloseTo(40, 5);
  });
});

/**
 * WS5 — `pageHeightPt` had NO guard, and two defects behind that absence.
 *
 * The stub below MIMICS pdf.js: `viewBox` is rotation-invariant, `height` swaps with `width` at
 * 90/270, and an omitted `rotation` means the page's own `/Rotate`. A stub returning a fixed height
 * would make every case here pass while the bug stayed — the mistake this repo already had to
 * correct once in the redaction rotation guards.
 */
describe('pageHeightPt — frame correctness (WS5)', () => {
  const pageStub = (viewBox: number[], rotate: number) => ({
    getViewport: (o: { scale: number; rotation?: number }) => {
      const rot = o.rotation ?? rotate;
      const w = viewBox[2] - viewBox[0], h = viewBox[3] - viewBox[1];
      const swap = rot === 90 || rot === 270;
      return { width: swap ? h : w, height: swap ? w : h, viewBox };
    },
  });
  const srcs = (viewBox: number[], rotate = 0) =>
    new Map([['s1', { doc: { getPage: () => Promise.resolve(pageStub(viewBox, rotate)) } }]]);
  const page = { sourcePdfId: 's1', sourcePageNum: 1 } as unknown as DocumentPage;

  it('is unchanged on an unrotated page with a zero origin — the common case', async () => {
    expect(await pageHeightPt(page, srcs([0, 0, 595, 842]) as never)).toBe(842);
  });

  it('returns the UNROTATED top on a /Rotate 90 page, not the swapped dimension', async () => {
    // Without `rotation: 0` pdf.js applies the page's own /Rotate and hands back the WIDTH here,
    // so every exported annotation's y was flipped about the wrong number — and the docstring
    // claimed it "returns the FULL unrotated source height", which was simply false at 90/270.
    expect(await pageHeightPt(page, srcs([0, 0, 595, 842], 90) as never)).toBe(842);
    expect(await pageHeightPt(page, srcs([0, 0, 595, 842], 270) as never)).toBe(842);
  });

  it('carries the CropBox ORIGIN: an XFDF /Rect is absolute, so the flip is about viewBox[3]', async () => {
    // A page cropped to [50 50 350 350] is 300pt tall but its top is at absolute y=350. Flipping
    // about the HEIGHT put every annotation 50pt out — the same origin-vs-height confusion that
    // produced the redaction leak and the sign-rect displacement.
    expect(await pageHeightPt(page, srcs([50, 50, 350, 350]) as never)).toBe(350);
  });

  it('still reads a blank page height directly', async () => {
    const blank = { sourcePdfId: 'blank', blankHeight: 500 } as unknown as DocumentPage;
    expect(await pageHeightPt(blank, new Map() as never)).toBe(500);
  });
});

/**
 * WS7 round 1 — the y-axis fix left x crop-relative, so an exported `/Rect` was in a MIXED frame:
 * y absolute, x not. Worse than being consistently wrong, and it made the sibling docstring's claim
 * about the CropBox origin true of one axis only.
 */
describe('XFDF x axis carries the CropBox origin too (WS7)', () => {
  const el = { type: 'highlight', x: 10, y: 20, width: 30, height: 40, color: '#ffff00' } as unknown as ElementJSON;

  it('offsets the exported rect by the page LEFT edge', () => {
    // Page [50 50 350 350]: top = 350, left = 50. Display x 10 ⇒ absolute 60.
    const a = elementToXfdfAnnot(el, 0, 350, 50);
    expect(a?.rect[0]).toBe(60);
    expect(a?.rect[2]).toBe(90);
  });

  it('round-trips through import, so the annotation lands back where it started', () => {
    const a = elementToXfdfAnnot(el, 0, 350, 50);
    const back = xfdfAnnotToElement(a as never, 'p1', 350, 50) as unknown as { x: number; y: number };
    expect({ x: back.x, y: back.y }).toEqual({ x: 10, y: 20 });
  });

  it('offsets the ARROW endpoints and the INK points too, not just the rect', () => {
    // The round-1 fix reached `rect` only, leaving arrow `/L` and freehand `inkList` with
    // crop-relative x beside absolute y. Self-consistent internally, so the round-trip case above
    // cannot see it — the defect is what an external reader gets.
    const arrow = { type: 'shape', shapeType: 'arrow', x: 10, y: 20, width: 50, height: 0,
      x1: 10, y1: 20, x2: 60, y2: 20, strokeColor: '#ff0000' } as unknown as ElementJSON;
    const a = elementToXfdfAnnot(arrow, 0, 350, 50);
    expect(a?.line?.[0]).toBe(60);   // 10 + 50
    expect(a?.line?.[2]).toBe(110);  // 60 + 50
    expect(a?.rect[0]).toBe(60);     // and it agrees with the rect — one frame, not two

    const ink = { type: 'shape', shapeType: 'freehand', x: 10, y: 20, width: 10, height: 10,
      points: [{ x: 10, y: 20 }, { x: 20, y: 30 }], strokeColor: '#ff0000' } as unknown as ElementJSON;
    expect(elementToXfdfAnnot(ink, 0, 350, 50)?.inkList?.[0]?.[0]).toBe(60);
  });

  it('round-trips an arrow through the origin', () => {
    const arrow = { type: 'shape', shapeType: 'arrow', x: 10, y: 20, width: 50, height: 0,
      x1: 10, y1: 20, x2: 60, y2: 20, strokeColor: '#ff0000' } as unknown as ElementJSON;
    const back = xfdfAnnotToElement(elementToXfdfAnnot(arrow, 0, 350, 50) as never, 'p1', 350, 50) as unknown as { x1: number; x2: number };
    expect({ x1: back.x1, x2: back.x2 }).toEqual({ x1: 10, x2: 60 });
  });

  it('is unchanged on a zero-origin page — the identity control', () => {
    const a = elementToXfdfAnnot(el, 0, 842);
    expect(a?.rect[0]).toBe(10);
    const back = xfdfAnnotToElement(a as never, 'p1', 842) as unknown as { x: number };
    expect(back.x).toBe(10);
  });
});
