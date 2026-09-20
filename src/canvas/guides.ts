/**
 * Paper guides (ruled lines, dot grid, square grid): pure geometry for the
 * renderer. Guides live in world space — they scroll and zoom with the ink —
 * but are painted at a fixed device-pixel weight so hairlines stay crisp at
 * every zoom level. No DOM, no Obsidian.
 *
 * Guides are an authoring aid, not content: they are drawn only on the
 * editing surface, never in embeds or the recognition image, and are not
 * stored in the document.
 */

import {
  DEFAULT_PAPER_GUIDE_SPACING,
  MAX_PAPER_GUIDE_SPACING,
  MIN_PAPER_GUIDE_SPACING,
} from "../constants";

export type PaperGuide = "lines" | "dots" | "grid";

export const PAPER_GUIDE_LABELS: Record<PaperGuide, string> = {
  lines: "Lines",
  dots: "Dots",
  grid: "Grid",
};

/** Coerce an untrusted value (settings file) to a valid guide style. */
export function normalizePaperGuide(value: unknown): PaperGuide {
  return value === "dots" || value === "grid" ? value : "lines";
}

/** Clamp a spacing to the supported range; non-finite input yields the default. */
export function clampGuideSpacing(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PAPER_GUIDE_SPACING;
  return Math.min(MAX_PAPER_GUIDE_SPACING, Math.max(MIN_PAPER_GUIDE_SPACING, value));
}

/**
 * World-space positions of guide rows (or columns) at multiples of `spacing`
 * within `[from, to]`. The origin (0) is the paper edge and is never a guide.
 */
export function guidePositions(spacing: number, from: number, to: number): number[] {
  const out: number[] = [];
  if (!(spacing > 0) || to < from) return out;
  const first = Math.max(1, Math.ceil(from / spacing));
  for (let i = first; i * spacing <= to; i++) out.push(i * spacing);
  return out;
}

/**
 * Snap a device-space coordinate to the centre of a pixel so a `weight`-pixel
 * stroke covers whole pixels (odd weights straddle a pixel centre, even
 * weights sit on a pixel boundary).
 */
export function snapToPixel(device: number, weight: number): number {
  return weight % 2 === 1 ? Math.floor(device) + 0.5 : Math.round(device);
}

/** Stroke weight (device px) for guide hairlines at a given device pixel ratio. */
export function guideWeight(dpr: number): number {
  return Math.max(1, Math.round(dpr / 2));
}
