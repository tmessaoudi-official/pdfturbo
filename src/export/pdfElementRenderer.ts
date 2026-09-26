import type { PDFElement, ElementType } from '../elements/annotationElement';
import type { TextElement } from '../elements/textElement';
import { buildSignatureCaptionLines, type SignatureElement } from '../elements/signatureElement';
import type { ImageElement } from '../elements/imageElement';
import type { CodeElement } from '../elements/codeElement';
import type { HighlightElement } from '../elements/highlightElement';
import type { ShapeElement } from '../elements/shapeElement';
import type { CommentElement } from '../elements/commentElement';
import { dataUrlToUint8Array } from '../utils/binaryUtils';
import { transformPoint, hexToRgbValues, cosSinDeg } from '../utils/geometry';
import { drawArabicLine } from './arabicOverlay';
import { drawStyledTextLine, hasAdvancedText } from './styledText';
import { layoutTextLines } from './textLayout';
import { sanitizeLinkUrl } from '../utils/linkUrl';
import { PDFName, PDFArray, PDFNumber, PDFString } from '@cantoo/pdf-lib';

/** Hard cap on baked comment text (#QA-2026-06-23 P3 #11) — raised from 200; when the text
 *  exceeds the cap it is truncated WITH a trailing ellipsis so the loss is visible, not silent. */
export const COMMENT_TEXT_CAP = 2000;
export function clampCommentText(text: string, cap = COMMENT_TEXT_CAP): string {
  return text.length > cap ? text.slice(0, cap - 1) + '…' : text;
}

/**
 * Append a borderless `/Link` annotation with a `/URI` action over `rect` (PDF page coords,
 * bottom-left origin) to the page's `/Annots`. Mirrors the `incrementalSigner.ts` idiom.
 * The URL is assumed already sanitised by the caller (see `sanitizeLinkUrl`).
 */
// oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib PDFPage/PDFContext internals are untyped here
export function addUriLinkAnnotation(page: any, ctx: any, rect: { x: number; y: number; w: number; h: number }, url: string): void {
  const action = ctx.obj({ S: PDFName.of('URI'), URI: PDFString.of(url) });
  const rectArr = PDFArray.withContext(ctx);
  for (const n of [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h]) rectArr.push(PDFNumber.of(n));
  const border = PDFArray.withContext(ctx);
  for (const n of [0, 0, 0]) border.push(PDFNumber.of(n));
  const annot = ctx.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link') });
  annot.set(PDFName.of('Rect'), rectArr);
  annot.set(PDFName.of('Border'), border);
  annot.set(PDFName.of('A'), action);
  const ref = ctx.register(annot);
  const annotsKey = PDFName.of('Annots');
  const existing = page.node.get(annotsKey);
  if (existing instanceof PDFArray) existing.push(ref);
  else { const arr = PDFArray.withContext(ctx); arr.push(ref); page.node.set(annotsKey, arr); }
}

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
    'Times New Roman': { '': 'TimesRoman', 'b': 'TimesRomanBold', 'i': 'TimesRomanItalic', 'bi': 'TimesRomanBoldItalic' },
    'Courier New':     { '': 'Courier',    'b': 'CourierBold',   'i': 'CourierOblique',    'bi': 'CourierBoldOblique' },
    'Courier':         { '': 'Courier',    'b': 'CourierBold',   'i': 'CourierOblique',    'bi': 'CourierBoldOblique' },
  };
  const variant = (bold ? 'b' : '') + (italic ? 'i' : '');
  return (map[fontFamily]?.[variant]) ?? 'Helvetica';
}

/**
 * Rotate a point about a pivot in ELEMENT space (y-down, clockwise) — the same
 * space the on-screen overlay rotates in (elementLayerRenderer.ts: CSS
 * `rotate(${rotation}deg)` + `transform-origin: center center`). Used to bake an
 * arrow's / freehand stroke's own rotation into its points BEFORE they pass through
 * `tp()` (page rotation + crop). `degCW` is degrees clockwise; 0 ⇒ identity.
 *
 * In a y-DOWN coordinate system the standard rotation matrix
 *   x' = dx·cos − dy·sin ,  y' = dx·sin + dy·cos
 * turns clockwise (positive angle sweeps +x toward +y, i.e. right → down) — which
 * matches CSS `rotate()`, so no sign flip is needed here.
 */
