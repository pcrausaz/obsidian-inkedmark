import { describe, expect, it } from "vitest";
import { deflateToBase64 } from "../../src/model/compress";
import { type InkDocument, type Stroke, emptyDocument } from "../../src/model/document";
import {
  SerializeError,
  buildInkFile,
  decodeDocument,
  dequantizePts,
  encodeDocument,
  parseInkFile,
  quantizePts,
  splitFrontmatter,
} from "../../src/model/serialize";

function makeDoc(strokes: Stroke[]): InkDocument {
  const doc = emptyDocument(1024);
  doc.regions[0].strokes = strokes;
  return doc;
}

const sampleStroke: Stroke = {
  id: "s1",
  color: "#1971c2",
  size: 5,
  tool: "pen",
  pts: [12.043, 5.51, 0.5, 12.09, 5.532, 0.78, 100.001, 200.999, 1],
};

describe("quantization", () => {
  it("round-trips points within the quantization tolerance", () => {
    const restored = dequantizePts(quantizePts(sampleStroke.pts));
    for (let i = 0; i < sampleStroke.pts.length; i += 3) {
      expect(restored[i]).toBeCloseTo(sampleStroke.pts[i], 2);
      expect(restored[i + 1]).toBeCloseTo(sampleStroke.pts[i + 1], 2);
      expect(restored[i + 2]).toBeCloseTo(sampleStroke.pts[i + 2], 2);
    }
  });

  it("clamps pressure into 0..255 when quantizing", () => {
    const q = quantizePts([0, 0, 2, 1, 1, -0.5]);
    expect(q[2]).toBe(255);
    expect(q[5]).toBe(0);
  });
});

describe("document payload", () => {
  it("encodes with a v1 prefix", () => {
    expect(encodeDocument(makeDoc([sampleStroke])).startsWith("v1:")).toBe(true);
  });

  it("round-trips a document (modulo quantization)", () => {
    const doc = makeDoc([sampleStroke]);
    const decoded = decodeDocument(encodeDocument(doc));
    expect(decoded.regions).toHaveLength(1);
    const s = decoded.regions[0].strokes[0];
    expect(s.id).toBe("s1");
    expect(s.color).toBe("#1971c2");
    expect(s.size).toBe(5);
    expect(s.tool).toBe("pen");
    expect(s.pts[0]).toBeCloseTo(12.043, 2);
    expect(s.pts[2]).toBeCloseTo(0.5, 2);
  });

  it("preserves highlighter tool through a round-trip", () => {
    const hl: Stroke = { ...sampleStroke, id: "s2", tool: "highlighter" };
    const decoded = decodeDocument(encodeDocument(makeDoc([hl])));
    expect(decoded.regions[0].strokes[0].tool).toBe("highlighter");
  });
});

describe("decode error handling", () => {
  it("throws SerializeError on a missing version prefix", () => {
    expect(() => decodeDocument("not-a-payload")).toThrow(SerializeError);
  });

  it("throws SerializeError on a non-numeric version", () => {
    expect(() => decodeDocument("vX:abcd")).toThrow(SerializeError);
  });

  it("throws SerializeError on corrupt compressed data", () => {
    expect(() => decodeDocument("v1:@@@@")).toThrow(SerializeError);
  });

  it("throws SerializeError when the payload is not JSON", () => {
    const payload = `v1:${deflateToBase64("this is not json")}`;
    expect(() => decodeDocument(payload)).toThrow(SerializeError);
  });

  it("throws SerializeError when the payload JSON is not an object", () => {
    const payload = `v1:${deflateToBase64("123")}`;
    expect(() => decodeDocument(payload)).toThrow(SerializeError);
  });
});

describe("decode degrades safely", () => {
  function payloadFor(value: unknown): string {
    return `v1:${deflateToBase64(JSON.stringify(value))}`;
  }

  it("fills defaults for missing view and stroke fields", () => {
    const doc = decodeDocument(payloadFor({ regions: [{ strokes: [{ pts: [1, 2, 100] }] }] }));
    expect(doc.view).toEqual({ scrollY: 0, width: 1024, scale: 1 });
    const s = doc.regions[0].strokes[0];
    expect(s.id).toBe("s1");
    expect(s.color).toBe("#1a1a1a");
    expect(s.size).toBe(3);
    expect(s.tool).toBe("pen");
  });

  it("synthesizes a region when regions is absent", () => {
    const doc = decodeDocument(payloadFor({ view: { width: 800 } }));
    expect(doc.regions).toHaveLength(1);
    expect(doc.view.width).toBe(800);
  });

  it("drops a trailing partial point so length stays a multiple of three", () => {
    const doc = decodeDocument(
      payloadFor({ regions: [{ strokes: [{ pts: [1, 2, 100, 9, 9] }] }] }),
    );
    expect(doc.regions[0].strokes[0].pts).toHaveLength(3);
  });

  it("skips strokes that are not objects", () => {
    const doc = decodeDocument(
      payloadFor({ regions: [{ strokes: [null, 42, { pts: [0, 0, 0] }] }] }),
    );
    expect(doc.regions[0].strokes).toHaveLength(1);
  });
});

describe("ink file split / build", () => {
  const body =
    "---\ninkedmark: true\ninkedmark-version: 1\n---\n\n# Notes\n\nSome typed prose with [[a link]].";

  it("round-trips body and document through build -> parse", () => {
    const file = buildInkFile(body, makeDoc([sampleStroke]));
    const parsed = parseInkFile(file);
    expect(parsed.body).toBe(body);
    expect(parsed.doc).not.toBeNull();
    expect(parsed.doc?.regions[0].strokes[0].id).toBe("s1");
  });

  it("returns the whole markdown and a null doc when no block is present", () => {
    const parsed = parseInkFile("# Just markdown\n\nNo ink here.");
    expect(parsed.doc).toBeNull();
    expect(parsed.body).toContain("Just markdown");
  });

  it("keeps the body and drops an unreadable block", () => {
    const parsed = parseInkFile("# Title\n\n%%inkedmark\nv1:@@@garbage@@@\n%%\n");
    expect(parsed.doc).toBeNull();
    expect(parsed.body).toContain("Title");
    expect(parsed.body).not.toContain("inkedmark");
  });

  it("buildInkFile emits a fenced data comment block", () => {
    const file = buildInkFile("# T", makeDoc([]));
    expect(file).toMatch(/%%inkedmark\nv1:[A-Za-z0-9+/=]+\n%%/);
  });
});

describe("splitFrontmatter", () => {
  it("separates frontmatter from prose", () => {
    const body = "---\ninkedmark: true\ntags: [a]\n---\n\n# Title\n\nProse.";
    const { frontmatter, prose } = splitFrontmatter(body);
    expect(frontmatter).toBe("---\ninkedmark: true\ntags: [a]\n---\n");
    expect(prose).toBe("\n# Title\n\nProse.");
  });

  it("returns empty frontmatter when there is none", () => {
    const { frontmatter, prose } = splitFrontmatter("# Title\n\nProse.");
    expect(frontmatter).toBe("");
    expect(prose).toBe("# Title\n\nProse.");
  });

  it("recombines to the original body", () => {
    const body = "---\na: 1\n---\n# T\ntext";
    const { frontmatter, prose } = splitFrontmatter(body);
    expect(frontmatter + prose).toBe(body);
  });
});
