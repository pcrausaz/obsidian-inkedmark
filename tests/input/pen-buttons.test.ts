import { describe, expect, it } from "vitest";
import {
  hoverBarrelHeld,
  normalizePenButtonAction,
  penButtonAtDown,
  penButtonTool,
} from "../../src/input/pen-buttons";

describe("penButtonAtDown — standard mapping", () => {
  it("plain tip contact is no button", () => {
    expect(penButtonAtDown(1, false, false)).toBeNull();
  });

  it("eraser end (Blink: bit 32, contact bit cleared)", () => {
    expect(penButtonAtDown(32, false, false)).toBe("eraser");
  });

  it("barrel button held while touching", () => {
    expect(penButtonAtDown(1 | 2, false, false)).toBe("barrel");
  });

  it("second barrel button", () => {
    expect(penButtonAtDown(1 | 4, false, false)).toBe("barrel2");
  });

  it("ignores Android hover state off Android", () => {
    expect(penButtonAtDown(1, false, true)).toBeNull();
  });
});

describe("penButtonAtDown — Android mapping", () => {
  it("primary barrel is known only from hover", () => {
    expect(penButtonAtDown(1, true, false)).toBeNull();
    expect(penButtonAtDown(1, true, true)).toBe("barrel");
  });

  it("secondary barrel maps to the right bit", () => {
    expect(penButtonAtDown(1 | 2, true, false)).toBe("barrel2");
  });

  it("eraser wins over everything", () => {
    expect(penButtonAtDown(32 | 2, true, true)).toBe("eraser");
  });
});

describe("hoverBarrelHeld", () => {
  it("reads the left bit", () => {
    expect(hoverBarrelHeld(0)).toBe(false);
    expect(hoverBarrelHeld(1)).toBe(true);
    expect(hoverBarrelHeld(2)).toBe(false);
  });
});

describe("penButtonTool", () => {
  it("no button keeps the selected tool", () => {
    expect(penButtonTool(null, "eraser", "highlighter")).toBeNull();
  });

  it("the eraser end always erases", () => {
    expect(penButtonTool("eraser", "none", "none")).toBe("eraser");
  });

  it("barrel buttons follow their settings", () => {
    expect(penButtonTool("barrel", "eraser", "highlighter")).toBe("eraser");
    expect(penButtonTool("barrel2", "eraser", "highlighter")).toBe("highlighter");
    expect(penButtonTool("barrel", "highlighter", "eraser")).toBe("highlighter");
  });

  it("'none' keeps the selected tool", () => {
    expect(penButtonTool("barrel", "none", "highlighter")).toBeNull();
    expect(penButtonTool("barrel2", "eraser", "none")).toBeNull();
  });
});

describe("normalizePenButtonAction", () => {
  it("keeps known values and falls back otherwise", () => {
    expect(normalizePenButtonAction("highlighter", "eraser")).toBe("highlighter");
    expect(normalizePenButtonAction("none", "eraser")).toBe("none");
    expect(normalizePenButtonAction("select", "eraser")).toBe("eraser");
    expect(normalizePenButtonAction(undefined, "highlighter")).toBe("highlighter");
  });
});
