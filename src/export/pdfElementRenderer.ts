import type { PDFElement, ElementType } from '../elements/annotationElement';
import type { TextElement } from '../elements/textElement';
import type { SignatureElement } from '../elements/signatureElement';
import type { ImageElement } from '../elements/imageElement';
import type { CodeElement } from '../elements/codeElement';
import type { HighlightElement } from '../elements/highlightElement';
import type { ShapeElement } from '../elements/shapeElement';
import type { CommentElement } from '../elements/commentElement';
import { dataUrlToUint8Array } from '../utils/binaryUtils';
import { transformPoint, hexToRgbValues } from '../utils/geometry';
import { isArabicText } from '../utils/flowDoc';
import { drawArabicLine } from './arabicOverlay';

export interface PdfRenderCtx {
  // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib PDFDocument internals are untyped here
  pdfDoc: any;
  // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib PDFPage internals are untyped here
  page: any;
  // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib runtime helpers (rgb/StandardFonts/degrees) are untyped here
  libs: { rgb: any; StandardFonts: any; degrees?: any };
  /** Effective height after rotation swap (h_eff). */
  h: number;
  /** Effective width after rotation swap (w_eff). */
  w: number;
  W_orig: number;
  H_orig: number;
  totalRot: number;
  cropOriginX: number;
  cropOriginY: number;
}

/** Embed a raster image (JPEG or PNG/other via canvas re-encode) into a pdf-lib document. */
// oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib PDFDocument/PDFImage internals are untyped here
export function embedImage(pdfDoc: any, src: string): Promise<any> {
  if (src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg')) {
    return pdfDoc.embedJpg(dataUrlToUint8Array(src));
  }
  // PNG or WEBP/other — canvas re-encode to PNG
  return new Promise<unknown>((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      (c.getContext('2d') as CanvasRenderingContext2D).drawImage(img, 0, 0);
      const pngBytes = dataUrlToUint8Array(c.toDataURL('image/png'));
      resolve(await pdfDoc.embedPng(pngBytes));
    };
    img.onerror = reject;
    img.src = src;
  });
}

/** Map a CSS font-family + bold/italic flags to the nearest pdf-lib StandardFonts key. */
export function getStandardFont(fontFamily: string, bold: boolean, italic: boolean): string {
  const map: Record<string, Record<string, string>> = {
    'Arial':           { '': 'Helvetica',  'b': 'HelveticaBold', 'i': 'HelveticaOblique',  'bi': 'HelveticaBoldOblique' },
    'Helvetica':       { '': 'Helvetica',  'b': 'HelveticaBold', 'i': 'HelveticaOblique',  'bi': 'HelveticaBoldOblique' },
    'Times New Roman': { '': 'TimesRoman', 'b': 'TimesBold',     'i': 'TimesItalic',       'bi': 'TimesBoldItalic' },
    'Courier New':     { '': 'Courier',    'b': 'CourierBold',   'i': 'CourierOblique',    'bi': 'CourierBoldOblique' },
    'Courier':         { '': 'Courier',    'b': 'CourierBold',   'i': 'CourierOblique',    'bi': 'CourierBoldOblique' },
  };
  const variant = (bold ? 'b' : '') + (italic ? 'i' : '');
  return (map[fontFamily]?.[variant]) ?? 'Helvetica';
}

/**
 * Per-element draw helpers derived once from the page geometry (rotation swap,
 * crop origin, element rotation). Computed in `renderElementToPdfLib` and handed
 * to each per-type renderer so the shared trig isn't recomputed per branch.
 */
interface RenderHelpers {
  /** Element-space → page-space point map (rotation + crop applied). */
  tp: (px: number, py: number) => { x: number; y: number };
  /** True when the page is rotated 90°/270° (width/height swap). */
  swapDims: boolean;
  /** Element's own rotation in degrees (CW); 0 when unrotated. */
  elemRot: number;
  /** pdf-lib `degrees(-elemRot)` value, or undefined when unrotated/unavailable. */
  // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib degrees() return is untyped here
  pdfRotVal: any;
  /** Shift a corner anchor so element rotation pivots around its center. */
  anchorForCenter: (cornerX: number, cornerY: number, ew: number, eh: number) => { x: number; y: number };
  /** Unrotated content height (for freehand SVG y-flip). */
  Ho: number;
}

