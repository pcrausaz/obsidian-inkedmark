/**
 * Uniform-grid spatial index over stroke ids, for O(1)-ish hit-test and cull
 * broad-phase instead of scanning every stroke. Maps grid cells to the ids of
 * strokes whose bounds touch them. Pure: no DOM.
 *
 * Callers resolve ids back to strokes and confirm with exact {@link ./hit-test}
 * checks (this is the broad phase only).
 */

import { type Bounds, type Stroke, strokeBounds } from "../model/document";

const DEFAULT_CELL_SIZE = 256;

export class SpatialIndex {
  private readonly cells = new Map<string, Set<string>>();
  private readonly strokeKeys = new Map<string, string[]>();

  constructor(private readonly cellSize: number = DEFAULT_CELL_SIZE) {}

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private cellRange(b: Bounds): { x0: number; y0: number; x1: number; y1: number } {
    return {
      x0: Math.floor(b.minX / this.cellSize),
      y0: Math.floor(b.minY / this.cellSize),
      x1: Math.floor(b.maxX / this.cellSize),
      y1: Math.floor(b.maxY / this.cellSize),
    };
  }

  insert(stroke: Stroke): void {
    const bounds = strokeBounds(stroke);
    if (!bounds) return;
    const { x0, y0, x1, y1 } = this.cellRange(bounds);
    const keys: string[] = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = this.key(cx, cy);
        let set = this.cells.get(k);
        if (!set) {
          set = new Set();
          this.cells.set(k, set);
        }
        set.add(stroke.id);
        keys.push(k);
      }
    }
    this.strokeKeys.set(stroke.id, keys);
  }

  remove(id: string): void {
    const keys = this.strokeKeys.get(id);
    if (!keys) return;
    for (const k of keys) {
      const set = this.cells.get(k);
      if (set) {
        set.delete(id);
        if (set.size === 0) this.cells.delete(k);
      }
    }
    this.strokeKeys.delete(id);
  }

  /** Candidate ids whose cells overlap `bounds`. */
  queryBounds(bounds: Bounds): Set<string> {
    const out = new Set<string>();
    const { x0, y0, x1, y1 } = this.cellRange(bounds);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const set = this.cells.get(this.key(cx, cy));
        if (set) for (const id of set) out.add(id);
      }
    }
    return out;
  }

  /** Candidate ids near a point, within `radius`. */
  queryPoint(x: number, y: number, radius = 0): Set<string> {
    return this.queryBounds({
      minX: x - radius,
      minY: y - radius,
      maxX: x + radius,
      maxY: y + radius,
    });
  }

  rebuild(strokes: readonly Stroke[]): void {
    this.clear();
    for (const stroke of strokes) this.insert(stroke);
  }

  clear(): void {
    this.cells.clear();
    this.strokeKeys.clear();
  }
}
