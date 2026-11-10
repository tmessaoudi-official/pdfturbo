import { paintStrokes } from './signaturePad';
import type { SignaturePoint } from './signatureStrokes';

/**
 * The drawn signature as its own image (phone-signature-pad plan step 4, ruled 2026-11-10 22:41): transparent
 * background, trimmed to the strokes plus a margin of one line width (a round cap or a tap's dot reaches half a line
 * width past its point, so nothing is clipped), drawn at `scale` device pixels per CSS px. Null when nothing is drawn.
 */
export function strokesToCanvas(
  strokes: readonly SignaturePoint[][],
  style: { color: string; lineWidth: number; scale: number },
): HTMLCanvasElement | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes)
    for (const p of s) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  if (minX === Infinity) return null; // nothing drawn
  const margin = style.lineWidth;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((maxX - minX + 2 * margin) * style.scale);
  canvas.height = Math.ceil((maxY - minY + 2 * margin) * style.scale);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(style.scale, 0, 0, style.scale, (margin - minX) * style.scale, (margin - minY) * style.scale);
  paintStrokes(ctx, strokes, style.color, style.lineWidth);
  return canvas;
}
