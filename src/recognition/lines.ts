/**
 * Group strokes into text lines for line-level OCR engines (TrOCR reads one
 * line at a time). Pure geometry: cluster strokes top-to-bottom by vertical
 * overlap, then order each line's strokes left-to-right. Small marks that sit
 * above/below their line (i-dots, t-bars, descenders) join it via the
 * gap tolerance derived from the median stroke height.
 *
 * No DOM, no Obsidian.
 */

import { type Bounds, type Stroke, strokeBounds } from "../model/document";

/** A stroke may join a line if the vertical gap is below this × median height. */
const GAP_FACTOR = 0.6;
/** Floor for the tolerance so hairline strokes don't fragment lines. */
const MIN_TOLERANCE = 8;

interface Entry {
  stroke: Stroke;
  bounds: Bounds;
  centerY: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Strokes grouped into lines, top-to-bottom; within a line, left-to-right. */
export function groupStrokesIntoLines(strokes: readonly Stroke[]): Stroke[][] {
  const entries: Entry[] = [];
  for (const stroke of strokes) {
    const bounds = strokeBounds(stroke);
    if (!bounds) continue;
    entries.push({ stroke, bounds, centerY: (bounds.minY + bounds.maxY) / 2 });
  }
  if (entries.length === 0) return [];

  const heights = entries.map((e) => e.bounds.maxY - e.bounds.minY);
  const tolerance = Math.max(MIN_TOLERANCE, median(heights) * GAP_FACTOR);

  entries.sort((a, b) => a.centerY - b.centerY);

  const lines: Array<{ top: number; bottom: number; entries: Entry[] }> = [];
  for (const entry of entries) {
    const line = lines[lines.length - 1];
    // Join the current line when the stroke overlaps its band (or sits within
    // the tolerance of it); otherwise start a new line below.
    if (line && entry.bounds.minY <= line.bottom + tolerance) {
      line.entries.push(entry);
      line.top = Math.min(line.top, entry.bounds.minY);
      line.bottom = Math.max(line.bottom, entry.bounds.maxY);
    } else {
      lines.push({ top: entry.bounds.minY, bottom: entry.bounds.maxY, entries: [entry] });
    }
  }

  return lines.map((line) =>
    line.entries.sort((a, b) => a.bounds.minX - b.bounds.minX).map((e) => e.stroke),
  );
}
