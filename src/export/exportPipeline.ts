/**
 * exportPipeline — pure shared helpers for PDF page assembly.
 *
 * Extracted from ExportService to eliminate the rotation/cropBox/watermark/ink
 * pipeline that was duplicated across downloadPDF, downloadPage, downloadPageAsImage,
 * and _rasterizePageWithRedactions.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { renderElementToPdfLib, type PdfRenderCtx } from './pdfElementRenderer';
import { transformPoint, hexToRgbValues, contentCropToPdfCropBox, redactionRectToPageSpace, rotatedElementFootprint } from '../utils/geometry';
import { dataUrlToUint8Array } from '../utils/binaryUtils';
import { densitySpacingFactor } from '../utils/watermarkDensity';
import type { PDFElement } from '../elements/annotationElement';
import type { DocumentPage, WatermarkSettings } from '../core/documentModel';
import type { InkLayer } from '../infra/inkLayer';
import type { IErrorReporter } from '../core/errorReporter';
import type { PdfLibOps, PdfLibDrawOps } from '../utils/pdfLibTypes';
import { batesStampText, batesPosition, type BatesSettings } from './batesStamp';
import { isEnabled } from '../config/features';

// ── Shared context for page overlay assembly ─────────────────────────────────

export interface BuildPageCtx {
  pdfDoc: import('@cantoo/pdf-lib').PDFDocument;
  page: import('@cantoo/pdf-lib').PDFPage;
  docPage: DocumentPage;
  elements: PDFElement[];
  pdfLib: PdfLibOps;
  userRot: number;
  sourceRot: number;
  watermark: WatermarkSettings;
  inkLayer: InkLayer;
  reportError: IErrorReporter;
  /** #61 Bates / page-number stamp; omitted or disabled = no stamp. */
  bates?: BatesSettings;
  /** 1-based full-document position of this page (for the stamp number). */
  pageNumber?: number;
  /** Full-document page count (for "N / total"). */
  pageCount?: number;
  /**
   * #QA-2026-06-23 — when true, skip the final `page.setCropBox` call only. The redaction
   * rasterizer sets this so it renders the FULL (uncropped) page and clips the canvas to the
   * crop window LAST — keeping the burn and content in one coordinate space so the burn can
   * never drift off the secret. All other overlay drawing is unchanged.
   */
  skipCropBox?: boolean;
}

// ── Pure geometry helper ─────────────────────────────────────────────────────

