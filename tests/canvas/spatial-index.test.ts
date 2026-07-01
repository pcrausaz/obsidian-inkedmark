import { describe, expect, it } from "vitest";
import { type Bounds, type Stroke, strokeBounds } from "../../src/model/document";
import { boundsIntersect } from "../../src/canvas/hit-test";
import { SpatialIndex } from "../../src/canvas/spatial-index";

/** Deterministic LCG so the "vs brute force" test is reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomStrokes(count: number, seed: number): Stroke[] {
  const rng = makeRng(seed);
  const strokes: Stroke[] = [];
  for (let i = 0; i < count; i++) {
    const n = 2 + Math.floor(rng() * 4);
    const pts: number[] = [];
    const ox = rng() * 2000;
    const oy = rng() * 2000;
    for (let j = 0; j < n; j++) {
      pts.push(ox + rng() * 300, oy + rng() * 300, 1);
    }
    strokes.push({ id: `s${i}`, color: "#fff", size: 3, tool: "pen", pts });
  }
  return strokes;
}

describe("SpatialIndex", () => {
  it("insert then queryBounds returns the stroke", () => {
    const index = new SpatialIndex(100);
    const s: Stroke = { id: "a", color: "#fff", size: 3, tool: "pen", pts: [10, 10, 1, 40, 40, 1] };
    index.insert(s);
    expect(index.queryBounds({ minX: 0, minY: 0, maxX: 50, maxY: 50 }).has("a")).toBe(true);
  });

  it("remove drops the stroke from every cell", () => {
    const index = new SpatialIndex(100);
    index.insert({ id: "a", color: "#fff", size: 3, tool: "pen", pts: [10, 10, 1, 400, 400, 1] });
    index.remove("a");
    expect(index.queryBounds({ minX: 0, minY: 0, maxX: 500, maxY: 500 }).size).toBe(0);
  });

  it("queryPoint finds a nearby stroke within radius", () => {
    const index = new SpatialIndex(64);
    index.insert({ id: "a", color: "#fff", size: 3, tool: "pen", pts: [100, 100, 1, 120, 100, 1] });
    expect(index.queryPoint(110, 101, 5).has("a")).toBe(true);
  });

  it("has no false negatives vs brute force on random strokes", () => {
    const strokes = randomStrokes(300, 12345);
    const index = new SpatialIndex(256);
    index.rebuild(strokes);
    const rng = makeRng(999);

    for (let q = 0; q < 60; q++) {
      const qx = rng() * 2200;
      const qy = rng() * 2200;
      const query: Bounds = { minX: qx, minY: qy, maxX: qx + rng() * 400, maxY: qy + rng() * 400 };
      const candidates = index.queryBounds(query);
      // Every stroke whose bounds actually intersect the query must be present.
      for (const s of strokes) {
        const b = strokeBounds(s);
        if (b && boundsIntersect(b, query)) {
          expect(candidates.has(s.id)).toBe(true);
        }
      }
    }
  });

  it("rebuild clears prior contents", () => {
    const index = new SpatialIndex(100);
    index.insert({ id: "old", color: "#fff", size: 3, tool: "pen", pts: [0, 0, 1, 10, 10, 1] });
    index.rebuild([{ id: "new", color: "#fff", size: 3, tool: "pen", pts: [0, 0, 1, 10, 10, 1] }]);
    const hit = index.queryBounds({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
    expect(hit.has("old")).toBe(false);
    expect(hit.has("new")).toBe(true);
  });
});
