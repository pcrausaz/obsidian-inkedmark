/**
 * Render strokes to a normalized PNG for recognition: dark ink on a white
 * background regardless of the note's theme/colors, scaled so the long edge is
 * at most 1568 px (the sweet spot for vision models — larger only costs more).
 *
 * DOM (canvas) but no Obsidian imports.
 */

import { outlineToSvgPath, penOptions, strokeOutline } from "../ink/freehand";
import { type Bounds, type Stroke, strokeBounds } from "../model/document";

const MAX_EDGE = 1568;
const PAD = 16;
/** Don't blow tiny sketches up more than this — it adds bytes, not signal. */
const MAX_UPSCALE = 3;

export interface RenderOptions {
  /** Longest output edge in px (default 1568, the vision-model sweet spot). */
  maxEdge?: number;
  /** Whitespace border around the ink, in world px. */
  pad?: number;
}

export interface RenderedInk {
  /** PNG, base64 without a data-URL prefix. */
  base64: string;
  width: number;
  height: number;
}

function unionBounds(strokes: readonly Stroke[]): Bounds | null {
  let acc: Bounds | null = null;
  for (const stroke of strokes) {
    const b = strokeBounds(stroke);
    if (!b) continue;
    acc = acc
      ? {
          minX: Math.min(acc.minX, b.minX),
          minY: Math.min(acc.minY, b.minY),
          maxX: Math.max(acc.maxX, b.maxX),
          maxY: Math.max(acc.maxY, b.maxY),
        }
      : b;
  }
  return acc;
}

/** Render strokes for recognition, or null when there is nothing to render. */
export function renderStrokesForRecognition(
  strokes: readonly Stroke[],
  options: RenderOptions = {},
): RenderedInk | null {
  const maxEdge = options.maxEdge ?? MAX_EDGE;
  const pad = options.pad ?? PAD;
  const bounds = unionBounds(strokes);
  if (!bounds) return null;

  const worldW = bounds.maxX - bounds.minX + pad * 2;
  const worldH = bounds.maxY - bounds.minY + pad * 2;
  const scale = Math.min(maxEdge / Math.max(worldW, worldH), MAX_UPSCALE);

  // Offscreen canvas: never inserted into a DOM, so the main-window createEl
  // global is correct even when the ink view lives in a popout window.
  const canvas = createEl("canvas");
  canvas.width = Math.max(1, Math.round(worldW * scale));
  canvas.height = Math.max(1, Math.round(worldH * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, (-bounds.minX + pad) * scale, (-bounds.minY + pad) * scale);

  for (const stroke of strokes) {
    const outline = strokeOutline(stroke.pts, penOptions(stroke.size, true), true);
    const path = outlineToSvgPath(outline);
    if (!path) continue;
    ctx.save();
    if (stroke.tool === "highlighter") {
      // Keep highlighter context visible without occluding the pen ink under it.
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#888888";
    } else {
      ctx.fillStyle = "#111111";
    }
    ctx.fill(new Path2D(path));
    ctx.restore();
  }

  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { base64, width: canvas.width, height: canvas.height };
}