/** Signature shared by every per-element-type renderer in the dispatch map. */
type ElementRenderer = (element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers) => Promise<void>;

async function renderText(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const te = element as TextElement;
  if (!te.text) return;
  const { pdfDoc, page, libs } = ctx;
  const { rgb, StandardFonts } = libs;
  const { tp, elemRot, pdfRotVal, anchorForCenter } = hlp;
  const col = hexToRgbValues(te.color);
  const fontName = getStandardFont(te.fontFamily, te.bold, te.italic);
  const font = await pdfDoc.embedFont(StandardFonts[fontName as keyof typeof StandardFonts]);
  // 0.9 = measured Arial fontBoundingBoxAscent/fontSize ratio (avg across 8–72px);
  // aligns PDF baseline with the browser's CSS text baseline. Max residual error < 0.6pt.
  const lineHeight = te.fontSize * 1.2;
  const lines = te.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const baseY = te.y + te.fontSize * 0.9 + i * lineHeight;
    const rawAnchor = tp(te.x, baseY);
    const a = elemRot ? anchorForCenter(rawAnchor.x, rawAnchor.y, 0, 0) : rawAnchor;
    if (isArabicText(line)) {
      // Arabic: render shaped, right-to-left via the embedded Noto Naskh font
      // (drawText can't place shaped glyphs RTL). Right-align to the box edge.
      const rightAnchor = tp(te.x + (te.width || 0), baseY);
      await drawArabicLine(pdfDoc, page, {
        text: line, x: a.x, y: a.y, right: Math.max(a.x, rightAnchor.x),
        size: te.fontSize, color: col,
      });
    } else {
      page.drawText(line, { x: a.x, y: a.y, size: te.fontSize, font, color: rgb(col.r, col.g, col.b), ...(pdfRotVal ? { rotate: pdfRotVal } : {}) });
    }
  }
}

async function renderSignature(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const se = element as SignatureElement;
  const { pdfDoc, page } = ctx;
  const { tp, swapDims, pdfRotVal, anchorForCenter } = hlp;
  const img = await pdfDoc.embedPng(dataUrlToUint8Array(se.data));
  const ew = swapDims ? element.height : element.width;
  const eh = swapDims ? element.width : element.height;
  const corner = tp(element.x, element.y + element.height);
  const a = anchorForCenter(corner.x, corner.y, ew, eh);
  page.drawImage(img, { x: a.x, y: a.y, width: ew, height: eh, ...(pdfRotVal ? { rotate: pdfRotVal } : {}) });
}

async function renderImage(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const ie = element as ImageElement;
  const { pdfDoc, page } = ctx;
  const { tp, swapDims, pdfRotVal, anchorForCenter } = hlp;
  const pdfImg = await embedImage(pdfDoc, ie.src);
  const ew = swapDims ? element.height : element.width;
  const eh = swapDims ? element.width : element.height;
  const corner = tp(element.x, element.y + element.height);
  const a = anchorForCenter(corner.x, corner.y, ew, eh);
  page.drawImage(pdfImg, { x: a.x, y: a.y, width: ew, height: eh, ...(pdfRotVal ? { rotate: pdfRotVal } : {}) });
}

async function renderCode(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const ce = element as CodeElement;
  const { pdfDoc, page } = ctx;
  const { tp, swapDims, pdfRotVal, anchorForCenter } = hlp;
  const codePdfImg = await embedImage(pdfDoc, ce.cachedDataUrl);
  const ew = swapDims ? element.height : element.width;
  const eh = swapDims ? element.width : element.height;
  const corner = tp(element.x, element.y + element.height);
  const a = anchorForCenter(corner.x, corner.y, ew, eh);
  page.drawImage(codePdfImg, { x: a.x, y: a.y, width: ew, height: eh, ...(pdfRotVal ? { rotate: pdfRotVal } : {}) });
}