export function getPageCropBox(
  page: import('@cantoo/pdf-lib').PDFPage,
): { x: number; y: number; width: number; height: number } {
  try {
    const cb = page.getCropBox?.();
    if (cb && typeof cb.width === 'number') return { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
  } catch { /* no CropBox */ }
  const { width, height } = page.getSize();
  return { x: 0, y: 0, width, height };
}

/**
 * Does a source annotation's `/Rect` fall under a redaction, and so have to be removed before
 * the page is rasterized?
 *
 * pdf.js paints annotation appearance streams AFTER the page content stream, and the redaction
 * burn lives IN that content stream — so an annotation over a redaction is repainted ON TOP of
 * the burn and baked into the exported pixels. That makes the "redacted" content plainly
 * VISIBLE, not merely extractable, which is why the whole annotation is dropped.
 *
 * `rect` is a PDF `/Rect` in ABSOLUTE user space (y-up); `redactions` and `pageTopY` must both
 * come from {@link redactionRectToPageSpace} / the page's `viewBox[3]`, i.e. x in absolute user
 * space and y measured down from the crop top — the same convention `imagePlacementRedacted`
 * and `isItemRedacted` use.
 *
 * Exported for direct testing. Trivial geometry, but the SAFETY depends on it.
 */
export function annotationRectRedacted(
  rect: readonly number[],
  redactions: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
  pageTopY: number,
): boolean {
  if (redactions.length === 0) return false;
  const [x1, y1, x2, y2] = rect;
  if (![x1, y1, x2, y2].every(n => Number.isFinite(n))) return true; // unreadable → fail CLOSED
  // NORMALISE: a /Rect's corners may be stored in any order (the spec does not require
  // lower-left-first), and raw comparisons on a reversed pair FAIL OPEN — the annotation
  // genuinely overlaps yet is kept and repainted over the burn. Same defect shape as the
  // negative-height rect in `dropElementsUnderRedactions`, so it gets the same treatment.
  const xL = Math.min(x1, x2), xR = Math.max(x1, x2);
  // y-up user space → y-down from the crop top, matching the redaction rects' convention.
  const yTop = pageTopY - Math.max(y1, y2), yBot = pageTopY - Math.min(y1, y2);
  return redactions.some(r =>
    xL < r.x + r.width && xR > r.x && yTop < r.y + r.height && yBot > r.y);
}

// ── Ink layer helper ─────────────────────────────────────────────────────────

export function renderInkForExport(
  inkLayer: InkLayer,
  pageId: string,
  W_orig: number,
  H_orig: number,
  totalRot: number,
  /**
   * Redaction rects on this page, in editor DISPLAY space — the same frame the ink strokes are
   * stored in. Omitted (or empty) → the baked layer is byte-identical to the pre-WS4-A output,
   * which is the path ~85% of pages take.
   *
   * WS4-A: the burn is drawn inside the element loop of {@link buildPageOverlays} and the ink layer
   * is stamped AFTER it, so a stroke crossing a redaction was composited ON TOP of the opaque box
   * and baked into the export — visibly readable, the same grade as the 2026-08-29 annotation leak
   * and worse than an extractable one. Clipping happens HERE, on the ink canvas, rather than at the
   * call site by dropping whole strokes: the covered pixels go and the rest of the same stroke
   * stays, which is why the guard carries an over-reach control.
   */
  redactions?: ReadonlyArray<{ x: number; y: number; width: number; height: number; rotation?: number }>,
): string | null {
  const strokes = inkLayer.getStrokes(pageId);
  if (!strokes.length) return null;

  const SCALE = 2;
  const c = document.createElement('canvas');
  c.width  = Math.round(W_orig * SCALE);
  c.height = Math.round(H_orig * SCALE);
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  /**
   * Display space → ink-canvas pixels. Strokes AND redaction rects both go through this one
   * function, so the clip cannot end up in a different frame from the ink it is clipping — the
   * lockstep is structural rather than a thing to remember. Every frame bug in this repo has been
   * two call sites that agreed until one of them was edited.
   */
  const toCanvas = (px: number, py: number): { x: number; y: number } => {
    const pdf = transformPoint(px, py, W_orig, H_orig, totalRot);
    return { x: pdf.x * SCALE, y: (H_orig - pdf.y) * SCALE };
  };

  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    ctx.save();
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke.width * SCALE;
    if (stroke.type === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color;
    }
    const pts = stroke.points.map(p => toCanvas(p.x, p.y));
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  // WS4-A — punch the redactions out of the finished ink. Done AFTER every stroke so an erase
  // stroke cannot re-open a hole in the clip, and with `destination-out` so the covered pixels are
  // removed rather than painted over: nothing downstream can recover them, and the burn shows
  // through as the burn rather than as a second black box of our own.
  if (redactions?.length) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    for (const r of redactions) {
      // All four corners, then the AABB. Rotations here are multiples of 90°, so the AABB IS the
      // rotated rect — no over-approximation. Normalising via min/max also absorbs a negative
      // width/height, which `interactionHandler.resize` can produce and which would otherwise make
      // `fillRect` a no-op and fail OPEN (the same negative-extent trap as `#bg-fill` and
      // `dropElementsUnderRedactions`).
      // WS4-B — the element's OWN rotation first (a rotated redaction protrudes from its stored
      // box), then the page's via `toCanvas`. Without the footprint the clip covers only the
      // upright box and ink under the protruding parts survives under the burn: the A fix would
      // have shipped with exactly the leak B exists to close, on the one path B does not reach.
      const fp = rotatedElementFootprint(r);
      const cs = [
        toCanvas(fp.x, fp.y), toCanvas(fp.x + fp.width, fp.y),
        toCanvas(fp.x, fp.y + fp.height), toCanvas(fp.x + fp.width, fp.y + fp.height),
      ];
      const x0 = Math.min(...cs.map(p => p.x)), x1 = Math.max(...cs.map(p => p.x));
      const y0 = Math.min(...cs.map(p => p.y)), y1 = Math.max(...cs.map(p => p.y));
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.restore();
  }

  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return c.toDataURL('image/png');
  }
  // Every stroke fell under a redaction → no image is stamped at all, which is the correct
  // degenerate case and not a special one: this early-out predates WS4-A.
  return null;
}

