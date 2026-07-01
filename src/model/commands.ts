/**
 * Command pattern for undo/redo (§5.3). Each user edit is a {@link Command} that
 * knows how to `apply()` and `invert()` itself against an {@link InkDocument} —
 * delta-based, so undo memory is O(change), never full-document snapshots.
 *
 * Pure: no DOM, no Obsidian.
 */

import { type InkDocument, type Stroke, POINT_STRIDE, primaryRegion } from "./document";

export interface Command {
  /** Human-readable label (for menus / debugging). */
  readonly label: string;
  apply(doc: InkDocument): void;
  invert(doc: InkDocument): void;
}

/** Append a freshly-drawn stroke. */
export class AddStroke implements Command {
  readonly label = "Add stroke";
  constructor(private readonly stroke: Stroke) {}

  apply(doc: InkDocument): void {
    primaryRegion(doc).strokes.push(this.stroke);
  }

  invert(doc: InkDocument): void {
    const region = primaryRegion(doc);
    const index = region.strokes.findIndex((s) => s.id === this.stroke.id);
    if (index >= 0) region.strokes.splice(index, 1);
  }
}

/** Remove a set of strokes by id (eraser, delete-selection), restoring position on undo. */
export class RemoveStrokes implements Command {
  readonly label: string;
  private removed: Array<{ index: number; stroke: Stroke }> = [];

  constructor(
    private readonly ids: ReadonlySet<string>,
    label = "Erase",
  ) {
    this.label = label;
  }

  apply(doc: InkDocument): void {
    const region = primaryRegion(doc);
    this.removed = [];
    // Walk high->low so splicing doesn't shift not-yet-visited indices.
    for (let i = region.strokes.length - 1; i >= 0; i--) {
      const stroke = region.strokes[i];
      if (this.ids.has(stroke.id)) {
        this.removed.push({ index: i, stroke });
        region.strokes.splice(i, 1);
      }
    }
  }

  invert(doc: InkDocument): void {
    const region = primaryRegion(doc);
    // `removed` is in descending index order; restore ascending so each
    // insertion lands at its original index.
    for (let k = this.removed.length - 1; k >= 0; k--) {
      const { index, stroke } = this.removed[k];
      region.strokes.splice(index, 0, stroke);
    }
  }
}

/** Translate a set of strokes by (dx, dy) in world space. */
export class MoveStrokes implements Command {
  readonly label = "Move";
  constructor(
    private readonly ids: ReadonlySet<string>,
    private readonly dx: number,
    private readonly dy: number,
  ) {}

  apply(doc: InkDocument): void {
    this.shift(doc, this.dx, this.dy);
  }

  invert(doc: InkDocument): void {
    this.shift(doc, -this.dx, -this.dy);
  }

  private shift(doc: InkDocument, dx: number, dy: number): void {
    for (const stroke of primaryRegion(doc).strokes) {
      if (!this.ids.has(stroke.id)) continue;
      for (let i = 0; i < stroke.pts.length; i += POINT_STRIDE) {
        stroke.pts[i] += dx;
        stroke.pts[i + 1] += dy;
      }
    }
  }
}

/** Remove every stroke in the primary region. */
export class ClearRegion implements Command {
  readonly label = "Clear";
  private removed: Stroke[] = [];

  apply(doc: InkDocument): void {
    const region = primaryRegion(doc);
    this.removed = region.strokes;
    region.strokes = [];
  }

  invert(doc: InkDocument): void {
    primaryRegion(doc).strokes = this.removed;
  }
}