function renderHighlight(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const he = element as HighlightElement;
  const { page, libs } = ctx;
  const { rgb } = libs;
  const { tp, swapDims, pdfRotVal, anchorForCenter } = hlp;
  const col = hexToRgbValues(he.color);
  const ew = swapDims ? element.height : element.width;
  const eh = swapDims ? element.width : element.height;
  const corner = tp(element.x, element.y + element.height);
  const a = anchorForCenter(corner.x, corner.y, ew, eh);
  page.drawRectangle({ x: a.x, y: a.y, width: ew, height: eh, color: rgb(col.r, col.g, col.b), opacity: he.opacity, borderWidth: 0, ...(pdfRotVal ? { rotate: pdfRotVal } : {}) });
  return Promise.resolve();
}

function renderShape(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const she = element as ShapeElement;
  const { page, libs } = ctx;
  const { rgb } = libs;
  const { tp, swapDims, pdfRotVal, anchorForCenter, Ho } = hlp;
  const col = hexToRgbValues(she.strokeColor);
  const shapeColor = rgb(col.r, col.g, col.b);
  const lw = she.strokeWidth;
  switch (she.shapeType) {
    case 'rect': {
      const ew = swapDims ? element.height : element.width;
      const eh = swapDims ? element.width : element.height;
      const corner = tp(element.x, element.y + element.height);
      const a = anchorForCenter(corner.x, corner.y, ew, eh);
      const fillClr = she.fillColor;
      const fillOpts = fillClr ? { color: (() => { const fc = hexToRgbValues(fillClr); return rgb(fc.r, fc.g, fc.b); })() } : {};
      page.drawRectangle({ x: a.x, y: a.y, width: ew, height: eh, ...fillOpts, borderColor: shapeColor, borderWidth: lw, ...(pdfRotVal ? { rotate: pdfRotVal } : {}) });
      break;
    }
    case 'ellipse': {
      const center = tp(element.x + element.width / 2, element.y + element.height / 2);
      const fillClrE = she.fillColor;
      const fillOptsE = fillClrE ? { color: (() => { const fc = hexToRgbValues(fillClrE); return rgb(fc.r, fc.g, fc.b); })() } : {};
      page.drawEllipse({ x: center.x, y: center.y, xScale: swapDims ? element.height / 2 : element.width / 2, yScale: swapDims ? element.width / 2 : element.height / 2, ...fillOptsE, borderColor: shapeColor, borderWidth: lw, ...(pdfRotVal ? { rotate: pdfRotVal } : {}) });
      break;
    }
    case 'arrow': {
      const pt1 = tp(she.x1, she.y1);
      const pt2 = tp(she.x2, she.y2);
      const pa = Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
      const headLen = Math.max(12, lw * 5);
      const headThick = Math.max(1, Math.min(lw, lw * 0.4));
      page.drawLine({ start: { x: pt1.x, y: pt1.y }, end: { x: pt2.x, y: pt2.y }, thickness: lw, color: shapeColor });
      page.drawLine({ start: { x: pt2.x, y: pt2.y }, end: { x: pt2.x + headLen * Math.cos(pa + Math.PI * 0.75), y: pt2.y + headLen * Math.sin(pa + Math.PI * 0.75) }, thickness: headThick, color: shapeColor });
      page.drawLine({ start: { x: pt2.x, y: pt2.y }, end: { x: pt2.x + headLen * Math.cos(pa - Math.PI * 0.75), y: pt2.y + headLen * Math.sin(pa - Math.PI * 0.75) }, thickness: headThick, color: shapeColor });
      break;
    }
    case 'freehand': {
      if (she.points.length < 2) break;
      // Convert to SVG coords: tp() gives PDF (y-up), drawSvgPath maps SVG y-down via origin (0, Ho).
      // SVG y = Ho - pdf_y ensures SVG (px, Ho-pdf_y) → PDF (px, pdf_y) with origin {x:0,y:Ho}.
      const tpts = she.points.map(p => { const r = tp(p.x, p.y); return { x: r.x, y: Ho - r.y }; });
      let d = `M ${tpts[0].x} ${tpts[0].y}`;
      for (let i = 1; i < tpts.length; i++) d += ` L ${tpts[i].x} ${tpts[i].y}`;
      page.drawSvgPath(d, { x: 0, y: Ho, borderColor: shapeColor, borderWidth: lw, scale: 1 });
      break;
    }
  }
  return Promise.resolve();
}

