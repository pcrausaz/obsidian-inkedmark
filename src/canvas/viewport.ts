/**
 * Paper-roll viewport transform: vertical scroll + uniform scale, fixed width.
 * Pure screen<->world conversion. No DOM.
 */

export interface ViewportState {
  /** World y at the top of the visible area. */
  scrollY: number;
  /** Uniform zoom factor. */
  scale: number;
  /** Logical paper width in world CSS px. */
  width: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export function makeViewport(width: number, scrollY = 0, scale = 1): ViewportState {
  return { width, scrollY, scale };
}

/** Screen-space (canvas-local px) -> world-space. */
export function screenToWorld(vp: ViewportState, sx: number, sy: number): Vec2 {
  return { x: sx / vp.scale, y: sy / vp.scale + vp.scrollY };
}

/** World-space -> screen-space (canvas-local px). */
export function worldToScreen(vp: ViewportState, wx: number, wy: number): Vec2 {
  return { x: wx * vp.scale, y: (wy - vp.scrollY) * vp.scale };
}

/** World-space y range currently visible in a viewport of the given height. */
export function visibleWorldRange(
  vp: ViewportState,
  viewportHeightPx: number,
): { top: number; bottom: number } {
  return { top: vp.scrollY, bottom: vp.scrollY + viewportHeightPx / vp.scale };
}
