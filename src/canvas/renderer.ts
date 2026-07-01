/**
 * Wet/dry canvas renderer (DOM).
 *
 * Two viewport-sized canvases share a transform that maps world coords to
 * device pixels: device = (world - scrollY) * scale * dpr. Keeping the canvases
 * the size of the visible viewport (not the whole paper roll) avoids iOS WebKit
 * max-canvas-dimension limits and keeps fills cheap.
 *
 * - dry: committed strokes, repainted on demand (scroll / commit), viewport-culled.
 * - wet: the in-progress stroke, drawn synchronously per input sample for the
 *   lowest perceptible latency.
 */

import { DEFAULT_HIGHLIGHTER_ALPHA } from "../constants";
import { type FreehandOptions, outlineToSvgPath, penOptions, strokeOutline } from "../ink/freehand";
import { type InkDocument, type Stroke, type Tool, strokeBounds } from "../model/document";
import type { ViewportState } from "./viewport";

export interface StrokeStyle {
  color: string;
  size: number;
  tool: Tool;
  usePressure: boolean;
}

function get2dContext(
  canvas: HTMLCanvasElement,
  desynchronized: boolean,
): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { desynchronized });
  if (!ctx) throw new Error("InkedMark: 2D canvas context unavailable");
  return ctx;
}

export class Renderer {
  private readonly dryCtx: CanvasRenderingContext2D;
  private readonly wetCtx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  private offsetX = 0;
  private viewport: ViewportState = { scrollY: 0, scale: 1, width: 0 };

  constructor(
    private readonly dry: HTMLCanvasElement,
    private readonly wet: HTMLCanvasElement,
    desynchronized: boolean,
  ) {
    // The dry layer holds committed strokes, so it must retain its buffer: a
    // desynchronized 2D context can drop content when drawing stops on iOS
    // WebKit, making committed ink vanish (sometimes leaving torn fragments).
    // Only the wet layer — repainted every input sample — takes the low-latency
    // desynchronized path.
    this.dryCtx = get2dContext(dry, false);
    this.wetCtx = get2dContext(wet, desynchronized);
    // The wet layer sits above the dry layer, so it may only be visible while a
    // stroke is in progress. A desynchronized canvas can fail to clear to
    // transparent on iOS WebKit; hiding it when idle guarantees it never masks
    // committed ink on the dry layer below.
    this.wet.style.visibility = "hidden";
  }

  /** Resize both backing stores to the visible viewport at the given DPR. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = dpr;
    for (const canvas of [this.dry, this.wet]) {
      canvas.width = Math.max(1, Math.round(cssWidth * dpr));
      canvas.height = Math.max(1, Math.round(cssHeight * dpr));
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
    }
  }

  /**
   * @param viewport scroll/scale/width state
   * @param offsetX paper's left edge within the canvas, in CSS px (centering)
   */
  setViewport(viewport: ViewportState, offsetX = 0): void {
    this.viewport = viewport;
    this.offsetX = offsetX;
  }

  private applyTransform(ctx: CanvasRenderingContext2D): void {
    const k = this.dpr * this.viewport.scale;
    ctx.setTransform(k, 0, 0, k, this.offsetX * this.dpr, -this.viewport.scrollY * k);
  }

  private clear(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.dpr * this.cssWidth, this.dpr * this.cssHeight);
  }

  private optionsFor(style: StrokeStyle): FreehandOptions {
    const usePressure = style.tool === "highlighter" ? false : style.usePressure;
    return penOptions(style.size, usePressure);
  }

  private fillStroke(
    ctx: CanvasRenderingContext2D,
    pts: number[],
    style: StrokeStyle,
    complete: boolean,
  ): void {
    if (pts.length < 3) return;
    const outline = strokeOutline(pts, this.optionsFor(style), complete);
    const path = outlineToSvgPath(outline);
    if (!path) return;

    ctx.save();
    if (style.tool === "highlighter") {
      ctx.globalAlpha = DEFAULT_HIGHLIGHTER_ALPHA;
      ctx.globalCompositeOperation = "multiply";
    }
    ctx.fillStyle = style.color;
    ctx.fill(new Path2D(path));
    ctx.restore();
  }

  /** Repaint the dry layer from committed strokes, culling off-screen ones. */
  renderDocument(doc: InkDocument, usePressure: boolean): void {
    this.clear(this.dryCtx);
    this.applyTransform(this.dryCtx);

    const top = this.viewport.scrollY;
    const bottom = top + this.cssHeight / this.viewport.scale;

    for (const region of doc.regions) {
      for (const stroke of region.strokes) {
        const bounds = strokeBounds(stroke);
        if (bounds && (bounds.maxY < top || bounds.minY > bottom)) continue;
        this.fillStroke(this.dryCtx, stroke.pts, styleOf(stroke, usePressure), true);
      }
    }
  }

  /** Draw the in-progress stroke on the wet layer (synchronous, low-latency). */
  renderWet(pts: number[], style: StrokeStyle): void {
    this.clear(this.wetCtx);
    this.applyTransform(this.wetCtx);
    this.fillStroke(this.wetCtx, pts, style, false);
    this.wet.style.visibility = "visible";
  }

  /** Clear the wet layer and hide it so it cannot mask the dry layer. */
  clearWet(): void {
    this.clear(this.wetCtx);
    this.wet.style.visibility = "hidden";
  }
}

export function styleOf(stroke: Stroke, usePressure: boolean): StrokeStyle {
  return { color: stroke.color, size: stroke.size, tool: stroke.tool, usePressure };
}