async function renderComment(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const ce = element as CommentElement;
  const { pdfDoc, page, libs } = ctx;
  const { rgb, StandardFonts } = libs;
  const { tp, swapDims, pdfRotVal, anchorForCenter } = hlp;
  const col = hexToRgbValues(ce.color);
  const ew = swapDims ? ce.height : ce.width;
  const eh = swapDims ? ce.width : ce.height;
  const corner = tp(ce.x, ce.y + ce.height);
  const a = anchorForCenter(corner.x, corner.y, ew, eh);
  page.drawRectangle({ x: a.x, y: a.y, width: ew, height: eh, color: rgb(col.r, col.g, col.b), opacity: 0.85, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 1, ...(pdfRotVal ? { rotate: pdfRotVal } : {}) });
  if (ce.text) {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    // Text starts at top of box with 4px padding + ~10pt ascent (matches canvas textarea layout)
    const anchor2 = tp(ce.x + 4, ce.y + 4 + 10);
    page.drawText(ce.text.slice(0, 200), { x: anchor2.x, y: anchor2.y, size: 10, font, color: rgb(0, 0, 0), maxWidth: swapDims ? ce.height - 8 : ce.width - 8, lineHeight: 14, opacity: 0.9, ...(pdfRotVal ? { rotate: pdfRotVal } : {}) });
  }
}

function renderRedaction(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const { page, libs } = ctx;
  const { rgb } = libs;
  const { tp, swapDims, pdfRotVal, anchorForCenter } = hlp;
  const ew = swapDims ? element.height : element.width;
  const eh = swapDims ? element.width : element.height;
  const corner = tp(element.x, element.y + element.height);
  const a = anchorForCenter(corner.x, corner.y, ew, eh);
  const redCol = hexToRgbValues((element as { color?: string }).color ?? '#000000');
  page.drawRectangle({ x: a.x, y: a.y, width: ew, height: eh, color: rgb(redCol.r, redCol.g, redCol.b), borderWidth: 0, ...(pdfRotVal ? { rotate: pdfRotVal } : {}) });
  return Promise.resolve();
}

/**
 * Dispatch map: one renderer per ElementType. Typing it as
 * `Record<ElementType, …>` makes coverage of all element types a compile-time
 * guarantee — adding a new ElementType won't type-check until a renderer exists.
 */
const RENDERERS: Record<ElementType, ElementRenderer> = {
  text: renderText,
  signature: renderSignature,
  image: renderImage,
  code: renderCode,
  highlight: renderHighlight,
  shape: renderShape,
  comment: renderComment,
  redaction: renderRedaction,
};

/** Render a single PDFElement annotation onto a pdf-lib page. */
export function renderElementToPdfLib(element: PDFElement, ctx: PdfRenderCtx): Promise<void> {
  const { w, h, W_orig, H_orig, totalRot, cropOriginX, cropOriginY, libs } = ctx;

  // W_orig/H_orig are the unrotated content dims; fall back to effective dims when totalRot=0
  const Wo = W_orig || w;
  const Ho = H_orig || h;
  const tp = (px: number, py: number) => {
    const r = transformPoint(px, py, Wo, Ho, totalRot);
    return { x: r.x + cropOriginX, y: r.y + cropOriginY };
  };
  const swapDims = ((totalRot % 360) + 360) % 360 === 90 || ((totalRot % 360) + 360) % 360 === 270;

  // Element's own rotation (degrees, CW). pdf-lib uses CCW so negate.
  const elemRot = element.rotation ?? 0;
  const pdfRotVal = libs.degrees ? libs.degrees(-elemRot) : undefined;

  // Compute anchor adjusted so rotation is around element center, not corner.
  // pdf-lib rotates around (x, y) so we shift the anchor by the inverse rotation offset.
  const anchorForCenter = (cornerX: number, cornerY: number, ew: number, eh: number) => {
    if (!elemRot || !pdfRotVal) return { x: cornerX, y: cornerY };
    const rad = (-elemRot) * Math.PI / 180;
    const cx = cornerX + ew / 2;
    const cy = cornerY + eh / 2;
    const ox = -ew / 2, oy = -eh / 2;
    return {
      x: cx + ox * Math.cos(rad) - oy * Math.sin(rad),
      y: cy + ox * Math.sin(rad) + oy * Math.cos(rad),
    };
  };

  return RENDERERS[element.type](element, ctx, { tp, swapDims, elemRot, pdfRotVal, anchorForCenter, Ho });
}