// ── Watermark helper ─────────────────────────────────────────────────────────

export async function drawWatermarkOnPage(
  page: import('@cantoo/pdf-lib').PDFPage,
  W_orig: number,
  H_orig: number,
  cropOriginX: number,
  cropOriginY: number,
  watermark: WatermarkSettings,
  libs: PdfLibDrawOps,
): Promise<void> {
  const { rgb, degrees, pdfDoc, StandardFonts } = libs;
  const col = hexToRgbValues(watermark.color);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const textWidth = font.widthOfTextAtSize(watermark.text, watermark.fontSize);
  const spacingFactor = densitySpacingFactor(watermark.density ?? 3);
  const stepX = Math.max(textWidth + watermark.fontSize * 0.8, W_orig / 5) * spacingFactor;
  const stepY = Math.max(watermark.fontSize * 2, H_orig / 4) * spacingFactor;
  for (let y = cropOriginY - (stepY / 2); y < cropOriginY + H_orig + stepY; y += stepY) {
    for (let x = cropOriginX - (stepX / 2); x < cropOriginX + W_orig + stepX; x += stepX) {
      page.drawText(watermark.text, {
        x: x - textWidth / 2,
        y,
        size: watermark.fontSize,
        font,
        color: rgb(col.r, col.g, col.b),
        opacity: watermark.opacity,
        rotate: degrees(watermark.angle),
      });
    }
  }
}

// ── Bates / page-number helper ───────────────────────────────────────────────

export async function drawBatesOnPage(
  page: import('@cantoo/pdf-lib').PDFPage,
  W_orig: number,
  H_orig: number,
  cropOriginX: number,
  cropOriginY: number,
  bates: BatesSettings,
  pageNumber: number,
  pageCount: number,
  libs: PdfLibDrawOps,
  totalRot = 0,
): Promise<void> {
  const { rgb, pdfDoc, StandardFonts } = libs;
  const text = batesStampText(bates, pageNumber, pageCount);
  if (!text) return;
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const textWidth = font.widthOfTextAtSize(text, bates.fontSize);
  const MARGIN = 24;
  const rot = ((totalRot % 360) + 360) % 360;

  // The user picks a corner of the VISUAL (rotated) page, so place the stamp in
  // the rotated frame (dims swapped for 90/270), then map that anchor back to
  // unrotated content space via transformPoint — the page's /Rotate re-rotates
  // the drawn text so it appears upright at the chosen corner (same mechanism
  // the element renderer uses). At rot=0 transformPoint is the identity y-flip,
  // so this is byte-identical to the pre-fix path (with or without a crop).
  const visW = (rot === 90 || rot === 270) ? H_orig : W_orig;
  const visH = (rot === 90 || rot === 270) ? W_orig : H_orig;
  const { x: vx, y: vyUp } = batesPosition(bates.position, visW, visH, textWidth, bates.fontSize, MARGIN);
  // batesPosition returns a y-UP baseline anchor in the visual box; convert to
  // display (y-down) for transformPoint, which maps display→content (y-up).
  const content = transformPoint(vx, visH - vyUp, W_orig, H_orig, rot);
  const col = hexToRgbValues(bates.color);
  page.drawText(text, {
    x: cropOriginX + content.x,
    y: cropOriginY + content.y,
    size: bates.fontSize,
    font,
    color: rgb(col.r, col.g, col.b),
  });
}

