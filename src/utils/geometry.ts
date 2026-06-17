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
