/**
 * XFDF ↔ element-model mapping (#57). Bridges the app's annotation elements
 * (editor DISPLAY space: points at scale 1, top-left origin, y-DOWN) and the
 * normalised XFDF record (PDF USER space: points, bottom-left origin, y-UP).
 * The XML itself is handled by utils/xfdf; this is the geometry + type bridge.
 *
 * Supported both ways: highlight ↔ <highlight>, comment ↔ <text> (sticky note),
 * text ↔ <freetext>, and the shape subtypes (G21) rect ↔ <square>, ellipse ↔
 * <circle>, arrow ↔ <line>, freehand ↔ <ink>. Other element/annotation types
 * return null (skipped, never mis-mapped) — see the #57b ceiling in utils/xfdf.
 *
 * Every coordinate goes through the page's {@link XfdfFrame} (limits row 26, D18). Until then the module
 * flipped y about the page top and shifted x by the CropBox origin, with no un-rotation anywhere, so on a
 * page shown turned (its own `/Rotate`, or the user's rotate button) every exported annotation sat in the
 * wrong place for any other reader. PDFturbo's own round-trip was self-consistent, which is why it survived.
 */
import type { XfdfAnnot } from '../utils/xfdf';
import type { ElementJSON, PDFElement } from '../elements/annotationElement';
import { HighlightElement } from '../elements/highlightElement';
import { CommentElement } from '../elements/commentElement';
import { TextElement } from '../elements/textElement';
import { ShapeElement, type ShapeType } from '../elements/shapeElement';
import type { DocumentPage } from '../core/documentModel';
import { pointViewport } from '../utils/pointViewport';

/** App `shape` subtype ↔ XFDF annotation tag (G21). */
const SHAPE_TO_XFDF: Record<ShapeType, 'square' | 'circle' | 'line' | 'ink'> = {
  rect: 'square', ellipse: 'circle', arrow: 'line', freehand: 'ink',
};

/**
 * How one page's editor DISPLAY space (points at scale 1, top-left, y-down, turned by the page's total
 * rotation) maps to the absolute PDF USER space an XFDF record is written in (y-up) — POINT by point, because
 * an arrow and an ink path carry direction that an AABB would destroy (limits row 26, D18).
 */
export interface XfdfFrame {
  toUser(x: number, y: number): [number, number];
  toDisplay(u: number, v: number): [number, number];
  /** Degrees (clockwise) the page is displayed turned by; 0 on a blank page. */
  rotation: number;
}

/** The unrotated flip: display y-down about `pageTop`, x shifted by `pageLeft`. A blank page's frame. */
export function flipFrame(pageTop: number, pageLeft = 0): XfdfFrame {
  return {
    toUser: (x, y) => [x + pageLeft, pageTop - y],
    toDisplay: (u, v) => [u - pageLeft, pageTop - v],
    rotation: 0,
  };
}

interface ViewportLike {
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

/**
 * A frame from the very viewport the editor renders the page with (`pointViewport` at scale 1 and the page's
 * total rotation): pdf.js's own point conversions, which carry the rotation, the CropBox origin and the
 * `/UserUnit` together — so no second copy of any of them exists here to drift.
 */
export function viewportFrame(vp: ViewportLike, rotation: number): XfdfFrame {
  return {
    toUser: (x, y) => { const [u, v] = vp.convertToPdfPoint(x, y); return [u, v]; },
    toDisplay: (u, v) => { const [x, y] = vp.convertToViewportPoint(u, v); return [x, y]; },
    rotation,
  };
}

type Rect4 = [number, number, number, number];

/** A display rect → the user-space AABB of its four corners. */
function rectToUser(f: XfdfFrame, x: number, y: number, w: number, h: number): Rect4 {
  const pts = [f.toUser(x, y), f.toUser(x + w, y), f.toUser(x, y + h), f.toUser(x + w, y + h)];
  const us = pts.map(p => p[0]), vs = pts.map(p => p[1]);
  return [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)];
}

