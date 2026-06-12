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
