import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, DEFAULT_PAPER_WIDTH } from "../../src/constants";
import {
  type InkDocument,
  type Stroke,
  documentBounds,
  emptyDocument,
  primaryRegion,
  strokeBounds,
  strokeCount,
  strokesContentHash,
} from "../../src/model/document";

function stroke(id: string, pts: number[]): Stroke {
  return { id, color: "#000000", size: 3, tool: "pen", pts };
}

describe("document", () => {
  it("emptyDocument has one empty region and current version", () => {
    const doc = emptyDocument();
    expect(doc.version).toBe(SCHEMA_VERSION);
    expect(doc.view.width).toBe(DEFAULT_PAPER_WIDTH);
    expect(doc.regions).toHaveLength(1);
    expect(doc.regions[0].strokes).toHaveLength(0);
  });

  it("emptyDocument honors a custom width", () => {
    expect(emptyDocument(640).view.width).toBe(640);
  });

  it("strokeBounds returns the tight box for a stroke", () => {
    const b = strokeBounds(stroke("s1", [10, 20, 0.5, 30, 5, 0.5, 15, 40, 0.5]));
    expect(b).toEqual({ minX: 10, minY: 5, maxX: 30, maxY: 40 });
  });

  it("strokeBounds returns null for an empty stroke", () => {
    expect(strokeBounds(stroke("s1", []))).toBeNull();
  });

  it("documentBounds unions every stroke, ignoring empty ones", () => {
    const doc: InkDocument = {
      version: SCHEMA_VERSION,
      view: { scrollY: 0, width: 100, scale: 1 },
      regions: [
        {
          id: "r1",
          kind: "ink",
          strokes: [
            stroke("s1", [0, 0, 1, 10, 10, 1]),
            stroke("s2", []),
            stroke("s3", [50, 60, 1]),
          ],
        },
      ],
    };
    expect(documentBounds(doc)).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 60 });
  });

  it("documentBounds is null when there are no points", () => {
    expect(documentBounds(emptyDocument())).toBeNull();
  });

  it("strokeCount sums across regions", () => {
    const doc = emptyDocument();
    doc.regions[0].strokes.push(stroke("s1", [0, 0, 1]), stroke("s2", [1, 1, 1]));
    expect(strokeCount(doc)).toBe(2);
  });

  it("strokesContentHash is stable for identical content", () => {
    const a = emptyDocument();
    const b = emptyDocument();
    a.regions[0].strokes.push(stroke("s1", [1, 2, 0.5]));
    b.regions[0].strokes.push(stroke("s1", [1, 2, 0.5]));
    expect(strokesContentHash(a)).toBe(strokesContentHash(b));
  });

  it("strokesContentHash changes when a stroke moves or is added", () => {
    const doc = emptyDocument();
    doc.regions[0].strokes.push(stroke("s1", [1, 2, 0.5]));
    const before = strokesContentHash(doc);
    doc.regions[0].strokes[0].pts[0] += 5;
    const moved = strokesContentHash(doc);
    expect(moved).not.toBe(before);
    doc.regions[0].strokes.push(stroke("s2", [9, 9, 1]));
    expect(strokesContentHash(doc)).not.toBe(moved);
  });

  it("strokesContentHash of an empty document is stable", () => {
    expect(strokesContentHash(emptyDocument())).toBe(strokesContentHash(emptyDocument()));
  });

  it("primaryRegion repairs a document with no regions", () => {
    const doc: InkDocument = {
      version: SCHEMA_VERSION,
      view: { scrollY: 0, width: 100, scale: 1 },
      regions: [],
    };
    const region = primaryRegion(doc);
    expect(region.kind).toBe("ink");
    expect(doc.regions).toHaveLength(1);
  });
});
