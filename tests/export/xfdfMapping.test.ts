/**
 * XFDF ↔ element-model mapping (#57). The codec (xfdf.ts) handles the XML; this
 * covers the coordinate flip (editor display space, top-left/y-down ↔ PDF user
 * space, bottom-left/y-up) and the type mapping. Round-trip through PDF user
 * space must preserve geometry and payload for the supported types.
 */
import { describe, it, expect } from 'vitest';
import { elementToXfdfAnnot, xfdfAnnotToElements, xfdfPageFrame, flipFrame, type XfdfFrame } from '../../src/export/xfdfMapping';
import type { XfdfAnnot } from '../../src/utils/xfdf';
import type { DocumentPage } from '../../src/core/documentModel';
import type { ElementJSON } from '../../src/elements/annotationElement';

const H = 800;
/** The unrotated flip every case below used before limits row 26 (a zero-origin, unturned page). */
const F = flipFrame(H);
const toEl = (a: XfdfAnnot, pageId: string, f: XfdfFrame = F) => xfdfAnnotToElements(a, pageId, f)[0];

const HIGHLIGHT: ElementJSON = { id: 1, type: 'highlight', x: 50, y: 100, width: 200, height: 20, pageId: 'p1', color: '#FFFF00', opacity: 0.4 };
const COMMENT: ElementJSON = { id: 2, type: 'comment', x: 300, y: 50, width: 24, height: 24, pageId: 'p1', color: '#FFFDE7', text: 'a note' };
const TEXT: ElementJSON = { id: 3, type: 'text', x: 10, y: 20, width: 150, height: 30, pageId: 'p1', color: '#000000', text: 'hi there', fontSize: 14 };

describe('XFDF element mapping (#57)', () => {
  it('flips a highlight to PDF user space and back without loss', () => {
    const a = elementToXfdfAnnot(HIGHLIGHT, 0, F);
    if (!a) throw new Error('expected a highlight annot');
    expect(a).toEqual({ type: 'highlight', page: 0, rect: [50, 680, 250, 700], color: '#FFFF00', opacity: 0.4,
      quads: [50, 700, 250, 700, 50, 680, 250, 680] });
    expect(toEl(a, 'p1')).toMatchObject({ type: 'highlight', x: 50, y: 100, width: 200, height: 20, pageId: 'p1', color: '#FFFF00', opacity: 0.4 });
  });

  it('maps a comment ↔ XFDF text (sticky note)', () => {
    const a = elementToXfdfAnnot(COMMENT, 2, F);
    if (!a) throw new Error('expected a text annot');
    expect(a).toEqual({ type: 'text', page: 2, rect: [300, 726, 324, 750], color: '#FFFDE7', contents: 'a note' });
    expect(toEl(a, 'pX')).toMatchObject({ type: 'comment', x: 300, y: 50, width: 24, height: 24, pageId: 'pX', text: 'a note' });
  });

  it('maps a text element ↔ XFDF freetext, preserving font size and body', () => {
    const a = elementToXfdfAnnot(TEXT, 0, F);
    if (!a) throw new Error('expected a freetext annot');
    expect(a).toEqual({ type: 'freetext', page: 0, rect: [10, 750, 160, 780], color: '#000000', contents: 'hi there', fontSize: 14 });
    expect(toEl(a, 'p1')).toMatchObject({ type: 'text', x: 10, y: 20, width: 150, height: 30, pageId: 'p1', text: 'hi there', fontSize: 14 });
  });

  // #QA-2026-06-23 P3 (#7): a foreign/malformed XFDF may carry an inverted rect
  // (urx<llx or ury<lly). xfdfAnnotToElements must normalize it to a positive-size
  // element at the correct top-left, not emit negative width/height.
  it('normalizes an inverted/negative-size rect to positive geometry', () => {
    const inverted = { type: 'highlight' as const, page: 0, rect: [250, 700, 50, 680] as [number, number, number, number], color: '#FFFF00', opacity: 0.4 };
    expect(toEl(inverted, 'p1')).toMatchObject({ type: 'highlight', x: 50, y: 100, width: 200, height: 20 });
  });

  it('returns null for unsupported element types (skipped, never mis-mapped)', () => {
    const sig: ElementJSON = { id: 9, type: 'signature', x: 0, y: 0, width: 10, height: 10, pageId: 'p1' };
    expect(elementToXfdfAnnot(sig, 0, F)).toBeNull();
  });
});

