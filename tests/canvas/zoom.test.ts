import { describe, expect, it } from "vitest";
import { MAX_SCALE, MIN_SCALE, anchorScrollDelta, clampScale } from "../../src/canvas/zoom";

describe("clampScale", () => {
  it("clamps to the configured bounds", () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(2)).toBe(2);
  });

  it("falls back to 1 for non-finite input", () => {
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MAX_SCALE);
  });
});

describe("anchorScrollDelta", () => {
  it("is zero when the anchor world point did not move", () => {
    expect(anchorScrollDelta({ x: 10, y: 20 }, { x: 10, y: 20 }, 2)).toEqual({ x: 0, y: 0 });
  });

  it("scales the correction by the new scale", () => {
    // world under anchor drifted +5x,+3y; correct back at scale 2.
    expect(anchorScrollDelta({ x: 0, y: 0 }, { x: 5, y: 3 }, 2)).toEqual({ x: -10, y: -6 });
  });
});