// ── Core pipeline: apply overlays to a pdf-lib page ─────────────────────────

export async function buildPageOverlays(ctx: BuildPageCtx): Promise<void> {
  const { pdfDoc, page, docPage, elements, pdfLib, userRot, sourceRot, watermark, inkLayer, reportError } = ctx;
  const { rgb, degrees, StandardFonts } = pdfLib;

  const totalRot = ((sourceRot + userRot) % 360 + 360) % 360;
  if (userRot) page.setRotation(degrees(totalRot));

  const cropBox = getPageCropBox(page);
  const { width: W_orig, height: H_orig, x: cropOriginX, y: cropOriginY } = cropBox;
  const w_eff = (totalRot === 90 || totalRot === 270) ? H_orig : W_orig;
  const h_eff = (totalRot === 90 || totalRot === 270) ? W_orig : H_orig;

  // #G23 crop: a user crop narrows the visible page to a sub-box. Elements + ink keep their
  // SOURCE-box coordinates (the CropBox clips them); the watermark + Bates use the cropped
  // "effective box" so they tile/anchor inside the crop. No crop → effBox === cropBox, so the
  // export is byte-identical to the pre-crop path.
  // #28 kill switch, honoured on the EXPORT path and not only in the UI. `main.ts` removes the
  // buttons when a flag is off, but crop and Bates state PERSISTS to IndexedDB and is restored on
  // load — so without these two gates a session created while the flag was on keeps being cropped
  // and stamped after the feature has been switched off. That makes the switch kill the button
  // rather than the feature, which is the opposite of what a kill switch is for, and it matters
  // most for crop: crop is destructive on a redaction-bearing page. Both flags default ON and an
  // undefined env reads as ON, so with stock configuration these are no-ops.
  const cropEnabled = isEnabled('crop');
  const effBox = (docPage.crop && cropEnabled) ? contentCropToPdfCropBox(docPage.crop, cropBox) : cropBox;

  const exportErrors: string[] = [];
  const exportErrorTypes = new Set<string>();
  for (const element of elements) {
    try {
      await renderElementToPdfLib(element, { pdfDoc, page, libs: { rgb, StandardFonts, degrees }, h: h_eff, w: w_eff, W_orig, H_orig, totalRot, cropOriginX, cropOriginY } satisfies PdfRenderCtx);
    } catch (e) {
      // Fail-CLOSED for redactions: a swallowed redaction render would leave the
      // source content it must destroy visible in the export (a security leak).
      // Better to abort the export than to ship an un-redacted page.
      if (element.type === 'redaction') throw e;
      exportErrors.push(`${element.type} (id ${element.id})`);
      exportErrorTypes.add(element.type);
    }
  }
  if (exportErrors.length > 0) {
    // Name the element type(s) so the user knows WHAT failed (not just a count).
    reportError.warn('toast.elementRenderFailed', { count: exportErrors.length, types: [...exportErrorTypes].join(', ') });
    reportError.silent(undefined, `Export render failed: ${exportErrors.join(', ')}`);
  }

  if (watermark.enabled) {
    await drawWatermarkOnPage(page, effBox.width, effBox.height, effBox.x, effBox.y, watermark, { rgb, degrees, pdfDoc, StandardFonts });
  }

  // WS4-A: ink is stamped after the burn, so it must be clipped to the redactions rather than
  // composited over them. `elements` is this page's set, already filtered by the caller.
  const inkDataUrl = renderInkForExport(
    inkLayer, docPage.id, W_orig, H_orig, totalRot,
    elements.filter(el => el.type === 'redaction'),
  );
  if (inkDataUrl) {
    const inkImg = await pdfDoc.embedPng(dataUrlToUint8Array(inkDataUrl));
    page.drawImage(inkImg, { x: cropOriginX, y: cropOriginY, width: W_orig, height: H_orig });
  }

  // #61 Bates / page number — drawn last so it sits above content; uses the
  // page's full-document position so single-page / range exports stay correct.
  if (isEnabled('bates') && ctx.bates?.enabled && ctx.pageNumber !== undefined && ctx.pageCount !== undefined) {
    await drawBatesOnPage(page, effBox.width, effBox.height, effBox.x, effBox.y, ctx.bates, ctx.pageNumber, ctx.pageCount, { rgb, degrees, pdfDoc, StandardFonts }, totalRot);
  }

  // #G23 crop: clip the page to the user crop. Applied LAST — after overlays draw in
  // source-box space — so element/ink positions are unaffected; the viewer then shows only
  // the crop window. The redaction rasterizer passes skipCropBox=true and clips the CANVAS
  // instead (so its full-page burn coords stay correct — #QA-2026-06-23).
  if (docPage.crop && cropEnabled && !ctx.skipCropBox) {
    page.setCropBox(effBox.x, effBox.y, effBox.width, effBox.height);
  }
}