describe('XFDF shape mapping (G21)', () => {
  const RECT: ElementJSON = { id: 10, type: 'shape', shapeType: 'rect', x: 50, y: 100, width: 200, height: 40, pageId: 'p1', strokeColor: '#ef4444', strokeWidth: 2 };
  const ELLIPSE: ElementJSON = { id: 11, type: 'shape', shapeType: 'ellipse', x: 60, y: 120, width: 100, height: 80, pageId: 'p1', strokeColor: '#22c55e', strokeWidth: 3 };
  const ARROW: ElementJSON = { id: 12, type: 'shape', shapeType: 'arrow', x: 10, y: 20, width: 100, height: 50, pageId: 'p1', strokeColor: '#3b82f6', strokeWidth: 1.5, x1: 10, y1: 20, x2: 110, y2: 70 };
  const FREEHAND: ElementJSON = { id: 13, type: 'shape', shapeType: 'freehand', x: 5, y: 10, width: 90, height: 75, pageId: 'p1', strokeColor: '#000000', strokeWidth: 2, points: [{ x: 5, y: 85 }, { x: 50, y: 10 }, { x: 95, y: 40 }] };

  it('maps shape rect ↔ XFDF square (bbox + stroke) and back', () => {
    const a = elementToXfdfAnnot(RECT, 0, F);
    if (!a) throw new Error('expected a square annot');
    expect(a).toEqual({ type: 'square', page: 0, rect: [50, 660, 250, 700], color: '#ef4444', width: 2 });
    const el = toEl(a, 'p1');
    expect(el).toMatchObject({ type: 'shape', shapeType: 'rect', x: 50, y: 100, width: 200, height: 40, pageId: 'p1', strokeColor: '#ef4444', strokeWidth: 2 });
  });

  it('maps shape ellipse ↔ XFDF circle (bbox + stroke) and back', () => {
    const a = elementToXfdfAnnot(ELLIPSE, 1, F);
    if (!a) throw new Error('expected a circle annot');
    expect(a).toEqual({ type: 'circle', page: 1, rect: [60, 600, 160, 680], color: '#22c55e', width: 3 });
    const el = toEl(a, 'p1');
    expect(el).toMatchObject({ type: 'shape', shapeType: 'ellipse', x: 60, y: 120, width: 100, height: 80, pageId: 'p1', strokeColor: '#22c55e', strokeWidth: 3 });
  });

  it('maps shape arrow ↔ XFDF line (endpoints flipped) and back', () => {
    const a = elementToXfdfAnnot(ARROW, 0, F);
    if (!a) throw new Error('expected a line annot');
    // endpoints flip independently: y_user = H - y_display
    expect(a).toEqual({ type: 'line', page: 0, rect: [10, 730, 110, 780], color: '#3b82f6', width: 1.5, line: [10, 780, 110, 730] });
    const el = toEl(a, 'p1') as unknown as { shapeType: string; x1: number; y1: number; x2: number; y2: number; strokeColor: string };
    expect(el).toMatchObject({ type: 'shape', shapeType: 'arrow', strokeColor: '#3b82f6' });
    expect(el.x1).toBeCloseTo(10, 5); expect(el.y1).toBeCloseTo(20, 5);
    expect(el.x2).toBeCloseTo(110, 5); expect(el.y2).toBeCloseTo(70, 5);
  });

  it('maps shape freehand ↔ XFDF ink (points flipped) and back', () => {
    const a = elementToXfdfAnnot(FREEHAND, 0, F);
    if (!a) throw new Error('expected an ink annot');
    expect(a.type).toBe('ink');
    expect(a.inkList).toEqual([[5, 715, 50, 790, 95, 760]]);
    const el = toEl(a, 'p1') as unknown as { shapeType: string; points: Array<{ x: number; y: number }> };
    expect(el).toMatchObject({ type: 'shape', shapeType: 'freehand' });
    expect(el.points).toHaveLength(3);
    expect(el.points[0].x).toBeCloseTo(5, 5); expect(el.points[0].y).toBeCloseTo(85, 5);
    expect(el.points[1].x).toBeCloseTo(50, 5); expect(el.points[1].y).toBeCloseTo(10, 5);
    expect(el.points[2].x).toBeCloseTo(95, 5); expect(el.points[2].y).toBeCloseTo(40, 5);
  });
});

