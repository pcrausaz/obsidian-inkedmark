/**
 * Pure hit-testing geometry: point-near-stroke (eraser / tap-select),
 * stroke-in-rect (box-select), and bounds intersection (culling / broad phase).
 * No DOM.
 */

import { type Bounds, type Stroke, POINT_STRIDE, strokeBounds } from "../model/document";

/** Axis-aligned rectangle; same shape as {@link Bounds}. */
export type Rect = Bounds;

/** Build a normalized rect from two opposite corners. */
export function rectFromCorners(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    minX: Math.min(x0, x1),
    minY: Math.min(y0, y1),
    maxX: Math.max(x0, x1),
    maxY: Math.max(y0, y1),
  };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

export function pointInBounds(x: number, y: number, b: Bounds): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

/** Squared distance from point (px,py) to segment (ax,ay)-(bx,by). */
export function distToSegmentSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/** True if (x,y) lies within `radius` of any part of the stroke. */
export function strokeHitByPoint(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const bounds = strokeBounds(stroke);
  if (!bounds) return false;
  if (
    x < bounds.minX - radius ||
    x > bounds.maxX + radius ||
    y < bounds.minY - radius ||
    y > bounds.maxY + radius
  ) {
    return false;
  }

  const { pts } = stroke;
  const r2 = radius * radius;
  if (pts.length === POINT_STRIDE) {
    const dx = pts[0] - x;
    const dy = pts[1] - y;
    return dx * dx + dy * dy <= r2;
  }
  for (let i = 0; i + 2 * POINT_STRIDE - 1 < pts.length; i += POINT_STRIDE) {
    if (
      distToSegmentSq(x, y, pts[i], pts[i + 1], pts[i + POINT_STRIDE], pts[i + POINT_STRIDE + 1]) <=
      r2
    ) {
      return true;
    }
  }
  return false;
}

/** True if any of the stroke's points lie inside `rect` (lenient box-select). */
export function strokeIntersectsRect(stroke: Stroke, rect: Rect): boolean {
  const bounds = strokeBounds(stroke);
  if (!bounds || !boundsIntersect(bounds, rect)) return false;
  const { pts } = stroke;
  for (let i = 0; i < pts.length; i += POINT_STRIDE) {
    if (pointInBounds(pts[i], pts[i + 1], rect)) return true;
  }
  return false;
}
