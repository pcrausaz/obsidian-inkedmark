import { describe, expect, it } from "vitest";
import { readTextSection, writeTextSection } from "../../src/recognition/text-layer";

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
