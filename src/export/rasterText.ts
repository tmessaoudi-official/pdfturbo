import type { TextElement } from '../elements/textElement';

/**
 * Canvas-2D bake of an overlay TextElement, for the raster export path
 * (`rasterizePageWithRedactions` — redaction-bearing pages + thumbnails).
 *
 * Parity target = the vector bake (`pdfElementRenderer.renderText` +
 * `styledText.ts`): alignment, opacity, background, bold/italic, color, and the
 * Slice-2 advanced attrs — text stroke/outline (painted in the fill colour),
 * character spacing (Tc), horizontal scale (Tz), sub/superscript, justify — plus
 * underline / strikethrough decorations.
 *
 * Coordinates are DISPLAY space (y-down, top-left), multiplied by `scale`.
 * Element rotation is intentionally NOT applied here (the raster path renders
 * text upright — rotated overlay text is a documented ceiling, same as vector).
 * Arabic shaping is also out of scope here (the vector path uses Noto Naskh via
 * `drawArabicLine`; raster Arabic stays a known ceiling).
 */
export function drawTextElementToCanvas(
  ctx: CanvasRenderingContext2D,
  te: TextElement,
  scale: number,
): void {
  if (!te.text) return;

  const subSup = te.baselineShift;
  const drawFontPt = subSup ? te.fontSize * 0.65 : te.fontSize;
  const fontPx = drawFontPt * scale;
  const lineHeightDisp = te.fontSize * (te.lineHeight ?? 1.2); // display-space line advance
  const hsFactor = (te.horizontalScale ?? 100) / 100;
  const charSpacing = te.charSpacing ?? 0;
  const strokeWidth = te.strokeWidth ?? 0;
  const color = te.color || '#000000';
  // super = baseline up (negative y in y-down), sub = down. Matches renderText.
  const riseDisp = subSup === 'super' ? -(te.fontSize * 0.33)
    : subSup === 'sub' ? (te.fontSize * 0.15) : 0;

  ctx.save();
  ctx.globalAlpha = te.opacity ?? 1;
  ctx.textBaseline = 'alphabetic';

  // Background fill behind the whole box (unrotated — same as the vector guard).
  if (te.backgroundColor) {
    ctx.fillStyle = te.backgroundColor;
    ctx.fillRect(
      Math.round(te.x * scale),
      Math.round(te.y * scale),
      Math.round(te.width * scale),
      Math.round(te.height * scale),
    );
  }

  ctx.font = `${te.italic ? 'italic ' : ''}${te.bold ? 'bold ' : ''}${fontPx}px ${te.fontFamily || 'Arial'}, sans-serif`;
  // letterSpacing / wordSpacing are real canvas-state props in Chromium; both are
  // saved/restored with the context. Set unscaled (px) — the x-scale transform
  // below scales them visually, matching how Tc/Tw ride Tz in PDF.
  ctx.letterSpacing = charSpacing !== 0 ? `${charSpacing * scale}px` : '0px';

  const boxWpx = (te.width || 0) * scale;
  const lines = te.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const isLast = i === lines.length - 1;

    ctx.wordSpacing = '0px';
    const measured = ctx.measureText(line).width; // unscaled px, incl. letterSpacing
    const visualW = measured * hsFactor;

    // Justify (non-last line) distributes extra space across word gaps; otherwise
    // align via a left offset. Mirrors renderText.
    let offPx = 0;
    let lineVisualW = visualW;
    const spaces = (line.match(/ /g) ?? []).length;
    if (te.align === 'justify' && !isLast && spaces > 0 && boxWpx > visualW) {
      const targetUnscaled = boxWpx / hsFactor;
      const gap = (targetUnscaled - measured) / spaces;
      ctx.wordSpacing = `${gap}px`;
      lineVisualW = boxWpx; // fills the box
    } else if (te.align === 'center') {
      offPx = Math.max(0, (boxWpx - visualW) / 2);
    } else if (te.align === 'right') {
      offPx = Math.max(0, boxWpx - visualW);
    }

    const baseYpx = (te.y + te.fontSize * 0.9 + i * lineHeightDisp + riseDisp) * scale;

    ctx.save();
    // Apply horizontal scale about the line's start x. Inside this frame x is
    // "unscaled px" and the scale produces the visual width.
    ctx.translate(te.x * scale + offPx, 0);
    if (hsFactor !== 1) ctx.scale(hsFactor, 1);

    ctx.fillStyle = color;
    ctx.fillText(line, 0, baseYpx);
    if (strokeWidth > 0) {
      // Outline painted in the fill colour (no separate stroke colour) — matches styledText.
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth * scale;
      ctx.strokeText(line, 0, baseYpx);
    }

    // Underline / strikethrough as filled rects at the baseline (unrotated only).
    if (te.underline || te.strikethrough) {
      const thick = Math.max(1, te.fontSize * 0.06 * scale);
      const ruleWUnscaled = (lineVisualW / (hsFactor || 1)); // rect rides the x-scale → visual = lineVisualW
      ctx.fillStyle = color;
      if (te.underline) {
        ctx.fillRect(0, baseYpx + te.fontSize * 0.12 * scale, ruleWUnscaled, thick);
      }
      if (te.strikethrough) {
        ctx.fillRect(0, baseYpx - te.fontSize * 0.3 * scale, ruleWUnscaled, thick);
      }
    }
    ctx.restore();
  }
  ctx.restore();
}
