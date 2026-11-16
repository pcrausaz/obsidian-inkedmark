import { describe, expect, it } from "vitest";
import { type ToolStyleState, setToolStyle, toolStyle } from "../../src/ink/tool-style";

const fresh = (): ToolStyleState => ({
  color: "#1a1a1a",
  size: 3,
  highlighterColor: "#f08c00",
  highlighterSize: 12,
});

describe("toolStyle", () => {
  it("the highlighter has its own color and size", () => {
    expect(toolStyle(fresh(), "highlighter")).toEqual({ color: "#f08c00", size: 12 });
  });

  it("the pen uses the pen style", () => {
    expect(toolStyle(fresh(), "pen")).toEqual({ color: "#1a1a1a", size: 3 });
  });

  it("eraser and select show the pen style", () => {
    expect(toolStyle(fresh(), "eraser")).toEqual({ color: "#1a1a1a", size: 3 });
    expect(toolStyle(fresh(), "select")).toEqual({ color: "#1a1a1a", size: 3 });
  });
});

describe("setToolStyle", () => {
  it("changing the highlighter leaves the pen alone", () => {
    const state = fresh();
    setToolStyle(state, "highlighter", { color: "#2f9e44", size: 8 });
    expect(toolStyle(state, "highlighter")).toEqual({ color: "#2f9e44", size: 8 });
    expect(toolStyle(state, "pen")).toEqual({ color: "#1a1a1a", size: 3 });
  });

  it("changing the pen leaves the highlighter alone", () => {
    const state = fresh();
    setToolStyle(state, "pen", { color: "#e03131", size: 5 });
    expect(toolStyle(state, "pen")).toEqual({ color: "#e03131", size: 5 });
    expect(toolStyle(state, "highlighter")).toEqual({ color: "#f08c00", size: 12 });
  });

  it("eraser and select edit the pen style", () => {
    const state = fresh();
    setToolStyle(state, "eraser", { size: 8 });
    setToolStyle(state, "select", { color: "#1971c2" });
    expect(toolStyle(state, "pen")).toEqual({ color: "#1971c2", size: 8 });
    expect(toolStyle(state, "highlighter")).toEqual({ color: "#f08c00", size: 12 });
  });

  it("a partial patch changes only the given field", () => {
    const state = fresh();
    setToolStyle(state, "highlighter", { size: 5 });
    expect(toolStyle(state, "highlighter")).toEqual({ color: "#f08c00", size: 5 });
    setToolStyle(state, "highlighter", { color: "#1971c2" });
    expect(toolStyle(state, "highlighter")).toEqual({ color: "#1971c2", size: 5 });
    setToolStyle(state, "pen", { color: "#9c36b5" });
    expect(toolStyle(state, "pen")).toEqual({ color: "#9c36b5", size: 3 });
    setToolStyle(state, "pen", { size: 12 });
    expect(toolStyle(state, "pen")).toEqual({ color: "#9c36b5", size: 12 });
  });
});
