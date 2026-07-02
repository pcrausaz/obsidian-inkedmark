/**
 * Pure document model. No DOM, no Obsidian imports.
 *
 * Points are stored flat as `[x, y, p, x, y, p, …]` to keep documents compact
 * and allocation-light; `p` is normalized pressure in `0..1` and coordinates
 * are world-space CSS px (floats). Quantization happens only at serialize time
 * (see `serialize.ts`).
 */

import { DEFAULT_PAPER_WIDTH, SCHEMA_VERSION } from "../constants";

export type Tool = "pen" | "highlighter";

export interface Stroke {
  id: string;
  color: string;
  size: number;
  tool: Tool;
  /** Flat tuples `[x, y, p, …]`; length is always a multiple of 3. */
  pts: number[];
}

export type RegionKind = "ink";

export interface Region {
  id: string;
  kind: RegionKind;
  strokes: Stroke[];
}

export interface ViewState {
  scrollY: number;
  width: number;
  scale: number;
}

export interface InkDocument {
  version: number;
  view: ViewState;
  regions: Region[];
  /** Content hash of the strokes at the last successful recognition run. */
  recognizedHash?: string;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Number of coordinate components per point (`x`, `y`, `p`). */
export const POINT_STRIDE = 3;

/** Create an empty single-region document. */
export function emptyDocument(width: number = DEFAULT_PAPER_WIDTH): InkDocument {
  return {
    version: SCHEMA_VERSION,
    view: { scrollY: 0, width, scale: 1 },
    regions: [{ id: "r1", kind: "ink", strokes: [] }],
  };
}

/** The primary ink region, creating one if the document somehow has none. */
export function primaryRegion(doc: InkDocument): Region {
  let region = doc.regions[0];
  if (!region) {
    region = { id: "r1", kind: "ink", strokes: [] };
    doc.regions.push(region);
  }
  return region;
}

/** Total stroke count across all regions. */
export function strokeCount(doc: InkDocument): number {
  let n = 0;
  for (const region of doc.regions) n += region.strokes.length;
  return n;
}

/** Axis-aligned bounds of a stroke's points, or `null` if it has none. */
export function strokeBounds(stroke: Stroke): Bounds | null {
  const { pts } = stroke;
  if (pts.length < POINT_STRIDE) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += POINT_STRIDE) {
    const x = pts[i];
    const y = pts[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * FNV-1a content hash of every stroke (ids + quantized points). Used to skip
 * recognition when the ink hasn't changed since the last run — recognizing the
 * same page twice wastes an API call and can churn previously-good text.
 */
export function strokesContentHash(doc: InkDocument): string {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
  };
  for (const region of doc.regions) {
    for (const stroke of region.strokes) {
      for (let i = 0; i < stroke.id.length; i++) mix(stroke.id.charCodeAt(i));
      mix(stroke.pts.length);
      for (const v of stroke.pts) mix(Math.round(v * 100));
    }
  }
  return (h >>> 0).toString(36);
}

/** Union of every stroke's bounds in a document, or `null` if empty. */
export function documentBounds(doc: InkDocument): Bounds | null {
  let acc: Bounds | null = null;
  for (const region of doc.regions) {
    for (const stroke of region.strokes) {
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
  }
  return acc;
}