/**
 * WS5 → limits row 26. WS5 pinned `pageHeightPt`: the flip had to be about the UNROTATED top (not the swapped
 * dimension pdf.js hands back at /Rotate 90/270) and about viewBox[3] (the CropBox origin), not the height.
 * `pageHeightPt` is gone — the frame replaced the flip — and these are its successors, asserted through
 * `xfdfPageFrame`, which must keep both properties while ALSO turning by the page's rotation (D18).
 *
 * The stub's viewport is pdf.js's own `PageViewport` transform (pdf.mjs:810, 6.3.289, which does not export the
 * class), so the frame is exercised against pdf.js's conventions rather than a copy of the code under test. The
 * independent check — pixels on a real render — is `tests/browser/xfdf-frame.browser.test.ts`.
 */
function pdfjsViewport(viewBox: number[], scale: number, rotation: number) {
  const cx = (viewBox[2] + viewBox[0]) / 2, cy = (viewBox[3] + viewBox[1]) / 2;
  const r = ((rotation % 360) + 360) % 360;
  const [a, b, c, d] = r === 180 ? [-1, 0, 0, 1] : r === 90 ? [0, 1, 1, 0] : r === 270 ? [0, -1, -1, 0] : [1, 0, 0, -1];
  const ox = a === 0 ? Math.abs(cy - viewBox[1]) * scale : Math.abs(cx - viewBox[0]) * scale;
  const oy = a === 0 ? Math.abs(cx - viewBox[0]) * scale : Math.abs(cy - viewBox[1]) * scale;
  const t = [a * scale, b * scale, c * scale, d * scale, ox - a * scale * cx - c * scale * cy, oy - b * scale * cx - d * scale * cy];
  const w = (viewBox[2] - viewBox[0]) * scale, h = (viewBox[3] - viewBox[1]) * scale;
  return {
    viewBox, width: a === 0 ? h : w, height: a === 0 ? w : h,
    convertToViewportPoint: (x: number, y: number) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]],
    convertToPdfPoint: (x: number, y: number) => {
      const det = t[0] * t[3] - t[1] * t[2];
      return [(x * t[3] - y * t[2] + t[2] * t[5] - t[4] * t[3]) / det, (-x * t[1] + y * t[0] + t[4] * t[1] - t[5] * t[0]) / det];
    },
  };
}

