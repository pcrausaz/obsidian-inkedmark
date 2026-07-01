import { describe, expect, it } from "vitest";
import type { Stroke } from "../../src/model/document";
import {
  boundsIntersect,
  distToSegmentSq,
  pointInBounds,
  rectFromCorners,
  strokeHitByPoint,
  strokeIntersectsRect,
} from "../../src/canvas/hit-test";

function stroke(pts: number[]): Stroke {
  return { id: "s", color: "#fff", size: 3, tool: "pen", pts };
}

describe("rect helpers", () => {
  it("rectFromCorners normalizes corner order", () => {
    expect(rectFromCorners(30, 40, 10, 20)).toEqual({ minX: 10, minY: 20, maxX: 30, maxY: 40 });
  });

  it("boundsIntersect detects overlap and separation", () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(boundsIntersect(a, { minX: 5, minY: 5, maxX: 15, maxY: 15 })).toBe(true);
    expect(boundsIntersect(a, { minX: 11, minY: 0, maxX: 20, maxY: 10 })).toBe(false);
  });

  it("pointInBounds includes edges", () => {
    const b = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(pointInBounds(0, 10, b)).toBe(true);
    expect(pointInBounds(11, 5, b)).toBe(false);
  });
});

describe("distToSegmentSq", () => {
  it("is zero on the segment", () => {
    expect(distToSegmentSq(5, 0, 0, 0, 10, 0)).toBe(0);
  });

  it("is the perpendicular distance squared", () => {
    expect(distToSegmentSq(5, 3, 0, 0, 10, 0)).toBe(9);
  });

  it("clamps past the endpoints", () => {
    expect(distToSegmentSq(-4, 0, 0, 0, 10, 0)).toBe(16);
  });

  it("handles a degenerate (zero-length) segment", () => {
    expect(distToSegmentSq(3, 4, 0, 0, 0, 0)).toBe(25);
  });
});

describe("strokeHitByPoint", () => {
  const s = stroke([0, 0, 1, 100, 0, 1]);

  it("hits within radius of the segment", () => {
    expect(strokeHitByPoint(s, 50, 2, 3)).toBe(true);
  });

  it("misses beyond radius", () => {
    expect(strokeHitByPoint(s, 50, 20, 3)).toBe(false);
  });

  it("rejects fast via bounds before scanning", () => {
    expect(strokeHitByPoint(s, 500, 500, 3)).toBe(false);
  });

  it("handles a single-point (dot) stroke", () => {
    const dot = stroke([10, 10, 1]);
    expect(strokeHitByPoint(dot, 11, 10, 2)).toBe(true);
    expect(strokeHitByPoint(dot, 20, 10, 2)).toBe(false);
  });
});

describe("strokeIntersectsRect", () => {
  const s = stroke([0, 0, 1, 100, 100, 1]);

  it("selects when a point falls inside the rect", () => {
    expect(strokeIntersectsRect(s, rectFromCorners(90, 90, 110, 110))).toBe(true);
  });

  it("does not select a disjoint stroke", () => {
    expect(strokeIntersectsRect(s, rectFromCorners(200, 200, 300, 300))).toBe(false);
  });
});
