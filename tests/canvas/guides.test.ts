import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAPER_GUIDE_SPACING,
  MAX_PAPER_GUIDE_SPACING,
  MIN_PAPER_GUIDE_SPACING,
} from "../../src/constants";
import {
  clampGuideSpacing,
  guidePositions,
  guideWeight,
  normalizePaperGuide,
  snapToPixel,
} from "../../src/canvas/guides";

describe("normalizePaperGuide", () => {
  it("accepts the known styles", () => {
    expect(normalizePaperGuide("lines")).toBe("lines");
    expect(normalizePaperGuide("dots")).toBe("dots");
    expect(normalizePaperGuide("grid")).toBe("grid");
  });

  it("falls back to lines for anything else", () => {
    expect(normalizePaperGuide("none")).toBe("lines");
    expect(normalizePaperGuide(undefined)).toBe("lines");
    expect(normalizePaperGuide(42)).toBe("lines");
  });
});

describe("clampGuideSpacing", () => {
  it("clamps to the supported range", () => {
    expect(clampGuideSpacing(1)).toBe(MIN_PAPER_GUIDE_SPACING);
    expect(clampGuideSpacing(10_000)).toBe(MAX_PAPER_GUIDE_SPACING);
    expect(clampGuideSpacing(40)).toBe(40);
  });

  it("uses the default for non-finite input", () => {
    expect(clampGuideSpacing(Number.NaN)).toBe(DEFAULT_PAPER_GUIDE_SPACING);
    expect(clampGuideSpacing(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PAPER_GUIDE_SPACING);
  });
});

describe("guidePositions", () => {
  it("lists multiples of the spacing inside the range, excluding the origin", () => {
    expect(guidePositions(40, 0, 130)).toEqual([40, 80, 120]);
  });

  it("starts at the first multiple at or after `from`", () => {
    expect(guidePositions(40, 41, 200)).toEqual([80, 120, 160, 200]);
    expect(guidePositions(40, 80, 200)).toEqual([80, 120, 160, 200]);
  });

  it("handles a negative `from` (over-scroll) without emitting the origin", () => {
    expect(guidePositions(48, -100, 100)).toEqual([48, 96]);
  });

  it("keeps columns clear of a side margin at both edges", () => {
    // 1024 px paper, 20 px margin: 0 and 1008 fall in the margins; 48..960 stay.
    const cols = guidePositions(48, 20, 1024 - 20);
    expect(cols[0]).toBe(48);
    expect(cols[cols.length - 1]).toBe(960);
    expect(cols).not.toContain(1008);
  });

  it("is empty for an empty or inverted range", () => {
    expect(guidePositions(40, 0, 39)).toEqual([]);
    expect(guidePositions(40, 200, 100)).toEqual([]);
  });

  it("is empty for a non-positive spacing", () => {
    expect(guidePositions(0, 0, 100)).toEqual([]);
    expect(guidePositions(-5, 0, 100)).toEqual([]);
    expect(guidePositions(Number.NaN, 0, 100)).toEqual([]);
  });
});

describe("snapToPixel", () => {
  it("centres odd weights on a pixel", () => {
    expect(snapToPixel(10.2, 1)).toBe(10.5);
    expect(snapToPixel(10.9, 1)).toBe(10.5);
    expect(snapToPixel(10.9, 3)).toBe(10.5);
  });

  it("puts even weights on a pixel boundary", () => {
    expect(snapToPixel(10.2, 2)).toBe(10);
    expect(snapToPixel(10.6, 2)).toBe(11);
  });
});

describe("guideWeight", () => {
  it("is one device pixel up to 2x and two at 3x", () => {
    expect(guideWeight(1)).toBe(1);
    expect(guideWeight(2)).toBe(1);
    expect(guideWeight(3)).toBe(2);
  });
});
