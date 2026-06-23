export type Point = { x: number; y: number };
export type Bbox  = { x: number; y: number; w: number; h: number };

/**
 * Eraser half-width in element-space units. The eraser is modelled as its
 * pointer polyline dilated by this radius (a union of capsules); a stroke point
 * is erased iff it lies within this distance of the eraser path. Matches the
 * 10-unit-wide preview stroke (`eraserHandler._updatePreview`).
 */
export const DEFAULT_ERASE_RADIUS = 6;

export function segmentsIntersect(
  a1: Point, a2: Point,
  b1: Point, b2: Point,
): { intersects: boolean; t?: number; point?: Point } {
  const dx1 = a2.x - a1.x, dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x, dy2 = b2.y - b1.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return { intersects: false }; // parallel

  const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom;
  const u = ((b1.x - a1.x) * dy1 - (b1.y - a1.y) * dx1) / denom;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      intersects: true,
      t,
      point: { x: a1.x + t * dx1, y: a1.y + t * dy1 },
    };
  }
  return { intersects: false };
}

export function bboxIntersectsPolyline(bbox: Bbox, polyline: Point[]): boolean {
  if (polyline.length < 2) return false;
  const { x, y, w, h } = bbox;
  const edges: [Point, Point][] = [
    [{x, y},     {x: x+w, y}    ],
    [{x: x+w, y},{x: x+w, y: y+h}],
    [{x: x+w, y: y+h},{x, y: y+h}],
    [{x, y: y+h},{x, y}          ],
  ];
  for (let i = 0; i < polyline.length - 1; i++) {
    for (const [e1, e2] of edges) {
      if (segmentsIntersect(polyline[i], polyline[i+1], e1, e2).intersects) return true;
    }
  }
  return polyline.some(p => p.x >= x && p.x <= x+w && p.y >= y && p.y <= y+h);
}

/** Shortest distance from point `p` to the line segment `a`–`b`. */
export function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shortest distance from point `p` to a polyline (min over its segments). */
export function pointToPolylineDistance(p: Point, polyline: Point[]): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return Math.hypot(p.x - polyline[0].x, p.y - polyline[0].y);
  let min = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = pointToSegmentDistance(p, polyline[i], polyline[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

function _lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Binary-refine the point where the erased predicate flips between `pa`
 * (erased = `paErased`) and `pb` (erased = `!paErased`). Returns a point on the
 * boundary of the erase region, accurate enough for a clean visual cut.
 */
function _refineCut(
  pa: Point, pb: Point, paErased: boolean,
  radius: number, erase: Point[],
): Point {
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const erasedHere = pointToPolylineDistance(_lerp(pa, pb, mid), erase) <= radius;
    if (erasedHere === paErased) lo = mid; else hi = mid;
  }
  return _lerp(pa, pb, (lo + hi) / 2);
}

/**
 * Clip a freehand stroke against the eraser's swept region (the eraser polyline
 * dilated by `radius`). Returns the surviving sub-strokes — each a run of the
 * stroke that stays OUTSIDE the region — preserving the original vertices and
 * inserting interpolated cut points at the region boundary.
 *
 * - no overlap      → `[strokePoints]` (unchanged)
 * - fully swept     → `[]` (caller deletes the element)
 * - partial overlap → one entry per surviving run (each ≥ 2 points)
 *
 * Distance-based, so a long/diagonal erase only removes what it physically
 * swept — never whole segments that merely fall inside its bounding box.
 */
export function splitFreehandAtErase(
  strokePoints: Point[],
  erasePoints:  Point[],
  radius: number = DEFAULT_ERASE_RADIUS,
): Point[][] {
  if (strokePoints.length < 2 || erasePoints.length < 2) return [strokePoints];

  const isErased = (p: Point) => pointToPolylineDistance(p, erasePoints) <= radius;

  const runs: Point[][] = [];
  let current: Point[] = [];
  let anyErased = false;

  const endRun = () => {
    if (current.length >= 2) runs.push(current);
    current = [];
  };

  let prevErased = isErased(strokePoints[0]);
  if (prevErased) anyErased = true;
  else current.push({ ...strokePoints[0] });

  for (let i = 0; i < strokePoints.length - 1; i++) {
    const a = strokePoints[i], b = strokePoints[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    // Sub-sample finely enough to catch a segment that dips into the region
    // between two outside endpoints. Sub-samples drive DETECTION only; output
    // keeps original vertices + cut points so untouched strokes are unchanged.
    const steps = Math.min(256, Math.max(1, Math.ceil(segLen / Math.max(0.5, radius / 4))));
    for (let s = 1; s <= steps; s++) {
      const cur = s === steps ? b : _lerp(a, b, s / steps);
      const e = isErased(cur);
      if (e !== prevErased) {
        const cut = _refineCut(
          s === 1 ? a : _lerp(a, b, (s - 1) / steps),
          cur, prevErased, radius, erasePoints,
        );
        if (prevErased) {
          current = [cut];          // exiting region → open a new run
        } else {
          current.push(cut);        // entering region → close the run
          endRun();
        }
        prevErased = e;
        if (e) anyErased = true;
      }
      // Record original vertices that survive (the segment endpoint `b`).
      if (s === steps && !prevErased) current.push({ ...b });
    }
  }
  endRun();

  if (!anyErased) return [strokePoints];
  return runs;
}
