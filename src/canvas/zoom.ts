/**
 * Pure zoom helpers. The view keeps zoom-to-point exact by measuring the world
 * point under an anchor before and after a scale change and correcting scroll by
 * {@link anchorScrollDelta}; these functions hold the math so it is testable.
 */

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8;

export function clampScale(scale: number): number {
  if (Number.isNaN(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Scroll delta (in scaled/screen px) that moves the world point currently under
 * an anchor (`after`) back to where it was (`before`), given the new scale.
 * Derivation: d(world)/d(scroll) = 1/scale, so Δscroll = (before − after) · scale.
 */
export function anchorScrollDelta(before: Vec2, after: Vec2, scale: number): Vec2 {
  return { x: (before.x - after.x) * scale, y: (before.y - after.y) * scale };
}
