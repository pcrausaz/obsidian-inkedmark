import { describe, expect, it } from "vitest";
import type { Stroke } from "../../src/model/document";
import { groupStrokesIntoLines } from "../../src/recognition/lines";

/** A stroke whose bounds span the given box (pressure fixed). */
function box(id: string, minX: number, minY: number, maxX: number, maxY: number): Stroke {
  return { id, color: "#fff", size: 3, tool: "pen", pts: [minX, minY, 0.5, maxX, maxY, 0.5] };
}

describe("groupStrokesIntoLines", () => {
  it("returns no lines for no strokes", () => {
    expect(groupStrokesIntoLines([])).toEqual([]);
  });

  it("splits vertically separated writing into lines, top to bottom", () => {
    const line1 = [box("a", 0, 0, 30, 40), box("b", 40, 5, 70, 42)];
    const line2 = [box("c", 0, 120, 30, 160), box("d", 40, 118, 80, 158)];
    // Deliberately interleave the input order.
    const lines = groupStrokesIntoLines([line2[1], line1[0], line2[0], line1[1]]);
    expect(lines).toHaveLength(2);
    expect(lines[0].map((s) => s.id)).toEqual(["a", "b"]);
    expect(lines[1].map((s) => s.id)).toEqual(["c", "d"]);
  });

  it("keeps an i-dot with its line despite sitting above the band", () => {
    const body = box("i-body", 100, 20, 108, 60);
    const dot = box("i-dot", 102, 8, 106, 12); // small mark just above
    const other = box("word", 0, 15, 80, 62);
    const lines = groupStrokesIntoLines([dot, body, other]);
    expect(lines).toHaveLength(1);
    // Left-to-right order within the line.
    expect(lines[0].map((s) => s.id)).toEqual(["word", "i-body", "i-dot"]);
  });

  it("orders strokes left-to-right within a line", () => {
    const lines = groupStrokesIntoLines([
      box("right", 200, 0, 240, 40),
      box("left", 0, 2, 40, 41),
      box("mid", 100, 1, 140, 39),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].map((s) => s.id)).toEqual(["left", "mid", "right"]);
  });

  it("ignores strokes with no points", () => {
    const empty: Stroke = { id: "e", color: "#fff", size: 3, tool: "pen", pts: [] };
    const lines = groupStrokesIntoLines([empty, box("a", 0, 0, 10, 10)]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(1);
  });
});
