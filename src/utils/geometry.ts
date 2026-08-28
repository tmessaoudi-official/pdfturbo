/**
 * Pure geometry utilities for coordinate-space transforms between
 * PDF content space (bottom-left origin, Y-up) and canvas space
 * (top-left origin, Y-down) across page rotation angles.
 */

/** Canvas space → PDF content space for a given rotation (0/90/180/270). */
export function transformPoint(px: number, py: number, W: number, H: number, totalRot: number): { x: number; y: number } {
  switch (((totalRot % 360) + 360) % 360) {
    case 90:  return { x: py,     y: px     };
    case 180: return { x: W - px, y: py     };
    case 270: return { x: W - py, y: H - px };
    default:  return { x: px,     y: H - py };
  }
}

/** PDF content space → canvas space for a given rotation (inverse of transformPoint). */
export function inverseTransformPoint(pdfX: number, pdfY: number, W: number, H: number, totalRot: number): { x: number; y: number } {
  switch (((totalRot % 360) + 360) % 360) {
    case 90:  return { x: pdfY,     y: pdfX     };
    case 180: return { x: W - pdfX, y: pdfY     };
    case 270: return { x: H - pdfY, y: W - pdfX };
    default:  return { x: pdfX,     y: H - pdfY };
  }
}

/** Re-project a canvas-space point from one page rotation to another. */
export function transformCanvasPoint(cx: number, cy: number, W: number, H: number, fromRot: number, toRot: number): { x: number; y: number } {
  const pdf = transformPoint(cx, cy, W, H, fromRot);
  return inverseTransformPoint(pdf.x, pdf.y, W, H, toRot);
}

/**
 * Map a redaction rectangle from editor DISPLAYED space (the on-screen rotated
 * orientation the user placed it in — y-down, top-left origin, dims = rotated page)
 * into UNROTATED content space (y-down, top-left origin, W×H = unrotated dims).
 *
 * Flow-export (DOCX/MD/TXT) drops text items whose boxes intersect a redaction rect,
 * but pdf.js reports text items in unrotated content space, so the rect must be
 * un-rotated to match (see flowDoc.isItemRedacted). Reduces to identity at rotation 0.
 * `W`/`H` are the UNROTATED content dimensions; `totalRot` is `(page.rotate + userRotation) % 360`.
 */