export function _rotateInElementSpace(px: number, py: number, cx: number, cy: number, degCW: number): { x: number; y: number } {
  if (!degCW) return { x: px, y: py };
  const t = (degCW * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
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
  /**
   * Map a DISPLAYED-space rect (top-left origin, editor coords) to its content-space
   * bottom-left anchor (the pdf-lib draw origin) as the AABB-min of all four mapped
   * corners. At rot=0 this equals `tp(x, y+h)` (byte-identical to the old single-corner
   * anchor); under a 90°/270° page rotation the single corner mapped to the WRONG side
   * and shifted the rect by its own width/height — using the AABB min fixes that.
   */
  rectAnchor: (x: number, y: number, w: number, h: number) => { x: number; y: number };
  /** Unrotated content height (for freehand SVG y-flip). */
  Ho: number;
  /**
   * A DISPLAY point of this element, turned with the element about its box centre (as the editor's
   * CSS `rotate()` turns it) and mapped to page space. With no element rotation it is exactly `tp`.
   */
  place: (px: number, py: number) => { x: number; y: number };
  /**
   * The pdf-lib `rotate` for anything with a reading direction (glyphs, pictures): the page's own
   * rotation minus the element's, so it reads upright-then-turned in the viewer exactly as in the
   * editor. Equal to `pdfRotVal` on an unrotated page.
   */
  // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib degrees() return is untyped here
  orient: any;
  /** `orient` in degrees (CCW, page space). */
  orientDeg: number;
  /**
   * drawImage placement for a DISPLAY sub-box of this element (its own width/height, never swapped)
   * so a picture keeps its orientation and aspect whatever the page and element rotation.
   */
  // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib degrees() return is untyped here
  placeBox: (x: number, y: number, w: number, h: number) => { x: number; y: number; width: number; height: number; rotate?: any };
}

/** Signature shared by every per-element-type renderer in the dispatch map. */
type ElementRenderer = (element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers) => Promise<void>;

async function renderText(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const te = element as TextElement;
  if (!te.text) return;
  const { pdfDoc, page, libs } = ctx;
  const { rgb, StandardFonts } = libs;
  const { tp, swapDims, elemRot, anchorForCenter, rectAnchor, place, orient, orientDeg } = hlp;
  const col = hexToRgbValues(te.color);
  const alpha = te.opacity ?? 1;
  const fontName = getStandardFont(te.fontFamily, te.bold, te.italic);
  const font = await pdfDoc.embedFont(StandardFonts[fontName as keyof typeof StandardFonts]);

  // Background fill behind the whole text box (skip when rotated — documented ceiling,
  // same guard as underline/strikethrough). Anchor matches renderHighlight / renderRedaction:
  // tp(x, y+height) gives the bottom-left corner in PDF (y-up) space; width/height are the
  // effective dims after the page-rotation swap (same as the highlight renderer).
  if (te.backgroundColor && !elemRot) {
    const bg = hexToRgbValues(te.backgroundColor);
    const ew = swapDims ? (te.height || 0) : (te.width || 0);
    const eh = swapDims ? (te.width || 0) : (te.height || 0);
    const corner = rectAnchor(te.x, te.y, te.width, te.height || 0);
    const a = anchorForCenter(corner.x, corner.y, ew, eh);
    page.drawRectangle({ x: a.x, y: a.y, width: ew, height: eh, color: rgb(bg.r, bg.g, bg.b), opacity: alpha, borderWidth: 0 });
  }

  // Tier-2 attrs (stroke/charSpacing/horizontalScale/baselineShift/justify) require raw
  // PDF operators — drawText cannot express them. The operator path carries the rotation in its
  // text matrix (`rotate`), so a rotated element keeps them too (A3-pre, 2026-09-26).
  const advanced = hasAdvancedText(te);
  // Page 0° and element 0°: the historical axis-aligned layout, byte-for-byte.
  const upright = !elemRot && !ctx.totalRot;
  // fontKey is a PDFName used to reference the embedded font in the raw operator stream.
  // page.node is the internal PDFPageLeaf; accessed via `any` (same pattern as arabicOverlay).
  // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib PDFPageLeaf internals are untyped here
  const fontKey = advanced ? (page as any).node.newFontDictionary(font.name, font.ref) : null;
  // Opacity via ExtGState (mirrors what drawText does internally). Cast needed because
  // maybeEmbedGraphicsState is private on PDFPage.
  // oxlint-disable-next-line typescript/no-explicit-any -- pdf-lib private method access
  const gsName = advanced && alpha < 1 ? (page as any).maybeEmbedGraphicsState({ opacity: alpha, borderOpacity: alpha }) : undefined;
  const subSup = te.baselineShift;
  const drawSize = subSup ? te.fontSize * 0.65 : te.fontSize;
  const rise = subSup === 'super' ? te.fontSize * 0.33 : subSup === 'sub' ? -(te.fontSize * 0.15) : 0;

  // List markers, line positions, alignment and justify come from the ONE layout the redaction
  // drop also uses (`textLayout.ts`), so what is tested is what is drawn.
  for (const laid of layoutTextLines(te, font, advanced)) {
    const { line, baseY } = laid;
    if (laid.arabic) {
      // Arabic: render shaped, right-to-left via the embedded Noto Naskh font
      // (drawText can't place shaped glyphs RTL). Right-align to the box edge.
      const a = place(te.x, baseY);
      // Rotated: the box's left end of the baseline plus its width measured ALONG the line.
      const right = upright ? Math.max(a.x, tp(te.x + (te.width || 0), baseY).x) : a.x + (te.width || 0);
      await drawArabicLine(pdfDoc, page, {
        text: line, x: a.x, y: a.y, right,
        size: te.fontSize, color: col,
        // Slice-2 advanced attrs now honoured on the Arabic overlay (Feature 4).
        charSpacing: te.charSpacing, horizontalScale: te.horizontalScale, strokeWidth: te.strokeWidth,
        ...(upright ? {} : { rotate: orientDeg }),
      });
    } else {
      const { off, lineW, wordSpacing } = laid;
      // The line's own start, turned with the box about its CENTRE (it used to turn about itself).
      const a = place(te.x + off, baseY);
      if (advanced) {
        drawStyledTextLine(page, {
          text: line, x: a.x, y: a.y, size: drawSize, font, fontKey,
          color: col,
          charSpacing: te.charSpacing,
          horizontalScale: te.horizontalScale,
          strokeWidth: te.strokeWidth,
          baselineRise: rise,
          wordSpacing,
          gsName,
          rotate: orientDeg,
        });
      } else {
        page.drawText(line, { x: a.x, y: a.y, size: te.fontSize, font, color: rgb(col.r, col.g, col.b), opacity: alpha, ...(orient ? { rotate: orient } : {}) });
      }
      // Underline / strikethrough as drawn lines. Rotated text is a documented ceiling
      // (the rule geometry would need the full rotation transform). `elemRot` (not
      // pdfRotVal — which is degrees(-0), truthy even unrotated) is the unrotated signal.
      if (!elemRot && (te.underline || te.strikethrough)) {
        const thick = Math.max(0.5, te.fontSize * 0.06);
        const lineColor = rgb(col.r, col.g, col.b);
        if (te.underline) {
          page.drawLine({ start: tp(te.x + off, baseY + te.fontSize * 0.12), end: tp(te.x + off + lineW, baseY + te.fontSize * 0.12), thickness: thick, color: lineColor, opacity: alpha });
        }
        if (te.strikethrough) {
          page.drawLine({ start: tp(te.x + off, baseY - te.fontSize * 0.3), end: tp(te.x + off + lineW, baseY - te.fontSize * 0.3), thickness: thick, color: lineColor, opacity: alpha });
        }
      }
    }
  }

  // Hyperlink (Feature 3): add a borderless /Link annotation over the box. The URL is
  // re-sanitised here (defence-in-depth — a crafted saved blob could bypass the UI service).
  // The rect uses the same rotation-safe AABB anchor as the background fill; element self-
  // rotation falls back to the axis-aligned bbox (PDF /Link rects can't rotate — ceiling).
  const safeUrl = te.linkUrl ? sanitizeLinkUrl(te.linkUrl) : null;
  if (safeUrl) {
    const lew = swapDims ? (te.height || 0) : (te.width || 0);
    const leh = swapDims ? (te.width || 0) : (te.height || 0);
    const lc = rectAnchor(te.x, te.y, te.width, te.height || 0);
    addUriLinkAnnotation(page, pdfDoc.context, { x: lc.x, y: lc.y, w: lew, h: leh }, safeUrl);
  }
}

async function renderSignature(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const se = element as SignatureElement;
  const { pdfDoc, page, libs: { rgb, StandardFonts } } = ctx;
  const { place, orient, placeBox } = hlp;
  const img = await pdfDoc.embedPng(dataUrlToUint8Array(se.data));

  // F-D D1 — when an approval caption is attached, reserve a bottom band (in the
  // element's display-height axis) for it; the image fills the rest. No caption →
  // byte-identical to the pre-D1 path. Read fields directly (the export renderer
  // treats elements as plain data — no instance methods).
  const captionLines = buildSignatureCaptionLines(se);
  const captionBand = captionLines.length ? Math.min(element.height * 0.34, 22) : 0;
  const imgDispH = element.height - captionBand;

  // The picture band turns with the WHOLE element about the element's centre, like the editor.
  page.drawImage(img, placeBox(element.x, element.y, element.width, imgDispH));

  if (!captionLines.length) return;

  // Caption text in the bottom band — same baseline/rotation maths as renderText.
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const size = Math.max(6, captionBand * 0.42);
  const lineHeight = size * 1.2;
  const pad = Math.min(3, element.width * 0.04);
  for (let i = 0; i < captionLines.length; i++) {
    const line = captionLines[i];
    if (!line) continue;
    const baseY = element.y + imgDispH + size * 0.9 + i * lineHeight;
    const at = place(element.x + pad, baseY);
    page.drawText(line, {
      x: at.x, y: at.y, size, font, color: rgb(0.07, 0.07, 0.07),
      maxWidth: element.width - pad * 2, ...(orient ? { rotate: orient } : {}),
    });
  }
}

async function renderImage(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const ie = element as ImageElement;
  const { pdfDoc, page } = ctx;
  const pdfImg = await embedImage(pdfDoc, ie.src);
  page.drawImage(pdfImg, hlp.placeBox(element.x, element.y, element.width, element.height));
}

async function renderCode(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const ce = element as CodeElement;
  const { pdfDoc, page } = ctx;
  const codePdfImg = await embedImage(pdfDoc, ce.cachedDataUrl);
  page.drawImage(codePdfImg, hlp.placeBox(element.x, element.y, element.width, element.height));
}

function renderHighlight(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const he = element as HighlightElement;
  const { page, libs } = ctx;
  const { rgb } = libs;
  const { rectAnchor, swapDims, pdfRotVal, anchorForCenter } = hlp;
  const col = hexToRgbValues(he.color);
  const ew = swapDims ? element.height : element.width;
  const eh = swapDims ? element.width : element.height;
  const corner = rectAnchor(element.x, element.y, element.width, element.height);
  const a = anchorForCenter(corner.x, corner.y, ew, eh);
  page.drawRectangle({ x: a.x, y: a.y, width: ew, height: eh, color: rgb(col.r, col.g, col.b), opacity: he.opacity, borderWidth: 0, ...(pdfRotVal ? { rotate: pdfRotVal } : {}) });
  return Promise.resolve();
}

function renderShape(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const she = element as ShapeElement;
  const { page, libs } = ctx;
  const { rgb } = libs;
  const { tp, swapDims, pdfRotVal, anchorForCenter, elemRot, Ho, rectAnchor } = hlp;
  const col = hexToRgbValues(she.strokeColor);
  const shapeColor = rgb(col.r, col.g, col.b);
  const lw = she.strokeWidth;
  // Pivot for the element's own rotation: bbox centre, in element space (the same
  // y-down/clockwise space tp() consumes). Arrow/freehand bake rotation into their
  // points HERE (before tp); rect/ellipse instead pass `rotate: pdfRotVal` to pdf-lib.
  const pivotX = element.x + element.width / 2;
  const pivotY = element.y + element.height / 2;
  switch (she.shapeType) {
    case 'rect': {
      const ew = swapDims ? element.height : element.width;
      const eh = swapDims ? element.width : element.height;
      const corner = rectAnchor(element.x, element.y, element.width, element.height);
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
      // Rotate endpoints about the bbox centre in element space, THEN map to page
      // space — the arrowhead angle below is derived from the rotated page-space
      // endpoints, so it follows the rotation automatically.
      const r1 = _rotateInElementSpace(she.x1, she.y1, pivotX, pivotY, elemRot);
      const r2 = _rotateInElementSpace(she.x2, she.y2, pivotX, pivotY, elemRot);
      const pt1 = tp(r1.x, r1.y);
      const pt2 = tp(r2.x, r2.y);
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
      // Element rotation is baked in element space BEFORE tp (so the y-flip below is unaffected).
      const tpts = she.points.map(p => {
        const rp = _rotateInElementSpace(p.x, p.y, pivotX, pivotY, elemRot);
        const r = tp(rp.x, rp.y);
        return { x: r.x, y: Ho - r.y };
      });
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
  const { swapDims, pdfRotVal, anchorForCenter, rectAnchor, place, orient } = hlp;
  const col = hexToRgbValues(ce.color);
  const ew = swapDims ? ce.height : ce.width;
  const eh = swapDims ? ce.width : ce.height;
  const corner = rectAnchor(ce.x, ce.y, ce.width, ce.height);
  const a = anchorForCenter(corner.x, corner.y, ew, eh);
  page.drawRectangle({ x: a.x, y: a.y, width: ew, height: eh, color: rgb(col.r, col.g, col.b), opacity: 0.85, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 1, ...(pdfRotVal ? { rotate: pdfRotVal } : {}) });
  if (ce.text) {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    // Text starts at top of box with 4px padding + ~10pt ascent (matches canvas textarea layout)
    // Upright in the editor's frame, so it wraps at the DISPLAY width and turns with the box.
    const anchor2 = place(ce.x + 4, ce.y + 4 + 10);
    page.drawText(clampCommentText(ce.text), { x: anchor2.x, y: anchor2.y, size: 10, font, color: rgb(0, 0, 0), maxWidth: ce.width - 8, lineHeight: 14, opacity: 0.9, ...(orient ? { rotate: orient } : {}) });
  }
}

function renderRedaction(element: PDFElement, ctx: PdfRenderCtx, hlp: RenderHelpers): Promise<void> {
  const { page, libs } = ctx;
  const { rgb } = libs;
  const { swapDims, pdfRotVal, anchorForCenter, rectAnchor } = hlp;
  const ew = swapDims ? element.height : element.width;
  const eh = swapDims ? element.width : element.height;
  const corner = rectAnchor(element.x, element.y, element.width, element.height);
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

  // Content-space bottom-left anchor = AABB-min of the displayed rect's 4 mapped corners.
  // Rotation by a 90° multiple keeps the rect axis-aligned, so the AABB is exact. At rot=0
  // this is exactly tp(x, y+h) — byte-identical to the prior single-corner anchor.
  const rectAnchor = (x: number, y: number, wd: number, ht: number) => {
    const c0 = tp(x, y), c1 = tp(x + wd, y), c2 = tp(x, y + ht), c3 = tp(x + wd, y + ht);
    return {
      x: Math.min(c0.x, c1.x, c2.x, c3.x),
      y: Math.min(c0.y, c1.y, c2.y, c3.y),
    };
  };

  // Oriented overlays (A3-pre, 2026-09-26). The viewer turns the page by `totalRot` clockwise, so
  // anything with a reading direction is drawn turned `totalRot` counter-clockwise to cancel it,
  // then by the element's own rotation clockwise (pdf-lib `rotate` is CCW) — hence the difference.
  // Before this, only `-elemRot` was applied: on a rotated page text, pictures, codes, signatures and
  // comments came out turned by the page rotation, and pictures squashed into swapped dimensions.
  const upright = !elemRot && !totalRot;
  const orientDeg = totalRot - elemRot;
  const orient = upright ? pdfRotVal : (libs.degrees ? libs.degrees(orientDeg) : undefined);
  const pivotX = element.x + element.width / 2, pivotY = element.y + element.height / 2;
  const place = (px: number, py: number) => {
    if (!elemRot) return tp(px, py);
    const r = _rotateInElementSpace(px, py, pivotX, pivotY, elemRot);
    return tp(r.x, r.y);
  };
  const placeBox = (bx: number, by: number, bw: number, bh: number) => {
    if (upright) {
      const corner = rectAnchor(bx, by, bw, bh);
      return { x: corner.x, y: corner.y, width: bw, height: bh, ...(orient ? { rotate: orient } : {}) };
    }
    // Centre of the sub-box, turned with the element, then back off half its size along the drawn
    // axes — pdf-lib turns the picture about its bottom-left anchor.
    const c = place(bx + bw / 2, by + bh / 2);
    const { c: cos, s: sin } = cosSinDeg(orientDeg);
    const ox = -bw / 2, oy = -bh / 2;
    return { x: c.x + ox * cos - oy * sin, y: c.y + ox * sin + oy * cos, width: bw, height: bh, ...(orient ? { rotate: orient } : {}) };
  };

  return RENDERERS[element.type](element, ctx, { tp, swapDims, elemRot, pdfRotVal, anchorForCenter, rectAnchor, Ho, place, orient, orientDeg, placeBox });
}
