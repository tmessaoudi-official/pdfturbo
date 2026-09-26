/**
 * The ONE way `src/` asks pdf.js for a page viewport. Direct `.getViewport(` calls are banned outside
 * this file (`tests/infra/pointViewport.test.ts`).
 *
 * pdf.js multiplies every viewport by the page's /UserUnit (`pdf.mjs:826`, 6.3.289), a PDF 1.6 key that
 * says one unit is u points. The export writes with pdf-lib in plain points and knows nothing of it, so
 * on a /UserUnit page the editor's coordinates and the export's used to differ by u wherever they met —
 * and a redaction drawn over a secret was burned at u times the secret's position, leaving it visible.
 * Dividing the requested scale by u makes every viewport in `src/` a POINTS viewport: at scale 1 it is
 * the page's size in points, whatever the /UserUnit, so the editor, the extractors and the export share
 * one frame. pdf.js keeps `viewport.scale` and `viewport.userUnit` apart, and their product is what it
 * draws at; the text layer's CSS factor is that product (`textLayer.ts`).
 *
 * Consequence, stated rather than hidden: at 100% zoom a /UserUnit 2 page shows at half its physical
 * size. Elements saved in a session before this change were measured at u times and restore scaled.
 */

/** The parameters every call site passes; pdf.js accepts more, and they pass through untouched. */
export interface PointViewportOptions {
  scale: number;
  rotation?: number;
}

/** Any page that can produce a viewport: a real `PDFPageProxy`, or a structural stand-in. */
export interface ViewportSource<V> {
  getViewport(o: PointViewportOptions): V;
  userUnit?: number;
}

export function pointViewport<V>(page: ViewportSource<V>, opts: PointViewportOptions): V {
  const unit = pageUserUnit(page);
  return page.getViewport(unit === 1 ? opts : { ...opts, scale: opts.scale / unit });
}

/**
 * The page's /UserUnit as pdf.js reports it, or 1 when it is absent or not a positive finite number.
 * A path that BUILDS a new page from a render (the redaction raster, lossy compress) sizes it in points
 * and must copy this onto it, or the page exports at 1/u of its physical size.
 */
export function pageUserUnit(page: { userUnit?: number }): number {
  const u = page.userUnit;
  return typeof u === 'number' && Number.isFinite(u) && u > 0 ? u : 1;
}
