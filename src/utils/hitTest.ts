import type { ShapeElement } from '../elements/shapeElement';

export function ptSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function ptInPolygon(px: number, py: number, points: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function hitTestShape(shape: ShapeElement, x: number, y: number): boolean {
  if (shape.shapeType === 'freehand') {
    const threshold = shape.strokeWidth / 2 + 4;
    const pts = shape.points;
    for (let i = 0; i < pts.length - 1; i++) {
      if (ptSegDist(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= threshold)
        return true;
    }
    return false;
  }
  return x >= shape.x && x <= shape.x + shape.width &&
         y >= shape.y && y <= shape.y + shape.height;
}