describe('xfdfPageFrame — the successors of the WS5 pageHeightPt pins (limits row 26)', () => {
  const pageStub = (viewBox: number[], rotate: number) => ({
    rotate,
    // pdf.js: an omitted `rotation` means the page's own /Rotate; a given one REPLACES it.
    getViewport: (o: { scale: number; rotation?: number }) => pdfjsViewport(viewBox, o.scale, o.rotation ?? rotate),
  });
  const srcs = (viewBox: number[], rotate = 0) =>
    new Map([['s1', { doc: { getPage: () => Promise.resolve(pageStub(viewBox, rotate)) } }]]);
  const page = (rotation = 0) => ({ sourcePdfId: 's1', sourcePageNum: 1, rotation }) as unknown as DocumentPage;
  const user = (f: XfdfFrame, x: number, y: number) => f.toUser(x, y).map(v => Math.round(v * 1e6) / 1e6 + 0);

  it('is the plain flip on an unrotated page with a zero origin — the common case', async () => {
    const f = await xfdfPageFrame(page(), srcs([0, 0, 595, 842]) as never);
    expect(user(f, 10, 20)).toEqual([10, 822]);
    expect(f.rotation).toBe(0);
  });

  it('carries the CropBox ORIGIN on both axes: an XFDF /Rect is absolute', async () => {
    // WS5: the flip is about viewBox[3] (350), not the height (300); WS7: x carries the left edge too.
    const f = await xfdfPageFrame(page(), srcs([50, 50, 350, 350]) as never);
    expect(user(f, 10, 20)).toEqual([60, 330]);
  });

  it('on a /Rotate 90 page the display top-left is user (0,0) and display x runs up user y', async () => {
    // Shown turned 90° clockwise, the page's user-space origin (bottom-left) is at the display top-left.
    const f = await xfdfPageFrame(page(), srcs([0, 0, 595, 842], 90) as never);
    expect(user(f, 0, 0)).toEqual([0, 0]);
    expect(user(f, 100, 0)).toEqual([0, 100]);
    expect(user(f, 0, 30)).toEqual([30, 0]);
    expect(f.rotation).toBe(90);
  });

  it('adds the USER rotation to /Rotate — pdf.js rotation replaces /Rotate, so the sum is passed once', async () => {
    const f = await xfdfPageFrame(page(90), srcs([0, 0, 595, 842], 90) as never);
    expect(f.rotation).toBe(180);
    expect(user(f, 0, 0)).toEqual([595, 0]);
  });

  it('round-trips every rotation: toDisplay(toUser(p)) === p', async () => {
    for (const rot of [0, 90, 180, 270]) {
      const f = await xfdfPageFrame(page(), srcs([30, 70, 330, 310], rot) as never);
      const [u, v] = f.toUser(12, 34);
      const [x, y] = f.toDisplay(u, v);
      expect([x, y].map(n => Math.round(n * 1e6) / 1e6)).toEqual([12, 34]);
    }
  });

  it('still reads a blank page height directly', async () => {
    const blank = { sourcePdfId: 'blank', blankHeight: 500 } as unknown as DocumentPage;
    const f = await xfdfPageFrame(blank, new Map() as never);
    expect(f.toUser(10, 20)).toEqual([10, 480]);
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
    const a = elementToXfdfAnnot(el, 0, flipFrame(350, 50));
    expect(a?.rect[0]).toBe(60);
    expect(a?.rect[2]).toBe(90);
  });

  it('round-trips through import, so the annotation lands back where it started', () => {
    const a = elementToXfdfAnnot(el, 0, flipFrame(350, 50));
    const back = toEl(a as never, 'p1', flipFrame(350, 50)) as unknown as { x: number; y: number };
    expect({ x: back.x, y: back.y }).toEqual({ x: 10, y: 20 });
  });

  it('offsets the ARROW endpoints and the INK points too, not just the rect', () => {
    // The round-1 fix reached `rect` only, leaving arrow `/L` and freehand `inkList` with
    // crop-relative x beside absolute y. Self-consistent internally, so the round-trip case above
    // cannot see it — the defect is what an external reader gets.
    const arrow = { type: 'shape', shapeType: 'arrow', x: 10, y: 20, width: 50, height: 0,
      x1: 10, y1: 20, x2: 60, y2: 20, strokeColor: '#ff0000' } as unknown as ElementJSON;
    const a = elementToXfdfAnnot(arrow, 0, flipFrame(350, 50));
    expect(a?.line?.[0]).toBe(60);   // 10 + 50
    expect(a?.line?.[2]).toBe(110);  // 60 + 50
    expect(a?.rect[0]).toBe(60);     // and it agrees with the rect — one frame, not two

    const ink = { type: 'shape', shapeType: 'freehand', x: 10, y: 20, width: 10, height: 10,
      points: [{ x: 10, y: 20 }, { x: 20, y: 30 }], strokeColor: '#ff0000' } as unknown as ElementJSON;
    expect(elementToXfdfAnnot(ink, 0, flipFrame(350, 50))?.inkList?.[0]?.[0]).toBe(60);
  });

  it('round-trips an arrow through the origin', () => {
    const arrow = { type: 'shape', shapeType: 'arrow', x: 10, y: 20, width: 50, height: 0,
      x1: 10, y1: 20, x2: 60, y2: 20, strokeColor: '#ff0000' } as unknown as ElementJSON;
    const back = toEl(elementToXfdfAnnot(arrow, 0, flipFrame(350, 50)) as never, 'p1', flipFrame(350, 50)) as unknown as { x1: number; x2: number };
    expect({ x1: back.x1, x2: back.x2 }).toEqual({ x1: 10, x2: 60 });
  });

  it('is unchanged on a zero-origin page — the identity control', () => {
    const a = elementToXfdfAnnot(el, 0, flipFrame(842));
    expect(a?.rect[0]).toBe(10);
    const back = toEl(a as never, 'p1', flipFrame(842)) as unknown as { x: number };
    expect(back.x).toBe(10);
  });
});
