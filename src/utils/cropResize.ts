/**
 * Crop-frame resize geometry (#G23 v1c). Pure → jsdom-testable.
 *
 * Operates entirely in editor DISPLAY space (y-down, top-left), which is exactly what
 * `PageService.cropPage` already accepts — so a resized frame commits through the SAME undoable path,
 * with the same rotation mapping, as a freshly drawn one. No second coordinate convention is
 * introduced, which is the mistake the numeric-margins path made on its first attempt.
 */

/** Which grip is being dragged. Corners move two edges, edges move one. */
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const CROP_HANDLES: readonly CropHandle[] =
  ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

export interface Rect { x: number; y: number; width: number; height: number }

/** Smallest crop a drag may produce, in display units. Matches the drag-to-create floor. */
export const MIN_CROP = 5;

/**
 * Apply a pointer delta to one handle of `rect`, clamped to the page box `[0,0,pageW,pageH]` and to
 * `MIN_CROP` on both axes.
 *
 * The clamping is deliberately done on the moving EDGE rather than on the resulting width/height: that
 * way a drag that runs past the opposite edge stops at the minimum instead of inverting the rect and
 * flipping which side the user is dragging. An inverted rect would still be "valid" arithmetic and
 * would silently crop the wrong region.
 */
export function resizeDisplayRect(
  rect: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  pageW: number,
  pageH: number,
  min = MIN_CROP,
): Rect {
  let { x, y, width, height } = rect;
  const right = x + width;
  const bottom = y + height;

  if (handle.includes('w')) {
    // Left edge: cannot pass the page's left edge, nor come within `min` of the right edge.
    const nx = Math.min(Math.max(0, x + dx), right - min);
    width = right - nx;
    x = nx;
  }
  if (handle.includes('e')) {
    const nr = Math.max(Math.min(pageW, right + dx), x + min);
    width = nr - x;
  }
  if (handle.includes('n')) {
    const ny = Math.min(Math.max(0, y + dy), bottom - min);
    height = bottom - ny;
    y = ny;
  }
  if (handle.includes('s')) {
    const nb = Math.max(Math.min(pageH, bottom + dy), y + min);
    height = nb - y;
  }
  return { x, y, width, height };
}

/**
 * Where each handle sits, in the same space as `rect`. Corner and edge midpoints — the caller draws a
 * grip of its own size centred on each point.
 */
export function handlePositions(rect: Rect): Record<CropHandle, { x: number; y: number }> {
  const { x, y, width: w, height: h } = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return {
    nw: { x, y }, n: { x: cx, y }, ne: { x: x + w, y },
    e: { x: x + w, y: cy }, se: { x: x + w, y: y + h }, s: { x: cx, y: y + h },
    sw: { x, y: y + h }, w: { x, y: cy },
  };
}

/** The CSS cursor for a handle, so the affordance reads correctly before the drag starts. */
export function handleCursor(handle: CropHandle): string {
  switch (handle) {
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'nw': case 'se': return 'nwse-resize';
    default: return 'nesw-resize';
  }
}
