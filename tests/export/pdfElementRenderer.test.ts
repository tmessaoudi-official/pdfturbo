/**
 * M2 #23 — coverage win for the export element renderer.
 *
 * The #13 browser pixel tests (tests/browser/pdfElementRenderer.browser.test.ts)
 * cover redaction / highlight / image / shape-rect by rasterizing real output.
 * They do NOT cover the remaining branches. These jsdom tests pin the per-type
 * draw calls via a recording mock page — no canvas, no font fetch — so the
 * Record<ElementType, renderFn> dispatch extraction is behavior-guarded:
 *   - shape arrow   → 3 drawLine (shaft + 2 head strokes)
 *   - shape ellipse → 1 drawEllipse with the right half-axes
 *   - shape freehand→ 1 drawSvgPath (M…L…), and <2 points draws nothing
 *   - comment       → drawRectangle, plus drawText only when text is present
 *   - dispatch      → EVERY ElementType routes to a renderer that draws
 * The Arabic text path needs a real font fetch and is covered in the browser file.
 */
import { describe, it, expect } from 'vitest';
import { renderElementToPdfLib, _rotateInElementSpace, type PdfRenderCtx } from '../../src/export/pdfElementRenderer';
import type { PDFElement } from '../../src/elements/annotationElement';

interface DrawCall { method: string; args: unknown[]; }

function makeRecordingCtx(totalRot = 0): { ctx: PdfRenderCtx; calls: DrawCall[] } {
  const calls: DrawCall[] = [];
  const rec = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
  const page = {
    drawText: rec('drawText'),
    drawImage: rec('drawImage'),
    drawRectangle: rec('drawRectangle'),
    drawLine: rec('drawLine'),
    drawEllipse: rec('drawEllipse'),
    drawSvgPath: rec('drawSvgPath'),
    pushOperators: rec('pushOperators'),
  };
  const pdfDoc = {
    embedFont: () => Promise.resolve({ widthOfTextAtSize: () => 10 }),
    embedPng: () => Promise.resolve({}),
    embedJpg: () => Promise.resolve({}),
  };
  const libs = {
    rgb: (r: number, g: number, b: number) => ({ r, g, b }),
    StandardFonts: {
      Helvetica: 'Helvetica', HelveticaBold: 'HelveticaBold',
      HelveticaOblique: 'HelveticaOblique', HelveticaBoldOblique: 'HelveticaBoldOblique',
      TimesRoman: 'TimesRoman', Courier: 'Courier',
    },
    degrees: (d: number) => ({ deg: d }),
  };
  const ctx = {
    pdfDoc, page, libs,
    h: 200, w: 200, W_orig: 200, H_orig: 200,
    totalRot, cropOriginX: 0, cropOriginY: 0,
  } as unknown as PdfRenderCtx;
  return { ctx, calls };
}

const el = <T extends object>(o: T): PDFElement => o as unknown as PDFElement;
const of = (calls: DrawCall[], m: string) => calls.filter(c => c.method === m);