// ── Redaction rasterizer ─────────────────────────────────────────────────────

/**
 * Remove every source annotation whose `/Rect` meets a redaction on this page.
 *
 * Operates on the pdf-lib page's `/Annots` array in place, before the page is serialised for
 * pdf.js. See {@link annotationRectRedacted} for why the whole annotation goes.
 *
 * Iterates BACKWARDS because `PDFArray.remove` shifts every later index down — a forward loop
 * skips the entry after each removal, which on two adjacent covered annotations would leave the
 * second one live. Fail-CLOSED on an unreadable `/Rect`: this page carries a redaction, so an
 * annotation we cannot place is one we cannot prove is safe.
 */
export async function stripRedactedAnnotations(
  page: import('@cantoo/pdf-lib').PDFPage,
  elements: PDFElement[],
  pageId: string,
  cropBox: { x: number; y: number; width: number; height: number },
  totalRot: number,
): Promise<void> {
  const { PDFArray, PDFNumber, PDFName, PDFDict } = await import('@cantoo/pdf-lib');

  const viewBox = [cropBox.x, cropBox.y, cropBox.x + cropBox.width, cropBox.y + cropBox.height];
  const redactions = elements
    .filter(el => el.pageId === pageId && el.type === 'redaction')
    .map(el => redactionRectToPageSpace(
      el, viewBox, totalRot,
    ));
  if (redactions.length === 0) return;

  // Same throw-on-wrong-type caveat as below. If `/Annots` is present but is not an array we
  // cannot enumerate it, and this page carries a redaction — so drop the whole entry rather
  // than render annotations we could not test. Malformed and rare; over-approximating is the
  // safe direction, and it keeps a `catch` from degrading the thumbnail path to a plain
  // un-redacted raster (pageThumbnailPanel falls back to `generateThumbnail` on a null result).
  let annots: import('@cantoo/pdf-lib').PDFArray | undefined;
  try {
    annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  } catch {
    page.node.delete(PDFName.of('Annots'));
    return;
  }
  if (!annots) return;

  for (let i = annots.size() - 1; i >= 0; i--) {
    // The lookup is INSIDE the try: a wrong-TYPE entry (a bare number in /Annots, say) throws
    // exactly as a wrong-typed /Rect does. Left uncaught it propagated, and on the thumbnail
    // path a throw degrades to a plain UN-REDACTED raster — the degradation the wholesale
    // delete above exists to avoid. An entry we cannot read is one we cannot prove is safe.
    let dict: import('@cantoo/pdf-lib').PDFDict | undefined;
    try {
      dict = annots.lookupMaybe(i, PDFDict);
    } catch {
      annots.remove(i);
      continue;
    }
    // No dict (a dangling ref) → nothing renders, so leaving it cannot leak; skip rather than
    // remove, keeping this pass byte-neutral for anything it does not understand.
    if (!dict) continue;
    // `lookupMaybe` returns undefined only for an ABSENT or null object — on a present-but-
    // wrong-TYPE object it THROWS `UnexpectedObjectTypeError` (PDFContext.js:62-81). So a
    // malformed `/Rect` (a string, or `[0 0 100 /Foo]`) escapes the NaN path entirely. Catching
    // here and removing is what makes the "fail CLOSED" claim actually true for every shape,
    // rather than only for a missing or null rect.
    let redacted: boolean;
    try {
      const rectArr = dict.lookupMaybe(PDFName.of('Rect'), PDFArray);
      const rect = rectArr && rectArr.size() === 4
        ? [0, 1, 2, 3].map(k => rectArr.lookupMaybe(k, PDFNumber)?.asNumber() ?? NaN)
        : [NaN, NaN, NaN, NaN];
      redacted = annotationRectRedacted(rect, redactions, viewBox[3]);
    } catch {
      redacted = true; // unreadable on a redacted page → cannot be proven safe
    }
    if (redacted) annots.remove(i);
  }
}