export function redactionRectToContent(
  rect: { x: number; y: number; width: number; height: number },
  W: number, H: number, totalRot: number,
): { x: number; y: number; width: number; height: number } {
  const corners: Array<[number, number]> = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [dx, dy] of corners) {
    const c = transformPoint(dx, dy, W, H, totalRot); // displayed → content (y-up)
    const cy = H - c.y;                               // content y-up → content y-down (top-left)
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Map a redaction rect from editor DISPLAY space into the frame pdf.js reports TEXT ITEMS and
 * IMAGE placements in, given the page's `viewBox` (its CropBox, `[x0, y0, x1, y1]`).
 *
 * ── Why this exists, and why {@link redactionRectToContent} alone is not enough ───────────
 * pdf.js reports `item.transform[4]/[5]` in ABSOLUTE PDF user space, but a redaction element's
 * rect is relative to the RENDERED page box — i.e. the CropBox. The two frames differ by exactly
 * `(x0, y0)`. On the near-universal `/CropBox [0 0 w h]` page they coincide, so comparing them
 * directly appears to work and every fixture agrees; give the page a non-zero origin and the
 * intersection test silently matches nothing and the redacted text is handed back by the flow
 * (DOCX/MD/TXT) and table (CSV/XLSX) exports. This is the same class as the `/Rotate 90|270`
 * leak fixed earlier on these paths — rect and items compared in different frames.
 *
 * The two paths that BAKE pixels already got this right (`pdfElementRenderer`'s
 * `cropOriginX/Y`, and the OCR burn's `unrot.viewBox[0]/[1]`); only the two that EXTRACT text
 * were missing it.
 *
 * Returns a rect whose **x is absolute user-space** and whose **y is measured DOWN from the
 * crop box's top edge**. That is precisely the frame `flowDoc.isItemRedacted` compares in when
 * it is given `viewBox[3]` as its `pageTopY` — pass the two together, from the same viewBox.
 *
 * Identity-preserving: with `viewBox = [0, 0, W, H]` this returns exactly what
 * {@link redactionRectToContent} returns, so ordinary pages are byte-for-byte unaffected.
 */
export function redactionRectToPageSpace(
  rect: { x: number; y: number; width: number; height: number },
  viewBox: readonly number[],
  totalRot: number,
): { x: number; y: number; width: number; height: number } {
  const x0 = viewBox[0], y0 = viewBox[1], x1 = viewBox[2], y1 = viewBox[3];
  // Rotation acts on the RENDERED box, so un-rotate within the crop dimensions first, then
  // translate. Composing the other way round would rotate the origin offset too.
  const c = redactionRectToContent(rect, x1 - x0, y1 - y0, totalRot);
  // y needs no term: it is already measured down from the crop TOP, which is what `pageTopY`
  // (= y1) makes `isItemRedacted` measure an item's glyph box against.
  return { x: c.x + x0, y: c.y, width: c.width, height: c.height };
}

/**
 * Inverse of {@link redactionRectToContent}: map a rect from UNROTATED content
 * space (y-down, top-left, W×H = unrotated dims) back into editor DISPLAYED space
 * (the on-screen rotated orientation, y-down, top-left). Used to draw a persisted
 * page crop's dimmed frame at the page's current rotation. Identity at rotation 0.
 * `W`/`H` are the UNROTATED content dimensions; `totalRot` is `(page.rotate + userRotation) % 360`.
 */
export function contentRectToDisplay(
  rect: { x: number; y: number; width: number; height: number },
  W: number, H: number, totalRot: number,
): { x: number; y: number; width: number; height: number } {
  const corners: Array<[number, number]> = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [cx, cyDown] of corners) {
    const cyUp = H - cyDown;                                  // content y-down → y-up
    const d = inverseTransformPoint(cx, cyUp, W, H, totalRot); // content y-up → displayed (y-down)
    if (d.x < minX) minX = d.x;
    if (d.x > maxX) maxX = d.x;
    if (d.y < minY) minY = d.y;
    if (d.y > maxY) maxY = d.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Convert a page crop stored in UNROTATED content space (y-down, top-left,
 * relative to the source content/CropBox) into a pdf-lib `/CropBox` in user space
 * (y-up, bottom-left). The crop is rotation-invariant — the page's `/Rotate`
 * rotates the view around this box — so no rotation term is needed here.
 */
export function contentCropToPdfCropBox(
  crop: { x: number; y: number; width: number; height: number },
  srcCropBox: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  return {
    x: srcCropBox.x + crop.x,
    y: srcCropBox.y + (srcCropBox.height - (crop.y + crop.height)),
    width: crop.width,
    height: crop.height,
  };
}

/**
 * F-C C2 — map a rect drawn in editor DISPLAY space (rotated, y-down, top-left)
 * to a signature appearance rect in PDF USER space (y-up, bottom-left origin),
 * clamped to the page. Composes {@link redactionRectToContent} (display→unrotated
 * content, y-down) + {@link clampContentRect} + a y-flip into user space — the same
 * content space the e-signer validates against (`page.getSize()`, origin 0).
 * `W`/`H` are the UNROTATED page point dimensions; `totalRot = (page.rotate + userRotation) % 360`.
 */
export function displayRectToUserSpaceRect(
  rect: { x: number; y: number; width: number; height: number },
  W: number, H: number, totalRot: number,
): { x: number; y: number; width: number; height: number } {
  const c = clampContentRect(redactionRectToContent(rect, W, H, totalRot), W, H);
  return { x: c.x, y: H - (c.y + c.height), width: c.width, height: c.height };
}

/**
 * Inset a W×H box by per-edge MARGINS in points (#G23 v1b — the numeric companion to drag-to-crop).
 *
 * DELIBERATELY SPACE-AGNOSTIC. It is called with the page's *display* dimensions, because the user types
 * what they SEE — "100pt off the top" means the visual top — and the caller then maps the resulting rect
 * into unrotated content space with the very same `redactionRectToContent` the drag path uses. An earlier
 * version took content dims directly and so cropped the WRONG VISUAL EDGE on any page with `/Rotate ≠ 0`
 * (measured: at 90° a typed top margin removed the right-hand strip). Rotation belongs to the caller,
 * once, shared with the drag path — not re-derived here.
 *
 * Returns null when the margins leave under 1pt, so a caller never special-cases a degenerate crop —
 * mirroring the drag path's own guard. A NEGATIVE margin is clamped to 0 (it would mean OUTSETTING the
 * page, which a crop box cannot express); NaN is treated as 0 (an empty number input parses to NaN);
 * but a non-finite POSITIVE margin is left as-is so it refuses, rather than silently meaning "no margin"
 * — `1e999` parses to Infinity and must behave like the `1e9` next to it.
 */
export function marginsToRect(
  margins: { top: number; right: number; bottom: number; left: number },
  W: number,
  H: number,
): { x: number; y: number; width: number; height: number } | null {
  const nn = (v: number) => (Number.isNaN(v) ? 0 : Math.max(0, v));
  const left = nn(margins.left);
  const top = nn(margins.top);
  const rect = {
    x: left,
    y: top,
    width: W - left - nn(margins.right),
    height: H - top - nn(margins.bottom),
  };
  if (rect.width < 1 || rect.height < 1) return null;
  return clampContentRect(rect, W, H);
}

/** Clamp a content-space rect into the `[0,0,W,H]` content box (keeps width/height ≥ 0). */
export function clampContentRect(
  rect: { x: number; y: number; width: number; height: number },
  W: number, H: number,
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, Math.min(rect.x, W));
  const y = Math.max(0, Math.min(rect.y, H));
  const width = Math.max(0, Math.min(rect.width, W - x));
  const height = Math.max(0, Math.min(rect.height, H - y));
  return { x, y, width, height };
}

/**
 * Parse a CSS hex color string (#RRGGBB or RRGGBB) into normalized [0, 1] RGB components
 * suitable for pdf-lib color APIs.
 */
export function hexToRgbValues(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
  };
}
