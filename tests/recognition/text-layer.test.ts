import { describe, expect, it } from "vitest";
import {
  applyTranscriptionToInkFile,
  readTextSection,
  writeTextSection,
} from "../../src/recognition/text-layer";
import { emptyDocument, primaryRegion } from "../../src/model/document";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";

describe("text-layer managed section", () => {
  it("returns null when there is no section", () => {
    expect(readTextSection("# Title\n\nSome prose.")).toBeNull();
  });

  it("appends a section, preserving existing prose", () => {
    const body = "# Title\n\nSome prose.";
    const out = writeTextSection(body, "recognized text");
    expect(out).toContain("# Title");
    expect(out).toContain("Some prose.");
    expect(readTextSection(out)).toBe("recognized text");
  });

  it("updates an existing section in place, not the prose", () => {
    const body = writeTextSection("# T\n\nProse.", "first");
    const updated = writeTextSection(body, "second");
    expect(readTextSection(updated)).toBe("second");
    expect(updated).toContain("Prose.");
    // Only one managed section exists.
    expect(updated.match(/inkedmark-text-->/g)?.length).toBe(2);
  });

  it("removes the section when text is blank, keeping prose", () => {
    const body = writeTextSection("# T\n\nProse.", "x");
    const cleared = writeTextSection(body, "   ");
    expect(readTextSection(cleared)).toBeNull();
    expect(cleared).toContain("Prose.");
    expect(cleared).not.toContain("inkedmark-text");
  });

  it("is a no-op writing blank text with no existing section", () => {
    const body = "# T\n\nProse.";
    expect(writeTextSection(body, "")).toBe(body);
  });

  it("preserves multi-line markdown text in the section", () => {
    const text = "Agreed scope with [[Anna]]; ship #q3.\nDiagram on the right.";
    const out = writeTextSection("# T", text);
    expect(readTextSection(out)).toBe(text);
  });
});

describe("applyTranscriptionToInkFile", () => {
  const doc = emptyDocument(800);
  primaryRegion(doc).strokes.push({
    id: "s1",
    color: "#000000",
    size: 4,
    tool: "pen",
    pts: [10, 10, 0.5, 20, 20, 0.5],
  });
  const file = buildInkFile("---\ninkedmark: true\n---\n\n# Note\n\nMy prose.", doc);

  it("writes the managed section and the hash, keeping prose and ink", () => {
    const out = applyTranscriptionToInkFile(file, "hello world", "h1", 800);
    expect(out).not.toBeNull();
    const parsed = parseInkFile(out ?? "", 800);
    expect(readTextSection(parsed.body)).toBe("hello world");
    expect(parsed.body).toContain("My prose.");
    expect(parsed.body).toContain("inkedmark: true");
    expect(parsed.doc?.recognizedHash).toBe("h1");
    expect(primaryRegion(parsed.doc!).strokes).toHaveLength(1);
  });

  it("refuses a file whose ink block can't be read", () => {
    expect(applyTranscriptionToInkFile("# Just markdown", "x", "h", 800)).toBeNull();
  });
});