export async function rasterizePageWithRedactions(
  srcDoc: import('@cantoo/pdf-lib').PDFDocument,
  docPage: DocumentPage,
  elements: PDFElement[],
  targetPdfDoc: import('@cantoo/pdf-lib').PDFDocument,
  libs: PdfLibOps,
  watermark: WatermarkSettings,
  inkLayer: InkLayer,
  reportError: IErrorReporter,
  bates?: BatesSettings,
  pageNumber?: number,
  pageCount?: number,
): Promise<void> {
  const { PDFDocument, rgb, StandardFonts } = await import('@cantoo/pdf-lib');
  void rgb; void StandardFonts;

  const tempDoc = await PDFDocument.create();
  const [tempPage] = await tempDoc.copyPages(srcDoc, [docPage.sourcePageNum - 1]);
  tempDoc.addPage(tempPage);

  const userRot  = docPage.rotation ?? 0;
  const srcRot   = tempPage.getRotation().angle as number;

  // ── Source annotations under a redaction must be removed BEFORE the render ────────────────
  // The burn is written into the page CONTENT STREAM, but pdf.js paints annotation appearance
  // streams AFTER it — so a FreeText note, a stamp or an un-flattened form widget sitting over
  // a redaction is repainted ON TOP of the burn and baked into the exported pixels, VISIBLY.
  // Measured before this fix: the covered annotation's centre sampled (255,0,0) through an
  // opaque black burn. This refutes the old #62b claim that the rasterize path already covered
  // source markup annotations. Drop-whole and over-approximating, matching the image channel;
  // annotations clear of every redaction are untouched (guarded by a CONTROL assertion).
  //
  // Runs BEFORE `buildPageOverlays`, which MUTATES the page's rotation and CropBox. This path
  // would survive reading them afterwards (it captures `srcRot` above and passes `skipCropBox`),
  // but its sibling in `_applyOverlaysToPage` did not, and the leak came back silently. Both
  // sites now take the frame from pristine state so neither depends on that subtlety.
  await stripRedactedAnnotations(
    tempPage, elements, docPage.id, getPageCropBox(tempPage),
    ((srcRot + userRot) % 360 + 360) % 360,
  );

  // Draw ALL elements (redactions included) in array/stacking order through the vector bake,
  // then rasterize the whole page. Array order == on-screen stacking, so an overlay placed ON
  // TOP of a redaction renders above the burn (the user-requested behavior) while one placed
  // under it stays under. The redaction is an OPAQUE filled rect (renderRedaction), so it still
  // destroys the SOURCE content beneath it once flattened — and renderRedaction now anchors via
  // the rotation-correct rectAnchor (see pdfElementRenderer), so the burn covers its target on
  // rotated pages too. A redaction render failure is fail-CLOSED in buildPageOverlays (re-throws).
  await buildPageOverlays({
    pdfDoc: tempDoc,
    page: tempPage,
    docPage,
    elements,
    pdfLib: libs,
    userRot,
    sourceRot: srcRot,
    watermark,
    inkLayer,
    reportError,
    bates, pageNumber, pageCount,
    // Render the FULL (uncropped) page; the crop is applied as a canvas clip below so the
    // overlay/burn coords stay in full-page space (#QA-2026-06-23 leak fix).
    skipCropBox: true,
  });

  const totalRot = ((srcRot + userRot) % 360 + 360) % 360;
  const cropBoxR = getPageCropBox(tempPage);
  const { width: W_orig, height: H_orig } = cropBoxR;
  const w_eff = (totalRot === 90 || totalRot === 270) ? H_orig : W_orig;
  const h_eff = (totalRot === 90 || totalRot === 270) ? W_orig : H_orig;

  const tempBytes  = await tempDoc.save({ useObjectStreams: false });
  const renderDoc  = await pdfjsLib.getDocument({ data: tempBytes }).promise;
  const renderPage = await renderDoc.getPage(1);
  const SCALE = 2;
  const vp = renderPage.getViewport({ scale: SCALE });

  const offscreen = document.createElement('canvas');
  offscreen.width  = Math.round(vp.width);
  offscreen.height = Math.round(vp.height);
  await renderPage.render({ canvas: offscreen, viewport: vp }).promise;

  // Redactions, text, and every other overlay were drawn (in array/stacking order) into the
  // page above and flattened by this rasterization — no separate post-raster burn/text pass is
  // needed. Source content under each opaque redaction rect is destroyed in these pixels.

  // #QA-2026-06-23 — apply the crop by clipping the rendered CANVAS (not via setCropBox before
  // render). Everything above is drawn in full-page coords matching the full render, so it can
  // never drift off its target; here we extract only the crop window. No crop → embed the full
  // canvas (byte-identical to the pre-fix uncropped path).
  let outCanvas: HTMLCanvasElement = offscreen;
  let outW = w_eff, outH = h_eff;
  // Same #28 gate as the vector path above — the raster path clips the CANVAS instead of setting
  // a CropBox, so it needs its own check or a disabled crop would still apply here.
  if (docPage.crop && isEnabled('crop')) {
    const effBox = contentCropToPdfCropBox(docPage.crop, cropBoxR);
    // Map the crop window's user-space corners to canvas pixels — convertToViewportPoint
    // applies the viewport's rotation + scale, so this is correct for /Rotate'd pages too.
    const [ax, ay] = vp.convertToViewportPoint(effBox.x, effBox.y);
    const [bx, by] = vp.convertToViewportPoint(effBox.x + effBox.width, effBox.y + effBox.height);
    const clipX = Math.round(Math.min(ax, bx));
    const clipY = Math.round(Math.min(ay, by));
    const clipW = Math.max(1, Math.round(Math.abs(bx - ax)));
    const clipH = Math.max(1, Math.round(Math.abs(by - ay)));
    const clip = document.createElement('canvas');
    clip.width = clipW;
    clip.height = clipH;
    const cctx = clip.getContext('2d') as CanvasRenderingContext2D;
    cctx.drawImage(offscreen, -clipX, -clipY);
    outCanvas = clip;
    outW = clipW / SCALE;
    outH = clipH / SCALE;
  }

  const pngBytes = await new Promise<Uint8Array>((resolve, reject) => {
    outCanvas.toBlob((blob) => {
      if (!blob) { reject(new Error('canvas toBlob failed')); return; }
      blob.arrayBuffer().then(ab => resolve(new Uint8Array(ab)), reject);
    }, 'image/png');
  });

  const pngImg  = await targetPdfDoc.embedPng(pngBytes);
  const newPage = targetPdfDoc.addPage([outW, outH]);
  newPage.drawImage(pngImg, { x: 0, y: 0, width: outW, height: outH });

  // #QA-2026-06-23 P2: release the pdf.js worker doc (doc.destroy() is a v6 no-op — the
  // loadingTask owns the worker). Matches the _compressLossy cleanup in exportService.
  const task = (renderDoc as { loadingTask?: { destroy?: () => Promise<void> } }).loadingTask;
  if (task && typeof task.destroy === 'function') void task.destroy().catch(() => {});
}