/** A user-space rect (corners in any order) → the display AABB of its four corners. */
function rectToDisplay(f: XfdfFrame, r: readonly number[]): { x: number; y: number; w: number; h: number } {
  const [u1, v1, u2, v2] = r;
  const pts = [f.toDisplay(u1, v1), f.toDisplay(u2, v1), f.toDisplay(u1, v2), f.toDisplay(u2, v2)];
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Map one element record → an XFDF annotation in PDF user space, or null when
 * the type has no clean XFDF equivalent. `frame` maps this page's display space
 * to user space; `pageIndex` is the 0-based document page index.
 */
export function elementToXfdfAnnot(el: ElementJSON, pageIndex: number, frame: XfdfFrame): XfdfAnnot | null {
  const x = el.x, y = el.y, w = el.width, h = el.height;
  const rect = rectToUser(frame, x, y, w, h);
  const color = el.color as string | undefined;
  if (el.type === 'highlight') {
    // QuadPoints in the TL,TR,BL,BR order of the text as the user sees it — mapped point by point, so on a
    // turned page "top" is still the side the reader reads as the top.
    const quads = [frame.toUser(x, y), frame.toUser(x + w, y), frame.toUser(x, y + h), frame.toUser(x + w, y + h)].flat();
    const a: XfdfAnnot = { type: 'highlight', page: pageIndex, rect, quads };
    if (color) a.color = color;
    if (typeof el.opacity === 'number') a.opacity = el.opacity;
    return a;
  }
  if (el.type === 'comment') {
    const a: XfdfAnnot = { type: 'text', page: pageIndex, rect, contents: (el.text as string) ?? '' };
    if (color) a.color = color;
    return a;
  }
  if (el.type === 'text') {
    const a: XfdfAnnot = { type: 'freetext', page: pageIndex, rect, contents: (el.text as string) ?? '' };
    if (color) a.color = color;
    if (typeof el.fontSize === 'number') a.fontSize = el.fontSize;
    // Text the user typed upright on a turned page runs along the display, not along user-space x. Acrobat
    // records that as the free text's rotation [Unverified against Acrobat — in the row 29 pack].
    if (frame.rotation) a.rotation = frame.rotation;
    return a;
  }
  if (el.type === 'shape') {
    const shapeType = el.shapeType as ShapeType | undefined;
    if (!shapeType || !(shapeType in SHAPE_TO_XFDF)) return null;
    const stroke = el.strokeColor as string | undefined;
    const a: XfdfAnnot = { type: SHAPE_TO_XFDF[shapeType], page: pageIndex, rect };
    if (stroke) a.color = stroke;
    if (typeof el.strokeWidth === 'number') a.width = el.strokeWidth;
    if (shapeType === 'arrow') {
      // Endpoints map one by one — direction survives, which an AABB would not keep.
      const [u1, v1] = frame.toUser(el.x1 as number, el.y1 as number);
      const [u2, v2] = frame.toUser(el.x2 as number, el.y2 as number);
      a.line = [u1, v1, u2, v2];
    } else if (shapeType === 'freehand') {
      const points = (el.points as Array<{ x: number; y: number }> | undefined) ?? [];
      a.inkList = [points.flatMap(p => frame.toUser(p.x, p.y))];
    }
    return a;
  }
  return null;
}

/**
 * Construct the annotation elements (auto-assigned ids) for an XFDF record — one per highlight quad, one
 * otherwise, none for an unsupported subtype. `frame` maps user space back to this page's display space;
 * `pageId` is the target document page's id.
 */
export function xfdfAnnotToElements(a: XfdfAnnot, pageId: string, frame: XfdfFrame): PDFElement[] {
  // The four-corner mapping also normalises a rect a foreign/malformed XFDF stored inverted
  // (#QA-2026-06-23 P3 #7), which would otherwise yield a negative-size element.
  const { x, y, w, h } = rectToDisplay(frame, a.rect);
  if (a.type === 'highlight') {
    // A multi-line highlight is several quads; each becomes its own highlight (the app's highlight is one box).
    const q = a.quads ?? [];
    if (q.length >= 8) {
      const out: PDFElement[] = [];
      for (let i = 0; i + 8 <= q.length; i += 8) {
        const pts = [0, 2, 4, 6].map(k => frame.toDisplay(q[i + k], q[i + k + 1]));
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        const qx = Math.min(...xs), qy = Math.min(...ys);
        out.push(new HighlightElement(qx, qy, Math.max(...xs) - qx, Math.max(...ys) - qy, pageId, a.color ?? '#FFFF00', a.opacity ?? 0.3));
      }
      return out;
    }
    return [new HighlightElement(x, y, w, h, pageId, a.color ?? '#FFFF00', a.opacity ?? 0.3)];
  }
  if (a.type === 'text') {
    const el = new CommentElement(x, y, pageId, { color: a.color, text: a.contents });
    el.width = w; el.height = h;
    return [el];
  }
  if (a.type === 'freetext') {
    const el = new TextElement(x, y, pageId, { width: w, height: h, fontSize: a.fontSize, color: a.color });
    el.text = a.contents ?? '';
    return [el];
  }
  if (a.type === 'square' || a.type === 'circle') {
    const shapeType: ShapeType = a.type === 'square' ? 'rect' : 'ellipse';
    return [new ShapeElement(shapeType, x, y, w, h, pageId, { strokeColor: a.color, strokeWidth: a.width })];
  }
  if (a.type === 'line') {
    const ln = a.line ?? a.rect;
    const [ex1, ey1] = frame.toDisplay(ln[0], ln[1]);
    const [ex2, ey2] = frame.toDisplay(ln[2], ln[3]);
    const bx = Math.min(ex1, ex2), by = Math.min(ey1, ey2);
    const bw = Math.abs(ex2 - ex1), bh = Math.abs(ey2 - ey1);
    return [new ShapeElement('arrow', bx, by, bw, bh, pageId,
      { strokeColor: a.color, strokeWidth: a.width, x1: ex1, y1: ey1, x2: ex2, y2: ey2 })];
  }
  if (a.type === 'ink') {
    const points: Array<{ x: number; y: number }> = [];
    for (const path of a.inkList ?? []) {
      for (let i = 0; i + 1 < path.length; i += 2) {
        const [px, py] = frame.toDisplay(path[i], path[i + 1]);
        points.push({ x: px, y: py });
      }
    }
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const bx = xs.length ? Math.min(...xs) : 0, by = ys.length ? Math.min(...ys) : 0;
    const bw = xs.length ? Math.max(...xs) - bx : 0, bh = ys.length ? Math.max(...ys) - by : 0;
    return [new ShapeElement('freehand', bx, by, bw, bh, pageId,
      { strokeColor: a.color, strokeWidth: a.width, points })];
  }
  return [];
}

type SourcePdfsLike = Map<string, {
  doc: {
    getPage(n: number): Promise<{
      rotate?: number;
      userUnit?: number;
      getViewport(o: { scale: number; rotation?: number }): ViewportLike & { height: number; viewBox: readonly number[] };
    }>;
  };
}>;

/**
 * The frame of one document page (limits row 26, D18). A source page is displayed turned by its own `/Rotate`
 * plus the user's rotation — the `totalRot` of `pageRenderPipeline` — and pdf.js's `rotation` REPLACES
 * `/Rotate`, so the sum is passed, never added again. A blank page is drawn unrotated in the editor and the
 * export alike, so it takes the plain flip about its height.
 *
 * The user's crop (`docPage.crop`) takes no part: elements live in the full page's display space (the crop is
 * a frame drawn over it) and `setCropBox` does not move user space.
 */
export async function xfdfPageFrame(docPage: DocumentPage, sourcePdfs: SourcePdfsLike): Promise<XfdfFrame> {
  if (docPage.sourcePdfId === 'blank') return flipFrame(docPage.blankHeight ?? 842);
  const src = sourcePdfs.get(docPage.sourcePdfId);
  if (!src) return flipFrame(docPage.blankHeight ?? 842);
  const page = await src.doc.getPage(docPage.sourcePageNum);
  const totalRot = ((((page.rotate ?? 0) + (docPage.rotation ?? 0)) % 360) + 360) % 360;
  return viewportFrame(pointViewport(page, { scale: 1, rotation: totalRot }), totalRot);
}
