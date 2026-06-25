/**
 * Watermark tiling density → spacing factor.
 *
 * Higher density ⇒ smaller spacing factor ⇒ more watermark tiles packed onto the page.
 * The table preserves the original integer-1..5 factors EXACTLY (so existing documents export
 * byte-identically at integer densities) and extends to 10 for much denser tiling; fractional
 * densities (0.5 steps from the slider) are linearly interpolated.
 *
 * Shared by the export path (exportPipeline.drawWatermarkOnPage). The live editor/preview path
 * (watermarkPanel.drawOnCanvas) derives spacing from `count` directly, but reuses MIN/MAX here.
 */
export const MIN_WM_DENSITY = 1;
export const MAX_WM_DENSITY = 10;

// Index i holds the factor for density (i + 1): density 1..10.
const FACTORS = [2.0, 1.5, 1.0, 0.7, 0.5, 0.4, 0.32, 0.26, 0.21, 0.17];

export function densitySpacingFactor(density: number): number {
  const d = Number.isFinite(density) ? density : 3;
  const clamped = Math.max(MIN_WM_DENSITY, Math.min(MAX_WM_DENSITY, d));
  const lo = Math.floor(clamped);
  const hi = Math.ceil(clamped);
  const loF = FACTORS[lo - 1];
  if (lo === hi) return loF;
  const hiF = FACTORS[hi - 1];
  return loF + (hiF - loF) * (clamped - lo); // linear interpolation for half-steps
}