describe('renderElementToPdfLib — branch coverage (M2 #23)', () => {
  it('shape arrow draws three lines (shaft + two arrowhead strokes)', async () => {
    const { ctx, calls } = makeRecordingCtx();
    await renderElementToPdfLib(el({
      type: 'shape', shapeType: 'arrow', x: 10, y: 10, width: 80, height: 0,
      x1: 10, y1: 10, x2: 90, y2: 10, strokeColor: '#000000', strokeWidth: 2, rotation: 0,
    }), ctx);
    expect(of(calls, 'drawLine')).toHaveLength(3);
    expect(of(calls, 'drawEllipse')).toHaveLength(0);
  });

  it('shape ellipse draws one ellipse with width/2 and height/2 half-axes', async () => {
    const { ctx, calls } = makeRecordingCtx();
    await renderElementToPdfLib(el({
      type: 'shape', shapeType: 'ellipse', x: 10, y: 10, width: 80, height: 40,
      strokeColor: '#000000', strokeWidth: 2, rotation: 0,
    }), ctx);
    const ell = of(calls, 'drawEllipse');
    expect(ell).toHaveLength(1);
    const opts = ell[0].args[0] as { xScale: number; yScale: number };
    expect(opts.xScale).toBe(40);
    expect(opts.yScale).toBe(20);
  });

  it('shape freehand draws one SVG path (M…L…) and respects fewer-than-2 points', async () => {
    const { ctx, calls } = makeRecordingCtx();
    await renderElementToPdfLib(el({
      type: 'shape', shapeType: 'freehand', x: 10, y: 10, width: 20, height: 10,
      points: [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 15 }],
      strokeColor: '#000000', strokeWidth: 2, rotation: 0,
    }), ctx);
    const paths = of(calls, 'drawSvgPath');
    expect(paths).toHaveLength(1);
    const d = paths[0].args[0] as string;
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain(' L ');

    const { ctx: ctx2, calls: calls2 } = makeRecordingCtx();
    await renderElementToPdfLib(el({
      type: 'shape', shapeType: 'freehand', x: 10, y: 10, width: 0, height: 0,
      points: [{ x: 10, y: 10 }], strokeColor: '#000000', strokeWidth: 2, rotation: 0,
    }), ctx2);
    expect(of(calls2, 'drawSvgPath')).toHaveLength(0);
  });

  it('comment draws a backing rectangle and its text when present', async () => {
    const { ctx, calls } = makeRecordingCtx();
    await renderElementToPdfLib(el({
      type: 'comment', x: 10, y: 10, width: 100, height: 60,
      color: '#FFFDE7', text: 'Hello note', rotation: 0,
    }), ctx);
    expect(of(calls, 'drawRectangle')).toHaveLength(1);
    const txt = of(calls, 'drawText');
    expect(txt).toHaveLength(1);
    expect(txt[0].args[0]).toBe('Hello note');
  });

  it('text underline + strikethrough draw two rule lines; plain text draws none (Workstream C)', async () => {
    const base = {
      type: 'text', x: 10, y: 10, width: 200, height: 30, text: 'hi',
      fontSize: 14, color: '#000000', fontFamily: 'Arial', bold: false, italic: false, align: 'left', rotation: 0,
    };
    const { ctx, calls } = makeRecordingCtx();
    await renderElementToPdfLib(el({ ...base, underline: true, strikethrough: true }), ctx);
    expect(of(calls, 'drawText')).toHaveLength(1);
    expect(of(calls, 'drawLine')).toHaveLength(2);

    const { ctx: c2, calls: k2 } = makeRecordingCtx();
    await renderElementToPdfLib(el({ ...base, underline: false, strikethrough: false }), c2);
    expect(of(k2, 'drawLine')).toHaveLength(0);
  });

  it('text alignment shifts the draw origin (left vs right differ)', async () => {
    const base = {
      type: 'text', x: 10, y: 10, width: 200, height: 30, text: 'hi',
      fontSize: 14, color: '#000000', fontFamily: 'Arial', bold: false, italic: false, underline: false, strikethrough: false, rotation: 0,
    };
    const { ctx, calls } = makeRecordingCtx();
    await renderElementToPdfLib(el({ ...base, align: 'left' }), ctx);
    const { ctx: c2, calls: k2 } = makeRecordingCtx();
    await renderElementToPdfLib(el({ ...base, align: 'right' }), c2);
    const lx = (of(calls, 'drawText')[0].args[1] as { x: number }).x;
    const rx = (of(k2, 'drawText')[0].args[1] as { x: number }).x;
    expect(Math.abs(rx - lx)).toBeGreaterThan(0);
  });

  it('comment with empty text draws only the rectangle (no drawText)', async () => {
    const { ctx, calls } = makeRecordingCtx();
    await renderElementToPdfLib(el({
      type: 'comment', x: 10, y: 10, width: 100, height: 60, color: '#FFFDE7', text: '', rotation: 0,
    }), ctx);
    expect(of(calls, 'drawRectangle')).toHaveLength(1);
    expect(of(calls, 'drawText')).toHaveLength(0);
  });

  // G4 — vector export must bake the element's own rotation for arrow & freehand
  // (rect/ellipse/text/image already do, via pdfRotVal/anchorForCenter). The on-screen
  // overlay rotates the element box clockwise about its center (elementLayerRenderer.ts:
  // `transform: rotate(${rotation}deg)` + `transform-origin: center center`). These
  // assert the same rotation lands in the exported draw-call coordinates.
  it('_rotateInElementSpace rotates a point clockwise about the pivot (y-down)', () => {
    // unrotated → identity
    expect(_rotateInElementSpace(60, 50, 50, 50, 0)).toEqual({ x: 60, y: 50 });
    // 90° CW about (50,50): a point 10 to the RIGHT lands 10 BELOW (y-down ⇒ clockwise)
    const r90 = _rotateInElementSpace(60, 50, 50, 50, 90);
    expect(r90.x).toBeCloseTo(50, 6);
    expect(r90.y).toBeCloseTo(60, 6);
    // 180° about center: point reflects through the pivot
    const r180 = _rotateInElementSpace(60, 50, 50, 50, 180);
    expect(r180.x).toBeCloseTo(40, 6);
    expect(r180.y).toBeCloseTo(50, 6);
  });

  it('shape arrow bakes element rotation into the shaft endpoints (rotation:90)', async () => {
    const { ctx, calls } = makeRecordingCtx(); // totalRot=0 ⇒ tp(px,py)={x:px, y:200-py}
    // bbox center (50,10); endpoints (10,10)&(90,10) rotate 90°CW → (50,-30)&(50,50)
    // then tp → start {x:50,y:230}, end {x:50,y:150}. Un-rotated would be x:10/x:90.
    await renderElementToPdfLib(el({
      type: 'shape', shapeType: 'arrow', x: 10, y: 10, width: 80, height: 0,
      x1: 10, y1: 10, x2: 90, y2: 10, strokeColor: '#000000', strokeWidth: 2, rotation: 90,
    }), ctx);
    const shaft = of(calls, 'drawLine')[0].args[0] as {
      start: { x: number; y: number }; end: { x: number; y: number };
    };
    expect(shaft.start.x).toBeCloseTo(50, 4);
    expect(shaft.start.y).toBeCloseTo(230, 4);
    expect(shaft.end.x).toBeCloseTo(50, 4);
    expect(shaft.end.y).toBeCloseTo(150, 4);
  });

  it('shape freehand bakes element rotation into the SVG path points (rotation:90)', async () => {
    const { ctx, calls } = makeRecordingCtx(); // totalRot=0
    // bbox center (20,15); first point (10,10) rotates 90°CW → (25,5), tp → {x:25,y:195},
    // SVG y-flip Ho-y = 200-195 = 5 ⇒ path starts "M 25 5". Un-rotated would be "M 10 10".
    await renderElementToPdfLib(el({
      type: 'shape', shapeType: 'freehand', x: 10, y: 10, width: 20, height: 10,
      points: [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 15 }],
      strokeColor: '#000000', strokeWidth: 2, rotation: 90,
    }), ctx);
    const d = of(calls, 'drawSvgPath')[0].args[0] as string;
    expect(d.startsWith('M 25 5')).toBe(true);
    expect(d).not.toContain('M 10 10');
  });

  it('routes every ElementType to a renderer that draws something', async () => {
    const jpg = 'data:image/jpeg;base64,eA=='; // dodges the new Image() PNG path (browser-only)
    const fixtures: Record<string, object> = {
      text:      { type: 'text', x: 10, y: 10, width: 80, height: 20, text: 'hi', fontFamily: 'Arial', fontSize: 12, color: '#000000', bold: false, italic: false, rotation: 0 },
      signature: { type: 'signature', x: 10, y: 10, width: 60, height: 30, data: jpg, rotation: 0 },
      image:     { type: 'image', x: 10, y: 10, width: 60, height: 60, src: jpg, rotation: 0 },
      code:      { type: 'code', x: 10, y: 10, width: 60, height: 60, cachedDataUrl: jpg, rotation: 0 },
      highlight: { type: 'highlight', x: 10, y: 10, width: 60, height: 20, color: '#ffff00', opacity: 0.4, rotation: 0 },
      shape:     { type: 'shape', shapeType: 'rect', x: 10, y: 10, width: 60, height: 20, strokeColor: '#000000', strokeWidth: 1, rotation: 0 },
      comment:   { type: 'comment', x: 10, y: 10, width: 60, height: 40, color: '#FFFDE7', text: 'c', rotation: 0 },
      redaction: { type: 'redaction', x: 10, y: 10, width: 60, height: 20, color: '#000000', rotation: 0 },
    };
    for (const [type, fixture] of Object.entries(fixtures)) {
      const { ctx, calls } = makeRecordingCtx();
      await renderElementToPdfLib(el(fixture), ctx);
      expect(calls.length, `ElementType '${type}' produced no draw calls`).toBeGreaterThan(0);
    }
  });
});
