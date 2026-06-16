/**
 * XFDF ↔ element-model mapping (#57). Bridges the app's annotation elements
 * (editor DISPLAY space: points at scale 1, top-left origin, y-DOWN) and the
 * normalised XFDF record (PDF USER space: points, bottom-left origin, y-UP).
 * The XML itself is handled by utils/xfdf; this is the geometry + type bridge.
 *
 * Supported both ways: highlight ↔ <highlight>, comment ↔ <text> (sticky note),
 * text ↔ <freetext>. Other element/annotation types return null (skipped, never
 * mis-mapped) — see the #57b ceiling in utils/xfdf.
 */
import type { XfdfAnnot } from '../utils/xfdf';
import type { ElementJSON, PDFElement } from '../elements/annotationElement';
import { HighlightElement } from '../elements/highlightElement';
import { CommentElement } from '../elements/commentElement';
import { TextElement } from '../elements/textElement';
import type { DocumentPage } from '../core/documentModel';

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
