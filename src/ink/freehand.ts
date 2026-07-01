/**
 * `perfect-freehand` wrapper: pressure-points -> variable-width filled outline,
 * plus an SVG path-data builder for that outline.
 *
 * Pure: returns geometry and path strings only. The DOM-side `Path2D`
 * construction lives in `canvas/renderer.ts`.
 */

import { getStroke } from "perfect-freehand";
import { type Stroke, POINT_STRIDE } from "../model/document";

export interface FreehandOptions {
  /** Base stroke width. */
  size: number;
  /** How much pressure affects width (0 = constant width). */
  thinning: number;
  /** Outline smoothing. */
  smoothing: number;
  /** Input streamlining (jitter reduction). */
  streamline: number;
  /** When false, real per-point pressure drives width. */
  simulatePressure: boolean;
}

/** Sensible defaults for a pen at the given size. */
export function penOptions(size: number, usePressure: boolean): FreehandOptions {
  return {
    size,
    thinning: usePressure ? 0.6 : 0,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: !usePressure,
  };
}

/** Convert a flat point buffer into `perfect-freehand`'s `[x, y, p][]` form. */
export function toInputPoints(pts: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + POINT_STRIDE - 1 < pts.length; i += POINT_STRIDE) {
    out.push([pts[i], pts[i + 1], pts[i + 2]]);
  }
  return out;
}

/**
 * Outline polygon (array of `[x, y]`) for a stroke's points.
 * `complete` marks the stroke as finished (proper end cap); pass `false` while
 * the stroke is still wet for a cleaner leading edge.
 */
export function strokeOutline(
  pts: number[],
  options: FreehandOptions,
  complete = true,
): number[][] {
  return getStroke(toInputPoints(pts), {
    size: options.size,
    thinning: options.thinning,
    smoothing: options.smoothing,
    streamline: options.streamline,
    simulatePressure: options.simulatePressure,
    last: complete,
  });
}

/** Convenience: outline for a committed {@link Stroke}. */
export function outlineForStroke(
  stroke: Stroke,
  options: FreehandOptions,
  complete = true,
): number[][] {
  return strokeOutline(stroke.pts, options, complete);
}

/**
 * Build SVG path data from an outline polygon using quadratic segments through
 * edge midpoints (the canonical `perfect-freehand` smoothing). Suitable for
 * `new Path2D(data)`.
 */
export function outlineToSvgPath(outline: number[][]): string {
  const len = outline.length;
  if (len < 2) return "";

  const parts: string[] = [];
  const [firstX, firstY] = outline[0];
  parts.push(`M ${firstX.toFixed(2)} ${firstY.toFixed(2)} Q`);

  for (let i = 0; i < len; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % len];
    parts.push(
      `${x0.toFixed(2)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2).toFixed(2)}`,
    );
  }

  parts.push("Z");
  return parts.join(" ");
}
