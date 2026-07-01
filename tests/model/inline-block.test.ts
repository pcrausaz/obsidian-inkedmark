import { describe, expect, it } from "vitest";
import { buildInlineBlock, parseInlineBlock } from "../../src/model/inline-block";

describe("parseInlineBlock", () => {
  it("parses caption + payload", () => {
    const block = parseInlineBlock("caption: Quick sketch\nv1:AbCd==");
    expect(block).toEqual({ caption: "Quick sketch", payload: "v1:AbCd==" });
  });

  it("parses payload alone", () => {
    expect(parseInlineBlock("v1:AbCd==")).toEqual({ caption: null, payload: "v1:AbCd==" });
  });

  it("treats an empty caption value as null", () => {
    expect(parseInlineBlock("caption:\nv1:xx").caption).toBeNull();
  });

  it("ignores blank lines and whitespace", () => {
    const block = parseInlineBlock("\n  caption:  Hi  \n\n  v2:zz  \n");
    expect(block).toEqual({ caption: "Hi", payload: "v2:zz" });
  });

  it("returns nulls when nothing matches", () => {
    expect(parseInlineBlock("just some text")).toEqual({ caption: null, payload: null });
  });

  it("keeps only the first payload / caption", () => {
    const block = parseInlineBlock("caption: A\ncaption: B\nv1:one\nv1:two");
    expect(block).toEqual({ caption: "A", payload: "v1:one" });
  });
});

describe("buildInlineBlock", () => {
  it("round-trips through parseInlineBlock", () => {
    const block = buildInlineBlock("v1:PAYLOAD", "My note");
    expect(block.startsWith("```inkedmark\n")).toBe(true);
    expect(block.trimEnd().endsWith("```")).toBe(true);
    expect(parseInlineBlock(block)).toEqual({ caption: "My note", payload: "v1:PAYLOAD" });
  });
});
