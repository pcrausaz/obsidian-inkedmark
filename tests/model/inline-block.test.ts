import { describe, expect, it } from "vitest";
import {
  buildInlineBlock,
  findInlineBlock,
  parseInlineBlock,
  replaceInlineBlock,
  updateInlineBlockPayload,
} from "../../src/model/inline-block";

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

describe("updateInlineBlockPayload", () => {
  it("replaces the payload line and keeps the caption", () => {
    expect(updateInlineBlockPayload("caption: Hi\nv1:old", "v1:new")).toBe("caption: Hi\nv1:new");
  });

  it("appends a payload when the block has none", () => {
    expect(updateInlineBlockPayload("caption: Hi\n", "v1:new")).toBe("caption: Hi\nv1:new");
    expect(updateInlineBlockPayload("", "v1:new")).toBe("v1:new");
  });
});

describe("findInlineBlock / replaceInlineBlock", () => {
  const note =
    "# Title\n\n```inkedmark\ncaption: A\nv1:aaa\n```\n\ntext\n\n~~~inkedmark\nv1:bbb\n~~~\n";

  it("accepts a matching hint", () => {
    const hint = { lineStart: 2, lineEnd: 5 };
    expect(findInlineBlock(note, "caption: A\nv1:aaa", hint)).toEqual(hint);
  });

  it("falls back to scanning when the hint is stale", () => {
    const stale = { lineStart: 0, lineEnd: 3 };
    expect(findInlineBlock(note, "caption: A\nv1:aaa", stale)).toEqual({
      lineStart: 2,
      lineEnd: 5,
    });
    expect(findInlineBlock(note, "v1:bbb")).toEqual({ lineStart: 9, lineEnd: 11 });
  });

  it("returns null when the source is missing or ambiguous", () => {
    expect(findInlineBlock(note, "v1:zzz")).toBeNull();
    const dup = "```inkedmark\nv1:x\n```\n```inkedmark\nv1:x\n```";
    expect(findInlineBlock(dup, "v1:x")).toBeNull();
    // ...unless the hint disambiguates.
    expect(findInlineBlock(dup, "v1:x", { lineStart: 3, lineEnd: 5 })).toEqual({
      lineStart: 3,
      lineEnd: 5,
    });
  });

  it("rewrites only the block interior", () => {
    const out = replaceInlineBlock(note, { lineStart: 2, lineEnd: 5 }, "caption: A\nv1:new");
    expect(out).toBe(note.replace("v1:aaa", "v1:new"));
  });
});
