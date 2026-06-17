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
 */
import type { XfdfAnnot } from '../utils/xfdf';
import type { ElementJSON, PDFElement } from '../elements/annotationElement';
import { HighlightElement } from '../elements/highlightElement';
import { CommentElement } from '../elements/commentElement';
import { TextElement } from '../elements/textElement';
import { ShapeElement, type ShapeType } from '../elements/shapeElement';
import type { DocumentPage } from '../core/documentModel';

/** App `shape` subtype ↔ XFDF annotation tag (G21). */
const SHAPE_TO_XFDF: Record<ShapeType, 'square' | 'circle' | 'line' | 'ink'> = {
  rect: 'square', ellipse: 'circle', arrow: 'line', freehand: 'ink',
};

/**
 * Map one element record → an XFDF annotation in PDF user space, or null when
 * the type has no clean XFDF equivalent. `pageHeight` is the page height in
 * points (for the y-flip); `pageIndex` is the 0-based document page index.
 */
export function elementToXfdfAnnot(el: ElementJSON, pageIndex: number, pageHeight: number): XfdfAnnot | null {
  const x = el.x, y = el.y, w = el.width, h = el.height;
  // display top-left (y-down) → user-space corners (y-up)
  const rect: [number, number, number, number] = [x, pageHeight - (y + h), x + w, pageHeight - y];
  const color = el.color as string | undefined;
  if (el.type === 'highlight') {
    const a: XfdfAnnot = { type: 'highlight', page: pageIndex, rect };
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
      // endpoints flip independently (directional — y_user = pageHeight - y_display)
      const x1 = el.x1 as number, y1 = el.y1 as number, x2 = el.x2 as number, y2 = el.y2 as number;
      a.line = [x1, pageHeight - y1, x2, pageHeight - y2];
    } else if (shapeType === 'freehand') {
      const points = (el.points as Array<{ x: number; y: number }> | undefined) ?? [];
      a.inkList = [points.flatMap(p => [p.x, pageHeight - p.y])];
    }
    return a;
  }
  return null;
}

/**
 * Construct an annotation element (auto-assigned id) from an XFDF record, or
 * null for an unsupported subtype. `pageHeight` flips user space back to
 * display space; `pageId` is the target document page's id.
 */
export function xfdfAnnotToElement(a: XfdfAnnot, pageId: string, pageHeight: number): PDFElement | null {
  const [x1, y1, x2, y2] = a.rect;
  const x = x1, w = x2 - x1, h = y2 - y1, y = pageHeight - y2;
  if (a.type === 'highlight') {
    return new HighlightElement(x, y, w, h, pageId, a.color ?? '#FFFF00', a.opacity ?? 0.3);
  }
  if (a.type === 'text') {
    const el = new CommentElement(x, y, pageId, { color: a.color, text: a.contents });
    el.width = w; el.height = h;
    return el;
  }
  if (a.type === 'freetext') {
    const el = new TextElement(x, y, pageId, { width: w, height: h, fontSize: a.fontSize, color: a.color });
    el.text = a.contents ?? '';
    return el;
  }
  if (a.type === 'square' || a.type === 'circle') {
    const shapeType: ShapeType = a.type === 'square' ? 'rect' : 'ellipse';
    return new ShapeElement(shapeType, x, y, w, h, pageId, { strokeColor: a.color, strokeWidth: a.width });
  }
  if (a.type === 'line') {
    // flip endpoints back to display space; bbox spans the endpoints
    const ln = a.line ?? a.rect;
    const ex1 = ln[0], ey1 = pageHeight - ln[1], ex2 = ln[2], ey2 = pageHeight - ln[3];
    const bx = Math.min(ex1, ex2), by = Math.min(ey1, ey2);
    const bw = Math.abs(ex2 - ex1), bh = Math.abs(ey2 - ey1);
    return new ShapeElement('arrow', bx, by, bw, bh, pageId,
      { strokeColor: a.color, strokeWidth: a.width, x1: ex1, y1: ey1, x2: ex2, y2: ey2 });
  }
  if (a.type === 'ink') {
    const points: Array<{ x: number; y: number }> = [];
    for (const path of a.inkList ?? []) {
      for (let i = 0; i + 1 < path.length; i += 2) points.push({ x: path[i], y: pageHeight - path[i + 1] });
    }
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const bx = xs.length ? Math.min(...xs) : 0, by = ys.length ? Math.min(...ys) : 0;
    const bw = xs.length ? Math.max(...xs) - bx : 0, bh = ys.length ? Math.max(...ys) - by : 0;
    return new ShapeElement('freehand', bx, by, bw, bh, pageId,
      { strokeColor: a.color, strokeWidth: a.width, points });
  }
  return null;
}

/**
 * Page height in points for the display↔user-space flip: blank pages carry it
 * directly; source pages read it from the loaded pdf.js page viewport.
 */
export async function pageHeightPt(
  docPage: DocumentPage,
  sourcePdfs: Map<string, { doc: { getPage(n: number): Promise<{ getViewport(o: { scale: number }): { height: number } }> } }>,
): Promise<number> {
  if (docPage.sourcePdfId === 'blank') return docPage.blankHeight ?? 842;
  const src = sourcePdfs.get(docPage.sourcePdfId);
  if (!src) return docPage.blankHeight ?? 842;
  const page = await src.doc.getPage(docPage.sourcePageNum);
  return page.getViewport({ scale: 1 }).height;
}
