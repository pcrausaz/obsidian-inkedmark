import { describe, expect, it } from "vitest";
import {
  HOVER_CLICK_MAX_MS,
  HoverClickDetector,
  hoverBarrelHeld,
  normalizePenButtonAction,
  penButtonAtDown,
  penButtonTool,
  toggledTool,
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

describe("HoverClickDetector (Android)", () => {
  it("a quick press + release while hovering is a click", () => {
    const d = new HoverClickDetector();
    expect(d.hover(0, 0)).toBe(false);
    expect(d.hover(1, 100)).toBe(false);
    expect(d.hover(1, 150)).toBe(false);
    expect(d.hover(0, 300)).toBe(true);
    expect(d.hover(0, 350)).toBe(false);
  });

  it("a long press is not a click", () => {
    const d = new HoverClickDetector();
    d.hover(1, 0);
    expect(d.hover(0, HOVER_CLICK_MAX_MS + 1)).toBe(false);
  });

  it("a pen-down during the press cancels the click", () => {
    const d = new HoverClickDetector();
    d.hover(1, 0);
    d.down();
    expect(d.hover(0, 200)).toBe(false);
  });

  it("leaving hover range forgets the press", () => {
    const d = new HoverClickDetector();
    d.hover(1, 0);
    d.reset();
    expect(d.hover(0, 100)).toBe(false);
  });

  it("a release never seen pressed is not a click", () => {
    const d = new HoverClickDetector();
    expect(d.hover(0, 0)).toBe(false);
    expect(d.hover(0, 10)).toBe(false);
  });
});

describe("toggledTool", () => {
  it("switches to the button tool, remembering the current one", () => {
    expect(toggledTool("pen", "eraser", null)).toEqual({ tool: "eraser", previous: "pen" });
    expect(toggledTool("highlighter", "eraser", null)).toEqual({
      tool: "eraser",
      previous: "highlighter",
    });
  });

  it("switches back when the button tool is selected", () => {
    expect(toggledTool("eraser", "eraser", "highlighter")).toEqual({
      tool: "highlighter",
      previous: null,
    });
  });

  it("falls back to the pen when nothing was remembered", () => {
    expect(toggledTool("eraser", "eraser", null)).toEqual({ tool: "pen", previous: null });
  });
});
