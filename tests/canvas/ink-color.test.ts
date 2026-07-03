import { describe, expect, it } from "vitest";
import { INK_ON_DARK, INK_ON_LIGHT, isThemeInk, resolveInkColor } from "../../src/canvas/ink-color";

describe("resolveInkColor", () => {
  it("maps white ink onto light paper as dark ink (the invisible-note bug)", () => {
    expect(resolveInkColor("#ffffff", false)).toBe(INK_ON_LIGHT);
  });

  it("maps black ink onto dark paper as white ink", () => {
    expect(resolveInkColor("#1a1a1a", true)).toBe(INK_ON_DARK);
    expect(resolveInkColor("#000000", true)).toBe(INK_ON_DARK);
  });

  it("keeps theme ink unchanged when it already matches the paper", () => {
    expect(resolveInkColor("#ffffff", true)).toBe(INK_ON_DARK);
    expect(resolveInkColor("#1a1a1a", false)).toBe(INK_ON_LIGHT);
  });

  it("never remaps deliberate colors", () => {
    for (const dark of [true, false]) {
      expect(resolveInkColor("#e03131", dark)).toBe("#e03131");
      expect(resolveInkColor("#1971c2", dark)).toBe("#1971c2");
    }
  });

  it("is case/whitespace tolerant", () => {
    expect(isThemeInk(" #FFFFFF ")).toBe(true);
    expect(isThemeInk("#E03131")).toBe(false);
  });
});
